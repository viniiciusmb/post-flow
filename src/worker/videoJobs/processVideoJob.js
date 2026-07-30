// O pipeline inteiro de um video-fonte: baixar (ou usar o arquivo enviado
// por upload), transcrever, a IA escolher os cortes, cortar/reenquadrar/
// legendar cada um, e deixar pronto pra fila de postagem existente. Roda um
// video por vez (ver videoScheduler.js).
'use strict';

const path = require('path');
const fs = require('fs');
const config = require('../../config');
const logger = require('../../lib/logger');
const { PausedError } = require('../../lib/errors');
const sourceVideosRepository = require('../../repositories/sourceVideosRepository');
const clipsRepository = require('../../repositories/clipsRepository');
const youtubeChannelsRepository = require('../../repositories/youtubeChannelsRepository');
const videosRepository = require('../../repositories/videosRepository');
const postingsRepository = require('../../repositories/postingsRepository');
const tiktokAccountsRepository = require('../../repositories/tiktokAccountsRepository');
const sourceVideoTiktokTargetsRepository = require('../../repositories/sourceVideoTiktokTargetsRepository');
const clientVideoSettingsRepository = require('../../repositories/clientVideoSettingsRepository');
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
};

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
  const settings = await clientVideoSettingsRepository.findByClientId(clientUserId);
  const checkCancelled = () => isCancelRequested(sourceVideo.id);

  try {
    await sourceVideosRepository.markProcessingStarted(sourceVideo.id);

    let videoPath = sourceVideo.local_video_path;
    if (sourceVideo.input_type === 'upload') {
      // Arquivo ja esta em disco (upload direto) - so confirma que ainda
      // existe (pasta compartilhada, mas por seguranca).
      if (!videoPath || !fs.existsSync(videoPath)) {
        throw new Error('Arquivo enviado nao foi encontrado no servidor.');
      }
      fs.mkdirSync(workDir, { recursive: true });
    } else if (videoPath && fs.existsSync(videoPath)) {
      // Ja baixado numa execucao anterior (retomando de uma pausa) - pula o
      // download de novo.
    } else {
      await sourceVideosRepository.updateStatus(sourceVideo.id, 'downloading');
      videoPath = await ytDlpService.downloadVideo(sourceVideo.youtube_video_id, workDir, { checkCancelled });
      await sourceVideosRepository.saveDownload(sourceVideo.id, videoPath);
    }

    await checkPaused(sourceVideo.id);

    let transcript;
    if (sourceVideo.transcript_words) {
      // Ja transcrito numa execucao anterior (retomando) - reaproveita.
      transcript = {
        text: sourceVideo.transcript_text,
        words: sourceVideo.transcript_words,
        durationSeconds: sourceVideo.whisper_audio_seconds,
      };
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
      });
      fs.unlinkSync(audioPath);
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
        // 'ai_choice': sem numero fixo, so um teto de seguranca (duracao do
        // video / duracao minima de cada corte). 'fixed_count': exatamente
        // settings.max_clips.
        const maxClips =
          settings.clip_mode === 'ai_choice'
            ? Math.max(1, Math.min(30, Math.floor(transcript.durationSeconds / clipLengthPreset.minDuration)))
            : settings.max_clips;

        const selection = await claudeClipSelectionService.selectClips(transcript.words, {
          maxClips,
          minDuration: clipLengthPreset.minDuration,
          maxDuration: clipLengthPreset.maxDuration,
          exact: settings.clip_mode === 'fixed_count',
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

    await checkPaused(sourceVideo.id);
    await sourceVideosRepository.updateStatus(sourceVideo.id, 'cutting');

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

    for (const clip of clips) {
      if (clip.status === 'ready') continue; // ja renderizado antes de pausar
      await checkPaused(sourceVideo.id);
      try {
        await clipsRepository.updateStatus(clip.id, 'rendering');
        const outputPath = path.join(workDir, `clip-${clip.id}.mp4`);
        await videoEditingService.renderClip({
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
        await clipsRepository.updateStatus(clip.id, 'error', { errorMessage: err.message });
      }
    }

    // O video original baixado nao e mais necessario - os cortes ja existem
    // em arquivos proprios. Mantem os cortes em disco (a postagem de verdade
    // ainda vai precisar deles).
    if (fs.existsSync(videoPath)) fs.unlinkSync(videoPath);

    await sourceVideosRepository.updateStatus(sourceVideo.id, 'ready');
  } catch (err) {
    if (err instanceof PausedError) {
      logger.info(`Processamento do video-fonte ${sourceVideo.id} pausado - progresso preservado pra retomar depois.`);
      // Nao apaga workDir nem cancel_requested aqui - o video baixado, a
      // transcricao e os cortes ja renderizados ficam guardados pra retomar
      // sem refazer (ver logica de "ja feito" no topo de cada etapa acima).
      await sourceVideosRepository.updateStatus(sourceVideo.id, 'paused');
      return;
    }
    logger.error(`Falha ao processar o video-fonte ${sourceVideo.id}:`, err);
    await sourceVideosRepository.updateStatus(sourceVideo.id, 'error', { errorMessage: err.message });
  }
}

module.exports = { run };
