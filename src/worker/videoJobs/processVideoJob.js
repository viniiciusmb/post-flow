// O pipeline inteiro de um video-fonte: baixar, transcrever, a IA escolher
// os cortes, cortar/reenquadrar/legendar cada um, e deixar pronto pra fila
// de postagem existente. Roda um video por vez (ver videoScheduler.js).
'use strict';

const path = require('path');
const fs = require('fs');
const config = require('../../config');
const logger = require('../../lib/logger');
const sourceVideosRepository = require('../../repositories/sourceVideosRepository');
const clipsRepository = require('../../repositories/clipsRepository');
const youtubeChannelsRepository = require('../../repositories/youtubeChannelsRepository');
const videosRepository = require('../../repositories/videosRepository');
const postingsRepository = require('../../repositories/postingsRepository');
const tiktokAccountsRepository = require('../../repositories/tiktokAccountsRepository');
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

async function run(sourceVideoId) {
  const sourceVideo = await sourceVideosRepository.findById(sourceVideoId);
  if (!sourceVideo) return;

  const workDir = path.join(config.videoProcessing.workDir, String(sourceVideo.id));

  // Video de canal pertence ao cliente dono do canal; video colado manualmente
  // (input_type = 'manual') ja guarda o cliente direto na propria linha.
  const clientUserId = sourceVideo.youtube_channel_id
    ? (await youtubeChannelsRepository.findById(sourceVideo.youtube_channel_id)).client_user_id
    : sourceVideo.client_user_id;
  const settings = await clientVideoSettingsRepository.findByClientId(clientUserId);

  try {
    await sourceVideosRepository.markProcessingStarted(sourceVideo.id);
    await sourceVideosRepository.updateStatus(sourceVideo.id, 'downloading');
    const videoPath = await ytDlpService.downloadVideo(sourceVideo.youtube_video_id, workDir);
    await sourceVideosRepository.saveDownload(sourceVideo.id, videoPath);

    await sourceVideosRepository.updateStatus(sourceVideo.id, 'transcribing');
    const audioPath = path.join(workDir, 'audio.mp3');
    await videoEditingService.extractAudio(videoPath, audioPath);
    const transcript = await openaiTranscriptionService.transcribeAudio(audioPath);
    await sourceVideosRepository.saveTranscript(sourceVideo.id, {
      transcriptText: transcript.text,
      transcriptWords: transcript.words,
      whisperAudioSeconds: transcript.durationSeconds,
      whisperCostUsd: transcript.costUsd,
    });
    fs.unlinkSync(audioPath);

    await sourceVideosRepository.updateStatus(sourceVideo.id, 'selecting_clips');
    const clipLengthPreset = CLIP_LENGTH_PRESETS[settings.clip_length] || CLIP_LENGTH_PRESETS.balanced;

    let selected;
    if (settings.clip_mode === 'full_video') {
      // Video inteiro vira um unico corte - sem IA escolhendo trecho, sem
      // custo de Claude.
      selected = [{ title: sourceVideo.title, startSeconds: 0, endSeconds: transcript.durationSeconds }];
    } else {
      // 'unlimited': sem teto fixo, so limitado pelo quanto de corte cabe no
      // video (duracao do video / duracao minima de cada corte).
      const maxClips =
        settings.clip_mode === 'unlimited'
          ? Math.max(1, Math.min(30, Math.floor(transcript.durationSeconds / clipLengthPreset.minDuration)))
          : settings.max_clips;

      const selection = await claudeClipSelectionService.selectClips(transcript.words, {
        maxClips,
        minDuration: clipLengthPreset.minDuration,
        maxDuration: clipLengthPreset.maxDuration,
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
    const clips = await clipsRepository.createMany(
      sourceVideo.id,
      selected.map((c) => ({ title: c.title, startSeconds: c.startSeconds, endSeconds: c.endSeconds }))
    );

    await sourceVideosRepository.updateStatus(sourceVideo.id, 'cutting');
    const tiktokAccount = await tiktokAccountsRepository.findActiveByClientId(clientUserId);

    for (const clip of clips) {
      try {
        await clipsRepository.updateStatus(clip.id, 'rendering');
        const outputPath = path.join(workDir, `clip-${clip.id}.mp4`);
        await videoEditingService.renderClip({
          videoPath,
          startSeconds: Number(clip.start_seconds),
          endSeconds: Number(clip.end_seconds),
          words: transcript.words,
          outputPath,
          settings,
        });
        const fileSizeBytes = fs.statSync(outputPath).size;
        await clipsRepository.saveRenderedFile(clip.id, outputPath);

        // Sem conta TikTok conectada, o corte fica pronto mas nao vira
        // "video" postavel. Com conta conectada, sempre vira video - mas so
        // entra na fila de postagem se o cliente tiver ligado "postar
        // automaticamente" (auto_post_enabled, desligado por padrao).
        if (tiktokAccount) {
          const video = await videosRepository.createFromClip({
            clipId: clip.id,
            filename: clip.title,
            fileSizeBytes,
          });
          if (video && tiktokAccount.auto_post_enabled) {
            await postingsRepository.createIfNotExists({ videoId: video.id, tiktokAccountId: tiktokAccount.id });
          }
        }
      } catch (err) {
        logger.error(`Falha ao renderizar o corte ${clip.id}:`, err);
        await clipsRepository.updateStatus(clip.id, 'error', { errorMessage: err.message });
      }
    }

    // O video original baixado nao e mais necessario - os cortes ja existem
    // em arquivos proprios. Mantem os cortes em disco (a postagem de verdade
    // ainda vai precisar deles).
    fs.unlinkSync(videoPath);

    await sourceVideosRepository.updateStatus(sourceVideo.id, 'ready');
  } catch (err) {
    logger.error(`Falha ao processar o video-fonte ${sourceVideo.id}:`, err);
    await sourceVideosRepository.updateStatus(sourceVideo.id, 'error', { errorMessage: err.message });
  }
}

module.exports = { run };
