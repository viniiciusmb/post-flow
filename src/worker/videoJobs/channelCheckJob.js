// Checa os canais do YouTube cadastrados, cadastra os videos novos que
// encontrar e manda cada um pra fila de processamento.
'use strict';

const youtubeChannelsRepository = require('../../repositories/youtubeChannelsRepository');
const sourceVideosRepository = require('../../repositories/sourceVideosRepository');
const ytDlpService = require('../../services/ytDlpService');
const queuePriorityService = require('../../services/queuePriorityService');
const postingsRepository = require('../../repositories/postingsRepository');
const errorReportService = require('../../services/errorReportService');
const { podeBaixarAgora, motivoDaEspera } = require('../../lib/disponibilidadeDoVideo');
const logger = require('../../lib/logger');

const QUEUE_VIDEO_PROCESSING = 'video-processing';

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

      let newVideos;
      if (!channel.last_video_id) {
        // Primeira checagem desse canal (ou acabou de ser retomado depois
        // de pausado): so estabelece o marco d'agua no video mais recente
        // de agora - nao enfileira nada do historico/acumulado da pausa.
        newVideos = [];
      } else {
        const knownIndex = videos.findIndex((v) => v.videoId === channel.last_video_id);
        // Marco d'agua nao aparece mais entre os ultimos 15 (canal
        // publicou mais que isso entre um poll e outro) - processa a lista
        // toda; createIfNotExists ja descarta qualquer um que porventura
        // ja tenha sido visto antes, entao nao ha risco de duplicar.
        newVideos = knownIndex === -1 ? videos : videos.slice(0, knownIndex);
      }

      // Do mais antigo pro mais novo, pra entrar na fila em ordem
      // cronologica (e pro video mais recente, no fim do loop, virar o
      // novo marco d'agua).
      const priority = await queuePriorityService.resolveQueuePriorityForClient(channel.client_user_id);
      // Estreias/lives que ficaram pra depois. O marco d'agua NAO pode passar
      // por cima delas - ver logo abaixo do loop.
      const adiados = new Set();
      for (const video of [...newVideos].reverse()) {
        // Ja conhecido: nao gasta consulta nenhuma com ele. Sem essa checagem,
        // um marco d'agua segurado por uma estreia (ver adiados) faria o
        // sistema reconsultar os mesmos videos a cada 20 minutos, pra sempre.
        const jaConhecido = await sourceVideosRepository.findByYoutubeVideoIdForOwner(
          video.videoId,
          channel.client_user_id
        );
        if (jaConhecido) continue;

        // A listagem ja costuma dizer que e estreia/live. Quando diz, nem
        // precisamos consultar o video (que, nesse caso, e a consulta mais
        // cara: o yt-dlp tenta achar formato e nao acha).
        if (!podeBaixarAgora(video.liveStatus)) {
          adiados.add(video.videoId);
          logger.info(
            `Canal "${channel.channel_name}": adiando "${video.title}" - ${motivoDaEspera(video.liveStatus, null)}.`
          );
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
          adiados.add(video.videoId);
          logger.info(
            `Canal "${channel.channel_name}": adiando "${original.title}" - ${motivoDaEspera(original.liveStatus, original.releaseAt)}.`
          );
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
      }

      // O marco d'agua so pode avancar ate o video mais recente que NAO ficou
      // pra depois. Passar por cima de uma estreia adiada seria perde-la pra
      // sempre: quando ela finalmente for ao ar, ja estara "abaixo" do marco e
      // ninguem mais vai olhar pra ela. Foi exatamente assim que um video da
      // conta risestyle sumiu em 27/08/2026.
      //
      // videos[] vem do mais novo pro mais velho, entao o primeiro que nao foi
      // adiado e o marco certo. Se TODOS foram adiados, lastVideoId nulo
      // preserva o marco atual (e ainda registra que a checagem aconteceu).
      //
      // A segunda condicao cobre a PRIMEIRA checagem do canal, que nao passa
      // pelo loop acima (ela so estabelece o marco, sem enfileirar nada do
      // historico): sem ela, um canal cadastrado enquanto uma estreia esta
      // marcada nasceria com o marco em cima da estreia - e o primeiro video
      // que esse cliente veria seria o SEGUNDO do canal.
      const marco = videos.find((v) => !adiados.has(v.videoId) && podeBaixarAgora(v.liveStatus));
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

module.exports = { run };
