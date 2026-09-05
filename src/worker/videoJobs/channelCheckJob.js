// Checa os canais do YouTube cadastrados, cadastra os videos novos que
// encontrar e manda cada um pra fila de processamento.
'use strict';

const youtubeChannelsRepository = require('../../repositories/youtubeChannelsRepository');
const sourceVideosRepository = require('../../repositories/sourceVideosRepository');
const ytDlpService = require('../../services/ytDlpService');
const queuePriorityService = require('../../services/queuePriorityService');
const postingsRepository = require('../../repositories/postingsRepository');
const errorReportService = require('../../services/errorReportService');
const { podeBaixarAgora, motivoDaEspera, ehPublico } = require('../../lib/disponibilidadeDoVideo');
const logger = require('../../lib/logger');

const QUEUE_VIDEO_PROCESSING = 'video-processing';

// TETO DE VIDEOS QUE UMA CHECAGEM PODE ENFILEIRAR, POR CANAL.
//
// Segunda tranca, independente de qualquer raciocinio sobre marco d'agua.
//
// Em 01/09/2026 uma checagem enfileirou 14 videos de uma vez e gastou banda
// paga, IA e a cota do cliente antes de alguem ver. A causa daquele dia esta
// corrigida logo abaixo (marco d'agua perdido virava "tudo e novidade"), mas a
// licao maior e que NENHUM caminho deveria conseguir fazer isso: um canal
// publica ~1 video por dia e a checagem roda a cada 20 minutos, entao 3 ja e
// muito mais do que o normal - e qualquer numero acima disso e sinal de defeito,
// nao de canal produtivo.
//
// O que passar do teto NAO se perde: fica acima do marco d'agua (igual a
// estreia e ao video de membros) e e pego na checagem seguinte, 20 minutos
// depois. O preco de errar aqui e atraso; o preco de nao ter teto e fatura.
const MAX_VIDEOS_POR_CHECAGEM = 3;

// Com "so processar quando a fila estiver quase vazia" ligado, o canal so pega
// video novo quando restam no maximo ESTE tanto de cortes esperando publicacao.
//
// Sem esse freio, um canal que publica todo dia gera cortes mais rapido do que
// a fila consegue postar: a fila cresce sem parar e, quando um corte finalmente
// sai, o assunto dele ja e velho. O freio troca "cortar tudo" por "cortar o que
// vai sair logo".
const CORTES_NA_FILA_PRA_LIBERAR = 1;

// A fila que importa e a da conta do TikTok onde ESTE canal publica. Canal sem
// conta vinculada nao tem fila pra engarrafar (os cortes vao pro Drive ou ficam
// prontos esperando), entao nada segura ele.
async function filaEstaLivre(channel) {
  if (!channel.tiktok_account_id) return true;
  const pendentes = await postingsRepository.countPendingForAccount(channel.tiktok_account_id);
  return pendentes <= CORTES_NA_FILA_PRA_LIBERAR;
}

// Cadastra um video exclusivo de membros com selo proprio, sem enfileirar.
//
// Diferente da estreia, que e ADIADA sem cadastrar: uma estreia vira video
// normal em minutos, enquanto um video de membros pode passar semanas assim - e
// o cliente precisa entender por que aquele video nao virou corte, em vez de
// olhar um canal que simplesmente parou de trazer coisa. Foi pedido explicito
// do fundador (01/09/2026).
//
// Segura o marco d'agua pelo mesmo motivo da estreia: um video ABAIXO do marco
// nunca mais e olhado, entao quando ele abrisse ja estaria perdido em silencio.
async function cadastrarComSelo({ channel, video, title, seguramOMarco }) {
  seguramOMarco.add(video.videoId);

  const created = await sourceVideosRepository.createIfNotExists({
    youtubeChannelId: channel.id,
    ownerClientUserId: channel.client_user_id,
    youtubeVideoId: video.videoId,
    title,
    thumbnailUrl: video.thumbnailUrl,
    publishedAt: video.publishedAt,
    durationSeconds: video.durationSeconds,
    status: 'somente_membros',
  });
  if (!created) return;

  logger.info(
    `Canal "${channel.channel_name}": "${created.title}" e exclusivo para membros - ` +
      `cadastrado com selo, sem entrar na fila. Entra sozinho se abrir pro publico.`
  );
}

// Poe na fila os videos deste canal que estavam com selo de "somente membros"
// e agora aparecem publicos na listagem.
//
// O fundador pediu que o video entre em processamento "se ele sair para o
// publico e for o video mais recente". A segunda metade importa: o freio de
// engarrafamento e o marco d'agua existem justamente pra o sistema nao
// desengavetar conteudo velho, e um video que ficou 3 semanas fechado e velho
// quando abre. Por isso a liberacao segue a MESMA regra do resto: entra quem e
// o mais recente do canal naquele momento.
//
// O que fica pra tras nao vira lixo eterno: ele deixa de ser exclusivo (o selo
// sai, porque o selo estaria mentindo) e fica como um video detectado que o
// cliente pode enfileirar na mao se quiser.
async function liberarQuemAbriu({ channel, videos, priority, boss }) {
  const comSelo = await sourceVideosRepository.listMembersOnlyByChannel(channel.id);
  if (!comSelo.length) return;

  // O mais recente do canal AGORA - o mesmo criterio que o marco d'agua usa.
  const maisRecente = videos.find((v) => ehPublico(v.availability) && podeBaixarAgora(v.liveStatus));

  for (const video of comSelo) {
    const naListagem = videos.find((v) => v.videoId === video.youtube_video_id);
    // Sumiu da listagem: nao da pra afirmar nada sobre ele. Mexer aqui seria
    // adivinhar.
    if (!naListagem) continue;
    if (!ehPublico(naListagem.availability)) continue; // continua fechado, nada muda

    const liberado = await sourceVideosRepository.liberarDeSomenteMembros(video.id, { title: naListagem.title });
    if (!liberado) continue;

    if (maisRecente && maisRecente.videoId === video.youtube_video_id) {
      logger.info(
        `Canal "${channel.channel_name}": "${liberado.title}" saiu de "somente membros" e e o mais ` +
          `recente do canal - entrando na fila.`
      );
      await boss.send(QUEUE_VIDEO_PROCESSING, { sourceVideoId: liberado.id }, { priority });
    } else {
      logger.info(
        `Canal "${channel.channel_name}": "${liberado.title}" saiu de "somente membros", mas ja nao e ` +
          `o mais recente - fica disponivel pro cliente enfileirar na mao.`
      );
    }
  }
}

async function run(boss) {
  const channels = await youtubeChannelsRepository.listActive();

  for (const channel of channels) {
    try {
      // A pagina /videos do canal sempre vem do mais novo pro mais velho -
      // usamos isso como marco d'agua por ID em vez de data (a listagem
      // rapida via --flat-playlist nao traz data de upload nenhuma, sempre
      // null, entao comparar por data nunca detectava nada de verdade).
      const videos = await ytDlpService.listChannelVideos(channel.channel_url, { limit: 15 });
      if (videos.length === 0) {
        // Canal sem video nenhum na listagem. Nao e erro, mas TEM que registrar
        // a tentativa: sem isso a tela mostra a data da ultima checagem que deu
        // certo e parece que o agendamento parou.
        await youtubeChannelsRepository.markCheckFailed(channel.id, 'O canal nao devolveu nenhum video na listagem.');
        continue;
      }

      // ANCORAGEM INICIAL - vem ANTES do freio, de proposito.
      //
      // Canal sem marco d'agua ainda (recem-cadastrado, ou recem-retomado
      // depois de pausado) nao processa historico: ele so fixa o marco no video
      // mais recente de AGORA, e passa a pegar o que for publicado dali pra
      // frente. Ancorar nao custa nada - a listagem ja esta em maos, nao ha
      // download nem chamada de IA - entao o freio, que existe pra nao PEGAR
      // video novo, nao tem motivo pra segurar isto.
      //
      // Segurar custou um video de verdade em 04/09/2026, no canal "Davy Jones
      // GTA 6": o canal foi cadastrado, o video mais recente foi processado
      // pelo pop-up e gerou 15 cortes, e a fila daquela conta do TikTok ficou
      // cheia por mais de um dia. Durante todo esse tempo o freio devolvia o
      // marco como NULL a cada 20 minutos, mantendo o canal em "primeira
      // checagem". Quando a fila finalmente esvaziou, a ancoragem rodou e fixou
      // o marco no video que o canal tinha publicado no meio do caminho -
      // engolindo ele sem nunca cadastrar. Nenhuma tela mostrava isso: o canal
      // simplesmente parou de trazer video.
      //
      // Video que ainda nao virou arquivo (estreia) ou que nao e nosso pra
      // baixar (exclusivo de membros) NAO serve de ancora - o marco passaria
      // por cima dele e ele se perderia quando abrisse. Sem nenhum candidato,
      // o marco continua nulo e a proxima checagem tenta de novo.
      if (!channel.last_video_id) {
        const ancora = videos.find((v) => podeBaixarAgora(v.liveStatus) && ehPublico(v.availability));
        await youtubeChannelsRepository.updatePollState(channel.id, {
          lastVideoId: ancora ? ancora.videoId : null,
        });
        await errorReportService.clear(errorReportService.OPERACOES.CHANNEL_CHECK, 'youtube_channel', channel.id);
        logger.info(
          ancora
            ? `Canal "${channel.channel_name}": marco d'agua ancorado em "${ancora.title}". ` +
                `Video publicado a partir de agora entra na fila.`
            : `Canal "${channel.channel_name}": nenhum video disponivel pra ancorar o marco d'agua ` +
                `(so estreia/exclusivo de membros) - tento de novo na proxima checagem.`
        );
        continue;
      }

      // Freio de engarrafamento. Vem ANTES de cadastrar qualquer video: o
      // marco d'agua (last_video_id) fica onde esta, entao o video continua
      // "novo" e sera pego numa checagem futura, quando a fila tiver baixado.
      // De quebra, isso faz o sistema pegar sempre o video MAIS RECENTE do
      // momento em que a fila liberar, em vez de desengavetar o antigo.
      if (channel.process_only_when_queue_clear && !(await filaEstaLivre(channel))) {
        // lastVideoId nulo preserva o marco d'agua e so registra a checagem -
        // sem isso a tela diria que o canal parou de ser conferido.
        await youtubeChannelsRepository.updatePollState(channel.id, { lastVideoId: null });
        logger.info(
          `Canal "${channel.channel_name}": fila de postagem cheia, nao vou pegar video novo agora.`
        );
        continue;
      }

      // A partir daqui o canal SEMPRE tem marco d'agua: o caso "primeira
      // checagem" foi resolvido la em cima, antes do freio.
      let newVideos;
      {
        const knownIndex = videos.findIndex((v) => v.videoId === channel.last_video_id);

        if (knownIndex === -1) {
          // PERDEMOS O LUGAR NA FILA. Isso NAO significa "tudo e novidade".
          //
          // Ate 01/09/2026 esta linha era `newVideos = videos`: a lista INTEIRA
          // virava video novo. Custou dinheiro de verdade nesse dia, no canal
          // "Manual do Mundo": o video que era o marco d'agua saiu da listagem
          // do canal (era exclusivo de membros e o canal o tirou da aba
          // /videos), o findIndex devolveu -1, e a checagem seguinte baixou e
          // transcreveu 14 videos ANTIGOS de uma vez - 479 MB pelo proxy pago,
          // US$ 1,05 de IA e 132 minutos da cota do cliente, por nada.
          //
          // O comentario antigo dizia que o createIfNotExists protegia contra
          // duplicar. Protege - mas so contra video JA CADASTRADO. Num canal em
          // que so 3 dos ultimos 15 tinham sido processados, os outros 12 eram
          // todos "novos" e todos entraram na fila.
          //
          // A escolha certa quando nao se sabe onde parou e NAO PROCESSAR NADA e
          // reancorar no video mais recente. O pior caso vira "deixamos de pegar
          // um video", que o cliente resolve colando o link em 10 segundos. O
          // outro lado do erro e uma fatura.
          logger.warn(
            `Canal "${channel.channel_name}": o video marco d'agua (${channel.last_video_id}) sumiu da ` +
              `listagem. Reancorando no mais recente SEM processar nada - se algum video foi perdido ` +
              `nessa troca, ele pode ser adicionado pelo link.`
          );
          newVideos = [];
        } else {
          newVideos = videos.slice(0, knownIndex);
        }
      }

      // Do mais antigo pro mais novo, pra entrar na fila em ordem
      // cronologica (e pro video mais recente, no fim do loop, virar o
      // novo marco d'agua).
      const priority = await queuePriorityService.resolveQueuePriorityForClient(channel.client_user_id);

      // ------------------------------------------------------------------
      // Videos que estavam so pra membros e ABRIRAM pro publico.
      // ------------------------------------------------------------------
      //
      // Precisa acontecer FORA do loop de videos novos: um video ja cadastrado
      // e "ja conhecido", entao o loop o descarta na primeira linha - e ele
      // ficaria esperando pra sempre por uma liberacao que ninguem ia notar.
      //
      // A `videos` da listagem ja traz o `availability` atualizado de cada um,
      // entao conferir isso nao custa consulta nenhuma: a resposta ja esta em
      // maos. Se o video nem aparece mais na listagem (saiu do ar, ficou
      // privado, ou o canal publicou muita coisa desde entao), nada acontece -
      // ele continua com o selo, que e a verdade que sabemos.
      await liberarQuemAbriu({ channel, videos, priority, boss });
      // Videos que SEGURAM o marco d'agua - ver logo abaixo do loop.
      //
      // Duas coisas caem aqui, por motivos diferentes:
      //   - estreia/live: adiada sem cadastrar, vira video normal em minutos.
      //   - exclusivo de membros: cadastrado com selo, mas ainda nao publico.
      //
      // Nos dois casos o marco nao pode passar por cima: um video ABAIXO do
      // marco nunca mais e olhado, entao quando ele finalmente abrisse ja
      // estaria perdido em silencio. Foi exatamente assim que um video da conta
      // risestyle sumiu em 27/08/2026.
      const seguramOMarco = new Set();
      let enfileirados = 0;
      for (const video of [...newVideos].reverse()) {
        // Teto batido: o resto SEGURA O MARCO e fica pra proxima checagem, em
        // vez de entrar na fila agora. Sem segurar o marco isto viraria perda
        // de video em vez de adiamento.
        if (enfileirados >= MAX_VIDEOS_POR_CHECAGEM) {
          seguramOMarco.add(video.videoId);
          continue;
        }
        // Ja conhecido: nao gasta consulta nenhuma com ele. Sem essa checagem,
        // um marco d'agua segurado por uma estreia (ver seguramOMarco) faria o
        // sistema reconsultar os mesmos videos a cada 20 minutos, pra sempre.
        const jaConhecido = await sourceVideosRepository.findByYoutubeVideoIdForOwner(
          video.videoId,
          channel.client_user_id
        );
        if (jaConhecido) {
          // Video ja cadastrado com selo de "somente membros" continua segurando
          // o marco. Sem isto, na volta SEGUINTE o marco passaria por cima dele
          // e a liberacao dependeria so da listagem ainda alcanca-lo.
          if (jaConhecido.status === 'somente_membros') seguramOMarco.add(video.videoId);
          continue;
        }

        // A listagem ja costuma dizer que e estreia/live. Quando diz, nem
        // precisamos consultar o video (que, nesse caso, e a consulta mais
        // cara: o yt-dlp tenta achar formato e nao acha).
        if (!podeBaixarAgora(video.liveStatus)) {
          seguramOMarco.add(video.videoId);
          logger.info(
            `Canal "${channel.channel_name}": adiando "${video.title}" - ${motivoDaEspera(video.liveStatus, null)}.`
          );
          continue;
        }

        // Exclusivo de membros, e a LISTAGEM ja disse. Decidido aqui em cima,
        // antes da consulta individual, porque nesse caso ela e pura perda: sai
        // pelo proxy pago, tenta todos os clients e nao devolve formato nenhum
        // (o video existe, mas nao e nosso pra baixar).
        if (!ehPublico(video.availability)) {
          await cadastrarComSelo({ channel, video, title: video.title, seguramOMarco });
          continue;
        }

        // A listagem do canal devolve o titulo TRADUZIDO pelo YouTube: um video
        // chamado "ABRIMOS UM RESTAURANTE" chegava aqui como "WE OPENED A
        // RESTAURANT". Consultar o video em si devolve o titulo original.
        //
        // Uma chamada a mais por video NOVO (nao por checagem). Se falhar, fica
        // com o titulo traduzido em vez de perder o video - titulo errado
        // incomoda, video perdido e pior.
        const original = await ytDlpService
          .getVideoMetadata(`https://www.youtube.com/watch?v=${video.videoId}`)
          .catch((err) => {
            logger.warn(`Nao consegui o titulo original do video ${video.videoId}: ${err.message}`);
            return null;
          });

        // Segunda checagem, agora com a resposta autoritativa do proprio video.
        // A listagem do canal pode nao ter marcado a estreia (o campo vem de um
        // selo visual da pagina); a consulta individual sempre traz.
        if (original && !podeBaixarAgora(original.liveStatus)) {
          seguramOMarco.add(video.videoId);
          logger.info(
            `Canal "${channel.channel_name}": adiando "${original.title}" - ${motivoDaEspera(original.liveStatus, original.releaseAt)}.`
          );
          continue;
        }

        // Segunda checagem de acesso, agora com a resposta do proprio video: a
        // listagem pode nao ter trazido o campo.
        if (original && !ehPublico(original.availability)) {
          await cadastrarComSelo({ channel, video, title: original.title, seguramOMarco });
          continue;
        }

        const created = await sourceVideosRepository.createIfNotExists({
          youtubeChannelId: channel.id,
          ownerClientUserId: channel.client_user_id,
          youtubeVideoId: video.videoId,
          title: (original && original.title) || video.title,
          thumbnailUrl: video.thumbnailUrl,
          // A listagem flat (video.publishedAt) vem sempre null - so a consulta
          // individual do video (original.publishedAt) traz a data de verdade.
          // Ate agora essa data ja vinha buscada aqui em cima so pro titulo, e
          // era jogada fora na hora de gravar - nenhum video detectado
          // automaticamente aparecia com data nenhuma na tela.
          publishedAt: (original && original.publishedAt) || video.publishedAt,
          durationSeconds: video.durationSeconds,
        });

        if (!created) continue; // ja conhecido, nada a fazer

        logger.info(`Novo video detectado: "${created.title}" (canal ${channel.channel_name}).`);
        await boss.send(QUEUE_VIDEO_PROCESSING, { sourceVideoId: created.id }, { priority });
        enfileirados += 1;
        if (enfileirados === MAX_VIDEOS_POR_CHECAGEM) {
          logger.warn(
            `Canal "${channel.channel_name}": teto de ${MAX_VIDEOS_POR_CHECAGEM} videos por checagem atingido. ` +
              `O que sobrou fica pra proxima checagem - se isso se repetir, tem algo errado na deteccao.`
          );
        }
      }

      // O marco d'agua so pode avancar ate o video mais recente que NAO ficou
      // pra depois nem sobre um video que ainda nao e publico. Passar por cima
      // de uma estreia adiada seria perde-la pra
      // sempre: quando ela finalmente for ao ar, ja estara "abaixo" do marco e
      // ninguem mais vai olhar pra ela. Foi exatamente assim que um video da
      // conta risestyle sumiu em 27/08/2026.
      //
      // videos[] vem do mais novo pro mais velho, entao o primeiro que nao foi
      // adiado e o marco certo. Se TODOS foram adiados, lastVideoId nulo
      // preserva o marco atual (e ainda registra que a checagem aconteceu).
      //
      // As duas condicoes de disponibilidade valem aqui pelo mesmo motivo da
      // ancoragem inicial: estreia e video de membros nao servem de marco. O
      // marco passaria por cima deles e, quando abrissem, ja estariam "abaixo"
      // e ninguem mais olharia.
      const marco = videos.find(
        (v) => !seguramOMarco.has(v.videoId) && podeBaixarAgora(v.liveStatus) && ehPublico(v.availability)
      );
      await youtubeChannelsRepository.updatePollState(channel.id, { lastVideoId: marco ? marco.videoId : null });
      // Voltou a funcionar: fecha o erro sozinho, pra lista do painel nao
      // encher de problema que ja passou.
      await errorReportService.clear(errorReportService.OPERACOES.CHANNEL_CHECK, 'youtube_channel', channel.id);
    } catch (err) {
      logger.error(`Falha ao checar o canal "${channel.channel_name}" (id ${channel.id}):`, err.message);
      // Grava a falha no proprio canal. Antes isso ia so pro log do servidor, e
      // um canal podia passar dias sem ser checado sem ninguem perceber.
      await youtubeChannelsRepository
        .markCheckFailed(channel.id, err.message)
        .catch((e) => logger.error(`Nao consegui registrar a falha do canal ${channel.id}:`, e.message));
      await errorReportService.report({
        operation: errorReportService.OPERACOES.CHANNEL_CHECK,
        entityType: 'youtube_channel',
        entityId: channel.id,
        clientUserId: channel.client_user_id,
        error: err,
      });
    }
  }
}

module.exports = { run, MAX_VIDEOS_POR_CHECAGEM };
