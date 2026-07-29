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
const ytDlpService = require('../../services/ytDlpService');
const videoEditingService = require('../../services/videoEditingService');
const openaiTranscriptionService = require('../../services/openaiTranscriptionService');
const claudeClipSelectionService = require('../../services/claudeClipSelectionService');

async function run(sourceVideoId) {
  const sourceVideo = await sourceVideosRepository.findById(sourceVideoId);
  if (!sourceVideo) return;

  const workDir = path.join(config.videoProcessing.workDir, String(sourceVideo.id));

  try {
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
    });
    fs.unlinkSync(audioPath);

    await sourceVideosRepository.updateStatus(sourceVideo.id, 'selecting_clips');
    const selected = await claudeClipSelectionService.selectClips(transcript.words);
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
    const channel = await youtubeChannelsRepository.findById(sourceVideo.youtube_channel_id);
    const tiktokAccount = await tiktokAccountsRepository.findActiveByClientId(channel.client_user_id);

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
        });
        const fileSizeBytes = fs.statSync(outputPath).size;
        await clipsRepository.saveRenderedFile(clip.id, outputPath);

        // Sem conta TikTok conectada ainda: o corte fica pronto, so nao
        // entra na fila de postagem (nao ha pra onde postar).
        if (tiktokAccount) {
          const video = await videosRepository.createFromClip({
            clipId: clip.id,
            filename: clip.title,
            fileSizeBytes,
          });
          if (video) {
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
