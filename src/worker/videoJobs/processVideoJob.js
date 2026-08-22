// O pipeline inteiro de um video-fonte: baixar (ou usar o arquivo enviado
// por upload), transcrever, a IA escolher os cortes, cortar/reenquadrar/
// legendar cada um, e deixar pronto pra fila de postagem existente. Roda um
// video por vez (ver videoScheduler.js).
'use strict';

const path = require('path');
const fs = require('fs');
const config = require('../../config');
const errorReportService = require('../../services/errorReportService');
const downloadTunnelsRepository = require('../../repositories/downloadTunnelsRepository');
const logger = require('../../lib/logger');
const { PausedError, AwaitingCreditsError, ChargeFailedError, WaitingForTunnelError } = require('../../lib/errors');
const creditsService = require('../../services/creditsService');
const sourceVideosRepository = require('../../repositories/sourceVideosRepository');
const clipsRepository = require('../../repositories/clipsRepository');
const youtubeChannelsRepository = require('../../repositories/youtubeChannelsRepository');
const videosRepository = require('../../repositories/videosRepository');
const postingsRepository = require('../../repositories/postingsRepository');
const tiktokAccountsRepository = require('../../repositories/tiktokAccountsRepository');
const sourceVideoTiktokTargetsRepository = require('../../repositories/sourceVideoTiktokTargetsRepository');
const clientVideoSettingsRepository = require('../../repositories/clientVideoSettingsRepository');
const sharedVideoAssetsRepository = require('../../repositories/sharedVideoAssetsRepository');
const sharedVideoFiles = require('../../lib/sharedVideoFiles');
const ytDlpService = require('../../services/ytDlpService');
const videoEditingService = require('../../services/videoEditingService');
const openaiTranscriptionService = require('../../services/openaiTranscriptionService');
const claudeClipSelectionService = require('../../services/claudeClipSelectionService');

// "Estilo do corte" escolhido pelo cliente vira duracao min/max pro Claude
// escolher os trechos - ver clientVideoSettingsRepository.
const CLIP_LENGTH_PRESETS = {
  short: { minDuration: 15, maxDuration: 40 },
  balanced: { minDuration: 25, maxDuration: 90 },
  long: { minDuration: 60, maxDuration: 180 },
  // Pedido pra entrevista e podcast, onde 180s corta a resposta no meio.
  extra_long: { minDuration: 180, maxDuration: 240 },
};

// Baixa a capa do video pro disco, pro estilo "thumbnail como template".
//
// Nunca derruba o corte: sem capa (video enviado do computador costuma nao
// ter) ou com o download falhando, devolve null e o videoEditingService cai
// no fundo desfocado. Perder o estilo escolhido e ruim; perder o video
// inteiro por causa de uma imagem seria bem pior.
async function baixarCapaDoVideo(sourceVideo, workDir) {
  if (!sourceVideo.thumbnail_url) {
    logger.warn(`Video ${sourceVideo.id} nao tem capa - o estilo "thumbnail" vai cair no fundo desfocado.`);
    return null;
  }
  const destino = path.join(workDir, `capa-${sourceVideo.id}.jpg`);
  // Ja baixada numa tentativa anterior (retomada depois de pausa/erro): nao
  // baixa de novo.
  if (fs.existsSync(destino)) return destino;

  try {
    const resposta = await fetch(sourceVideo.thumbnail_url, { signal: AbortSignal.timeout(20_000) });
    if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`);
    const bytes = Buffer.from(await resposta.arrayBuffer());
    if (bytes.length === 0) throw new Error('arquivo vazio');
    fs.mkdirSync(workDir, { recursive: true });
    fs.writeFileSync(destino, bytes);
    return destino;
  } catch (err) {
    logger.warn(`Nao consegui baixar a capa do video ${sourceVideo.id} (${err.message}) - caindo no fundo desfocado.`);
    return null;
  }
}

// Tira o video recem-baixado da pasta do source_video e poe na pasta
// compartilhada, para que o proximo cliente que monitore o mesmo canal use o
// MESMO arquivo em vez de baixar de novo.
//
// Nunca derruba o video: se por algum motivo nao der pra mover, segue com o
// arquivo onde ele esta e so perde o compartilhamento. O download ja foi pago
// e ja aconteceu - falhar aqui jogaria fora justamente a parte cara.
function guardarComoCompartilhado(filePath, youtubeVideoId) {
  const destino = sharedVideoFiles.pathFor(youtubeVideoId, path.extname(filePath) || '.mp4');
  fs.mkdirSync(sharedVideoFiles.dir(), { recursive: true });
  try {
    fs.renameSync(filePath, destino);
  } catch (err) {
    // rename nao atravessa sistemas de arquivos (EXDEV). Nao acontece em
    // producao (mesma pasta montada), mas acontece em dev/teste com TMPDIR
    // em outro volume - copia e apaga.
    if (err.code !== 'EXDEV') throw err;
    fs.copyFileSync(filePath, destino);
    fs.rmSync(filePath, { force: true });
  }
  return destino;
}

// Pausa cooperativa: confere a flag entre as etapas principais (e a cada
// corte do loop de renderizacao) e para no proximo checkpoint. Alem disso,
// download/transcricao/renderizacao (as 3 etapas longas) recebem esse mesmo
// checker via callback e conferem a flag periodicamente ENQUANTO rodam
// (matam o processo yt-dlp/ffmpeg ou abortam a chamada da OpenAI na hora) -
// sem isso, pausar so tinha efeito depois que a etapa inteira terminasse
// (podia levar minutos). O trabalho ja feito ate ali (download, transcricao,
// cortes ja renderizados) fica salvo pra retomar depois sem refazer.
async function isCancelRequested(sourceVideoId) {
  const current = await sourceVideosRepository.findById(sourceVideoId);
  return Boolean(current && current.cancel_requested);
}

async function checkPaused(sourceVideoId) {
  if (await isCancelRequested(sourceVideoId)) {
    throw new PausedError('Pausado pelo cliente.');
  }
}

// Sinal de vida: enquanto este job roda, toca processing_heartbeat_at de
// minuto em minuto. E o que permite ao videoStuckRecoveryJob diferenciar
// "video travado porque o worker morreu" de "video demorando porque o video e
// longo" - sem isso, qualquer deteccao por tempo puro correria o risco de
// resetar um video que ainda esta sendo processado de verdade (os deploys sao
// start-first: por alguns minutos o container ANTIGO ainda esta trabalhando).
const HEARTBEAT_MS = 60_000;

function startProcessingHeartbeat(sourceVideoId) {
  const beat = () =>
    sourceVideosRepository.touchProcessingHeartbeat(sourceVideoId).catch((err) => {
      // Uma falha transitoria de banco aqui nao pode derrubar o pipeline: no
      // pior caso o video e considerado travado e retomado do ponto em que
      // parou, que e exatamente o comportamento seguro.
      logger.error(`Falha ao gravar sinal de vida do video ${sourceVideoId} (seguindo):`, err.message);
    });
  const interval = setInterval(beat, HEARTBEAT_MS);
  interval.unref();
  return interval;
}

async function run(sourceVideoId) {
  const sourceVideo = await sourceVideosRepository.findById(sourceVideoId);
  if (!sourceVideo) return;

  // Protecao contra job redelivered pelo pg-boss (ex: o worker caiu/foi
  // reiniciado no meio do processamento, e o pg-boss reenfileira o mesmo
  // job pra tentar de novo). "detected" comeca do zero, "paused" retoma de
  // onde parou (ver logica de pular etapas ja feitas abaixo). Qualquer outro
  // status aqui significa que esse video ja esta em andamento (ou ja
  // terminou) numa execucao anterior - continuar duplicaria os cortes.
  if (!['detected', 'paused'].includes(sourceVideo.status)) {
    logger.info(
      `Video-fonte ${sourceVideo.id} recebeu um job redelivered pelo pg-boss mas ja esta em status "${sourceVideo.status}" - ignorando pra nao duplicar.`
    );
    return;
  }

  const workDir = path.join(config.videoProcessing.workDir, String(sourceVideo.id));

  // Video de canal pertence ao cliente dono do canal; video colado
  // manualmente ou enviado por upload ja guarda o cliente direto na propria
  // linha (input_type 'manual'/'upload').
  const clientUserId = sourceVideo.youtube_channel_id
    ? (await youtubeChannelsRepository.findById(sourceVideo.youtube_channel_id)).client_user_id
    : sourceVideo.client_user_id;
  // Estilo do corte: a excecao do canal manda, se o canal tiver uma; senao vale
  // o padrao do cliente. Video avulso (upload ou link colado) nao tem canal,
  // entao sempre cai no padrao.
  let settings = await clientVideoSettingsRepository.resolveForVideo(
    clientUserId,
    sourceVideo.youtube_channel_id
  );
  const checkCancelled = () => isCancelRequested(sourceVideo.id);
  const heartbeat = startProcessingHeartbeat(sourceVideo.id);

  try {
    await sourceVideosRepository.markProcessingStarted(sourceVideo.id);

    // Cria a pasta de trabalho deste video ANTES de qualquer etapa. Antes,
    // quem a criava era o download (ytDlpService.downloadVideo) - e quando o
    // download passou a poder ser pulado por reaproveitamento, a pasta deixava
    // de existir e o primeiro corte quebrava com ENOENT. A pasta guarda o
    // audio, a capa e os arquivos dos cortes, entao ela e necessaria com ou
    // sem download.
    fs.mkdirSync(workDir, { recursive: true });

    let videoPath = sourceVideo.local_video_path;
    if (sourceVideo.input_type === 'upload') {
      // Arquivo ja esta em disco (upload direto) - so confirma que ainda
      // existe (pasta compartilhada, mas por seguranca).
      if (!videoPath || !fs.existsSync(videoPath)) {
        throw new Error('Arquivo enviado nao foi encontrado no servidor.');
      }
      // Upload nao passa por egress de banda nenhum, mas Whisper/Claude/
      // ffmpeg continuam custando - cobra do bolso normal na hora (sem
      // etapa de download separada, ver creditsService.chargeForUpload).
      const uploadCharge = await creditsService.chargeForUpload(sourceVideo, clientUserId);
      if (uploadCharge.outcome === 'blocked') {
        throw new AwaitingCreditsError('Sem credito disponivel pra processar este upload.');
      }
      if (uploadCharge.outcome === 'charge_failed') {
        throw new ChargeFailedError(uploadCharge.motivo);
      }
    } else if (videoPath && fs.existsSync(videoPath)) {
      // Ja baixado numa execucao anterior (retomando de uma pausa) - pula o
      // download de novo.
    } else {
      // Este MESMO video do YouTube ja foi baixado por outro cliente (dois
      // clientes monitorando o mesmo canal geram dois source_videos para o
      // mesmo video) e o arquivo ainda esta em disco? Entao nao ha nada pra
      // baixar - e o mesmo arquivo, byte por byte.
      const compartilhado = await sharedVideoAssetsRepository.findByYoutubeVideoId(sourceVideo.youtube_video_id);
      const reaproveitavel =
        compartilhado && compartilhado.local_video_path && fs.existsSync(compartilhado.local_video_path)
          ? compartilhado
          : null;

      // O cliente pode ter pedido pra so baixar com o computador dele ligado.
      // Conferir ANTES de cobrar credito: cobrar e depois descobrir que nao da
      // pra baixar deixaria o credito reservado a toa.
      //
      // Com reaproveitamento nao ha download nenhum pra fazer, entao exigir o
      // computador ligado so seguraria a fila do cliente por um download que
      // nao vai acontecer - e a internet dele nao seria usada de qualquer jeito.
      if (!reaproveitavel) {
        const politica = await downloadTunnelsRepository.clientTunnelPolicy(clientUserId);
        if (politica.exige && !politica.conectado) {
          throw new WaitingForTunnelError(
            'O cliente escolheu baixar so pela internet dele, e o computador dele nao esta conectado agora.'
          );
        }
      }

      // Reserva o credito ANTES de baixar - se nao houver saldo (e sem
      // cartao de excedente ligado), nao inicia o download nenhum.
      //
      // Vale igual no reaproveitamento: o cliente paga o mesmo que pagaria se
      // o video tivesse sido baixado pra ele. A economia do reaproveitamento e
      // de custo nosso (banda e Whisper), nao um desconto no preco dele.
      const reserveOutcome = await creditsService.reserveBeforeDownload(sourceVideo, clientUserId);
      if (reserveOutcome.outcome === 'blocked') {
        throw new AwaitingCreditsError('Sem credito disponivel pra baixar este video.');
      }
      // Cartao recusado: nada foi processado ainda, entao o video so espera.
      // Cobrar ANTES e o que garante isso - se a cobranca fosse depois, o custo
      // do download e da IA ja teria sido gasto sem como recuperar.
      if (reserveOutcome.outcome === 'charge_failed') {
        throw new ChargeFailedError(reserveOutcome.motivo);
      }

      if (reaproveitavel) {
        videoPath = reaproveitavel.local_video_path;
        // egress 'reuse' com 0 bytes e a verdade literal: nenhuma banda saiu
        // por este video. E assim que o painel "Banda" mostra a economia.
        await sourceVideosRepository.saveDownload(sourceVideo.id, videoPath, {
          bytes: 0,
          egressType: 'reuse',
          tunnelId: null,
        });
        await sharedVideoAssetsRepository.registerDownloadReuse(sourceVideo.youtube_video_id);
        await creditsService.confirmAfterDownload(sourceVideo, clientUserId, reserveOutcome, {
          egressType: 'reuse',
          tunnelId: null,
        });
        logger.info(
          `Video-fonte ${sourceVideo.id}: download reaproveitado do arquivo ja baixado para ${sourceVideo.youtube_video_id} - nenhuma banda gasta.`
        );
      } else {
        await sourceVideosRepository.updateStatus(sourceVideo.id, 'downloading');
        const downloadResult = await ytDlpService.downloadVideo(sourceVideo.youtube_video_id, workDir, { checkCancelled, clientUserId });

        // Tamanho real do arquivo baixado = consumo de banda de verdade pra
        // essa origem (tunel do cliente/founder ou proxy) - alimenta o painel
        // "Banda" (custo/margem).
        const downloadBytes = fs.statSync(downloadResult.filePath).size;

        // Guarda numa pasta compartilhada pra que o proximo cliente que
        // monitore o mesmo canal reaproveite este arquivo em vez de baixar
        // tudo de novo.
        let compartilhou = true;
        try {
          videoPath = guardarComoCompartilhado(downloadResult.filePath, sourceVideo.youtube_video_id);
        } catch (err) {
          logger.error(
            `Nao consegui mover o video ${sourceVideo.id} pra pasta compartilhada (seguindo sem compartilhar):`,
            err
          );
          videoPath = downloadResult.filePath;
          compartilhou = false;
        }

        await sourceVideosRepository.saveDownload(sourceVideo.id, videoPath, {
          bytes: downloadBytes,
          egressType: downloadResult.egressType,
          tunnelId: downloadResult.tunnelId,
        });
        if (compartilhou) {
          await sharedVideoAssetsRepository.saveDownload(sourceVideo.youtube_video_id, {
            localVideoPath: videoPath,
            bytes: downloadBytes,
            egressType: downloadResult.egressType,
            tunnelId: downloadResult.tunnelId,
          });
        }
        // Download terminou com sucesso - confirma a cobranca (ou fatura de
        // excedente) definitiva agora que o caminho real de egress e conhecido.
        await creditsService.confirmAfterDownload(sourceVideo, clientUserId, reserveOutcome, downloadResult);
      }
    }

    await checkPaused(sourceVideo.id);

    let transcript;
    if (sourceVideo.transcript_words) {
      // Ja transcrito numa execucao anterior (retomando) - reaproveita.
      transcript = {
        text: sourceVideo.transcript_text,
        words: sourceVideo.transcript_words,
        durationSeconds: sourceVideo.whisper_audio_seconds,
        // Vem do banco: retomar um video pausado nao roda a transcricao de
        // novo, entao o idioma tem que sobreviver fora da memoria.
        language: sourceVideo.transcript_language,
      };
    } else {
      // Mesma ideia do download: a transcricao do MESMO video do YouTube e
      // identica para todo cliente, entao o Whisper so roda na primeira vez.
      // A partir daqui tudo volta a ser individual - a IA que escolhe os
      // trechos, o corte, a legenda e o titulo seguem a configuracao de cada
      // cliente.
      //
      // A transcricao guardada dura MUITO mais que o arquivo de video: mesmo
      // depois do arquivo ser apagado do disco, um cliente que adicionar o
      // canal semanas depois baixa o video de novo mas nao paga o Whisper.
      const compartilhado = await sharedVideoAssetsRepository.findByYoutubeVideoId(sourceVideo.youtube_video_id);

      if (compartilhado && compartilhado.transcript_words) {
        transcript = {
          text: compartilhado.transcript_text,
          words: compartilhado.transcript_words,
          // NUMERIC volta do Postgres como string - sem o Number() a duracao
          // entraria como texto nas contas de quantos cortes cabem no video.
          durationSeconds:
            compartilhado.whisper_audio_seconds === null ? null : Number(compartilhado.whisper_audio_seconds),
          language: compartilhado.transcript_language,
        };
        await sourceVideosRepository.saveTranscript(sourceVideo.id, {
          transcriptText: transcript.text,
          transcriptWords: transcript.words,
          whisperAudioSeconds: transcript.durationSeconds,
          // Zero e o custo real desta vez: o Whisper nao foi chamado.
          whisperCostUsd: 0,
          language: transcript.language,
          reused: true,
        });
        await sharedVideoAssetsRepository.registerTranscriptReuse(sourceVideo.youtube_video_id);
        logger.info(
          `Video-fonte ${sourceVideo.id}: transcricao reaproveitada de ${sourceVideo.youtube_video_id} - Whisper nao foi chamado.`
        );
      } else {
        await sourceVideosRepository.updateStatus(sourceVideo.id, 'transcribing');
        const audioPath = path.join(workDir, 'audio.mp3');
        await videoEditingService.extractAudio(videoPath, audioPath);
        transcript = await openaiTranscriptionService.transcribeAudio(audioPath, { checkCancelled });
        await sourceVideosRepository.saveTranscript(sourceVideo.id, {
          transcriptText: transcript.text,
          transcriptWords: transcript.words,
          whisperAudioSeconds: transcript.durationSeconds,
          whisperCostUsd: transcript.costUsd,
          language: transcript.language,
        });
        // Video avulso enviado do computador nao tem youtube_video_id, entao
        // nao ha o que compartilhar (nao existe "o mesmo video" pra outro
        // cliente).
        if (sourceVideo.youtube_video_id) {
          await sharedVideoAssetsRepository.saveTranscript(sourceVideo.youtube_video_id, {
            transcriptText: transcript.text,
            transcriptWords: transcript.words,
            whisperAudioSeconds: transcript.durationSeconds,
            whisperCostUsd: transcript.costUsd,
            language: transcript.language,
          });
        }
        fs.unlinkSync(audioPath);
      }
    }

    await checkPaused(sourceVideo.id);

    let clips = await clipsRepository.listBySourceVideoId(sourceVideo.id);
    if (clips.length === 0) {
      await sourceVideosRepository.updateStatus(sourceVideo.id, 'selecting_clips');
      const clipLengthPreset = CLIP_LENGTH_PRESETS[settings.clip_length] || CLIP_LENGTH_PRESETS.balanced;

      let selected;
      if (settings.clip_mode === 'full_video') {
        // Video inteiro vira um unico corte - sem IA escolhendo trecho, sem
        // custo de Claude.
        selected = [{ title: sourceVideo.title, description: null, startSeconds: 0, endSeconds: transcript.durationSeconds }];
      } else {
        // 'fixed_count': exatamente settings.max_clips.
        //
        // 'ai_choice': a IA decide QUANTOS trechos bons existem, mas nunca
        // passa do que o cliente pediu. Antes o numero dele era ignorado neste
        // modo e o teto era so a conta "duracao / duracao minima do corte" -
        // um video de uma hora virava 20 e poucos cortes sem ninguem ter
        // pedido, gastando IA e enchendo a fila de publicacao.
        const tetoPelaDuracao = Math.max(
          1,
          Math.min(30, Math.floor(transcript.durationSeconds / clipLengthPreset.minDuration))
        );
        const maxClips =
          settings.clip_mode === 'ai_choice'
            ? Math.min(settings.max_clips, tetoPelaDuracao)
            : settings.max_clips;

        const selection = await claudeClipSelectionService.selectClips(transcript.words, {
          maxClips,
          minDuration: clipLengthPreset.minDuration,
          maxDuration: clipLengthPreset.maxDuration,
          exact: settings.clip_mode === 'fixed_count',
          // Sem isto, a IA escrevia titulo e legenda em ingles mesmo em video
          // falado em portugues.
          language: transcript.language,
        });
        await sourceVideosRepository.saveClaudeUsage(sourceVideo.id, {
          inputTokens: selection.inputTokens,
          outputTokens: selection.outputTokens,
          costUsd: selection.costUsd,
        });
        selected = selection.clips;
      }

      if (selected.length === 0) {
        await sourceVideosRepository.updateStatus(sourceVideo.id, 'error', {
          errorMessage: 'A IA nao encontrou nenhum trecho adequado nesse video.',
        });
        return;
      }

      // A IA as vezes devolve trecho que nao existe: no video-fonte 1900 (42
      // minutos) vieram 4 trechos comecando depois dos 8 HORAS. Renderizar
      // isso gera corte vazio ou quebrado, que o cliente so descobre ao abrir
      // - e no TikTok o arquivo e recusado. Melhor perder o trecho invalido
      // do que entregar um corte que nao presta.
      const duracaoReal = Number(transcript.durationSeconds) || Number(sourceVideo.duration_seconds) || 0;
      if (duracaoReal > 0) {
        const antes = selected.length;
        selected = selected.filter((c) => Number(c.startSeconds) < duracaoReal);
        if (selected.length !== antes) {
          logger.warn(
            `Video-fonte ${sourceVideo.id}: ${antes - selected.length} trecho(s) descartado(s) por comecarem depois do fim do video (${Math.round(duracaoReal)}s).`
          );
        }
        // Trecho que passa do fim e cortado no fim, em vez de descartado: o
        // comeco dele e valido e costuma ser o melhor pedaco.
        selected = selected.map((c) =>
          Number(c.endSeconds) > duracaoReal ? { ...c, endSeconds: duracaoReal } : c
        );
        selected = selected.filter((c) => Number(c.endSeconds) - Number(c.startSeconds) >= 5);
      }

      if (selected.length === 0) {
        await sourceVideosRepository.updateStatus(sourceVideo.id, 'error', {
          errorMessage: 'A IA nao encontrou nenhum trecho adequado nesse video.',
        });
        return;
      }

      // Descricao: 'auto' usa a que a IA ja sugeriu por corte, 'fixed' troca
      // todas pelo mesmo texto do cliente, 'none' deixa em branco.
      clips = await clipsRepository.createMany(
        sourceVideo.id,
        selected.map((c) => ({
          title: c.title,
          startSeconds: c.startSeconds,
          endSeconds: c.endSeconds,
          description:
            settings.description_mode === 'fixed'
              ? settings.description_template
              : settings.description_mode === 'none'
                ? null
                : c.description || null,
        }))
      );
    }
    // Uma fonte de ordem so: o banco, sempre por tempo. Vale pros dois
    // caminhos (cortes recem-criados e cortes de um video retomado), pra nao
    // existir a chance de um deles renderizar numa ordem e o outro noutra.
    clips = await clipsRepository.listBySourceVideoId(sourceVideo.id);
    await sourceVideosRepository.markClipSelectionCompleted(sourceVideo.id);

    await checkPaused(sourceVideo.id);
    await sourceVideosRepository.updateStatus(sourceVideo.id, 'cutting');

    // Recarrega as configuracoes agora, na hora de cortar de verdade - o
    // download+transcricao+selecao de trechos pode levar bastante tempo
    // (as vezes 10+ minutos num video longo), e se o cliente mudar o estilo
    // de legenda/titulo nesse meio tempo, o corte tinha saido com o estilo
    // ANTIGO (o que estava valendo quando o job comecou), nao o que aparece
    // selecionado na tela agora. Sem isso era exatamente o bug reportado:
    // "escolhi uma legenda e saiu outra parecida, com cor errada".
    settings = await clientVideoSettingsRepository.resolveForVideo(
      clientUserId,
      sourceVideo.youtube_channel_id
    );

    // Canal do YouTube posta numa unica conta (a vinculada a ele); video
    // avulso (upload/link colado) pode ir pra varias, escolhidas pelo
    // cliente no momento do envio (source_video_tiktok_targets).
    let tiktokAccounts;
    if (sourceVideo.youtube_channel_id) {
      const channel = await youtubeChannelsRepository.findById(sourceVideo.youtube_channel_id);
      const account = channel.tiktok_account_id ? await tiktokAccountsRepository.findById(channel.tiktok_account_id) : null;
      tiktokAccounts = account ? [account] : [];
    } else {
      const accountIds = await sourceVideoTiktokTargetsRepository.listBySourceVideoId(sourceVideo.id);
      tiktokAccounts = (await Promise.all(accountIds.map((id) => tiktokAccountsRepository.findById(id)))).filter(Boolean);
    }

    // Capa do video pro estilo "thumbnail como template". Baixada UMA vez pro
    // video inteiro, nao por corte: e o mesmo arquivo pros N cortes, e baixar
    // de novo a cada um seria N requisicoes iguais.
    const thumbnailImagePath =
      settings.background_style === 'thumbnail'
        ? await baixarCapaDoVideo(sourceVideo, workDir)
        : null;

    for (const clip of clips) {
      if (clip.status === 'ready') continue; // ja renderizado antes de pausar
      await checkPaused(sourceVideo.id);
      try {
        await clipsRepository.updateStatus(clip.id, 'rendering');
        const outputPath = path.join(workDir, `clip-${clip.id}.mp4`);
        await videoEditingService.renderClip({
          thumbnailImagePath,
          videoPath,
          startSeconds: Number(clip.start_seconds),
          endSeconds: Number(clip.end_seconds),
          words: transcript.words,
          title: clip.title,
          outputPath,
          settings,
          checkCancelled,
          partIndex: clips.indexOf(clip) + 1,
          partTotal: clips.length,
          // Fogo-e-esqueça de proposito (nao pode travar o poll do ffmpeg
          // esperando o banco) - mas com .catch, senao um erro transitorio de
          // escrita vira unhandled rejection e derruba o video-worker inteiro.
          onProgress: (percent) => {
            clipsRepository.updateRenderProgress(clip.id, percent).catch((err) => {
              logger.error(`Falha ao salvar progresso do corte ${clip.id} (seguindo o render):`, err);
            });
          },
        });

        const thumbnailPath = outputPath.replace(/\.mp4$/, '.jpg');
        try {
          await videoEditingService.extractThumbnail(outputPath, thumbnailPath);
        } catch (thumbErr) {
          logger.error(`Falha ao gerar capa do corte ${clip.id} (seguindo sem capa):`, thumbErr);
        }

        const fileSizeBytes = fs.statSync(outputPath).size;
        await clipsRepository.saveRenderedFile(clip.id, outputPath, fs.existsSync(thumbnailPath) ? thumbnailPath : null);

        // Sem conta TikTok vinculada, o corte fica pronto mas nao vira
        // "video" postavel. Com 1+ contas vinculadas, sempre vira video -
        // mas so entra na fila de postagem de cada conta que tiver "postar
        // automaticamente" ligado (auto_post_enabled, desligado por padrao).
        if (tiktokAccounts.length > 0) {
          const video = await videosRepository.createFromClip({
            clipId: clip.id,
            filename: clip.title,
            fileSizeBytes,
          });
          if (video) {
            for (const tiktokAccount of tiktokAccounts) {
              if (!tiktokAccount.auto_post_enabled) continue;
              await postingsRepository.createIfNotExists({
                videoId: video.id,
                tiktokAccountId: tiktokAccount.id,
                caption: clip.description,
              });
            }
          }
        }
      } catch (err) {
        // Corte interrompido por pausa (nao e falha de verdade) - deixa o
        // status como estava (ainda 'rendering'/'pending') e propaga pro
        // catch de fora, que trata a pausa do video inteiro. Sem esse
        // desvio, toda pausa durante o render marcava o corte como erro.
        if (err instanceof PausedError) throw err;
        logger.error(`Falha ao renderizar o corte ${clip.id}:`, err);
        await clipsRepository.updateStatus(clip.id, 'error', { errorMessage: null });
        await errorReportService.report({
          operation: errorReportService.OPERACOES.VIDEO_PROCESSING,
          entityType: 'clip',
          entityId: clip.id,
          clientUserId: sourceVideo.owner_client_user_id || sourceVideo.client_user_id || null,
          error: err,
        });
      }
    }

    // O video original baixado nao e mais necessario PRA ESTE cliente - os
    // cortes ja existem em arquivos proprios. Mantem os cortes em disco (a
    // postagem de verdade ainda vai precisar deles).
    //
    // Se o arquivo e compartilhado, quem apaga e o sharedAssetsCleanupJob,
    // quando ninguem mais precisar dele. Apagar aqui devolveria exatamente o
    // problema que o compartilhamento resolve: o proximo cliente do mesmo
    // canal baixaria tudo de novo.
    if (!sharedVideoFiles.isShared(videoPath) && fs.existsSync(videoPath)) fs.unlinkSync(videoPath);

    await sourceVideosRepository.updateStatus(sourceVideo.id, 'ready');
  } catch (err) {
    if (err instanceof PausedError) {
      logger.info(`Processamento do video-fonte ${sourceVideo.id} pausado - progresso preservado pra retomar depois.`);
      // Nao apaga workDir nem cancel_requested aqui - o video baixado, a
      // transcricao e os cortes ja renderizados ficam guardados pra retomar
      // sem refazer (ver logica de "ja feito" no topo de cada etapa acima).
      // O credito (se ja reservado) tambem fica reservado - retomar nao deve
      // cobrar de novo nem devolver o credito por ter pausado.
      await sourceVideosRepository.updateStatus(sourceVideo.id, 'paused');
      return;
    }
    if (err instanceof AwaitingCreditsError) {
      logger.info(`Video-fonte ${sourceVideo.id} aguardando credito - ${err.message}`);
      await sourceVideosRepository.updateStatus(sourceVideo.id, 'aguardando_creditos', {
        billingBlockReason: 'sem_credito',
      });
      return;
    }
    if (err instanceof WaitingForTunnelError) {
      logger.info(`Video-fonte ${sourceVideo.id} esperando o computador do cliente - ${err.message}`);
      // Nao e erro: nao vai pro painel de erros e nao conta como falha. O
      // tunnelTestJob devolve pra fila quando o computador voltar.
      await sourceVideosRepository.updateStatus(sourceVideo.id, 'aguardando_conexao');
      return;
    }
    if (err instanceof ChargeFailedError) {
      logger.warn(`Video-fonte ${sourceVideo.id} parado: cobranca recusada - ${err.message}`);
      await sourceVideosRepository.updateStatus(sourceVideo.id, 'aguardando_creditos', {
        billingBlockReason: 'cobranca_falhou',
      });
      // Vai pro painel de erros do admin com o motivo tecnico da recusa; o
      // cliente ve so "nao consegui cobrar seu cartao".
      await errorReportService.report({
        operation: errorReportService.OPERACOES.CREDIT_CHARGE,
        entityType: 'source_video',
        entityId: sourceVideo.id,
        clientUserId,
        error: err,
      });
      return;
    }
    // Download nao chegou a completar (ou qualquer outra falha antes da
    // confirmacao) - libera o credito reservado, se houver (sem-op se ja
    // tinha sido confirmado ou nunca reservado, ver releaseIfReserved).
    await creditsService.releaseIfReserved(sourceVideo.id);
    logger.error(`Falha ao processar o video-fonte ${sourceVideo.id}:`, err);
    // A mensagem tecnica nao vai mais pra tela do cliente - ela vive no painel
    // de erros do admin. O cliente ve so que o video falhou e pode tentar de
    // novo; a causa e assunto de quem conserta.
    await sourceVideosRepository.updateStatus(sourceVideo.id, 'error', { errorMessage: null });
    await errorReportService.report({
      operation: errorReportService.OPERACOES.VIDEO_PROCESSING,
      entityType: 'source_video',
      entityId: sourceVideo.id,
      clientUserId: sourceVideo.owner_client_user_id || sourceVideo.client_user_id || null,
      error: err,
    });
  } finally {
    // Sempre para o sinal de vida - inclusive nos returns antecipados de
    // pausa/credito. Um interval esquecido continuaria dizendo que o video
    // esta sendo processado depois do job ter acabado.
    clearInterval(heartbeat);
  }
}

module.exports = { run };
