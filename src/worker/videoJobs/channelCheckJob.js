// Checa os canais do YouTube cadastrados, cadastra os videos novos que
// encontrar e manda cada um pra fila de processamento.
'use strict';

const youtubeChannelsRepository = require('../../repositories/youtubeChannelsRepository');
const sourceVideosRepository = require('../../repositories/sourceVideosRepository');
const ytDlpService = require('../../services/ytDlpService');
const logger = require('../../lib/logger');

const QUEUE_VIDEO_PROCESSING = 'video-processing';

async function run(boss) {
  const channels = await youtubeChannelsRepository.listActive();

  for (const channel of channels) {
    try {
      const videos = await ytDlpService.listChannelVideos(channel.channel_url, { limit: 15 });
      let newest = channel.last_video_published_at;

      for (const video of videos) {
        const created = await sourceVideosRepository.createIfNotExists({
          youtubeChannelId: channel.id,
          youtubeVideoId: video.videoId,
          title: video.title,
          thumbnailUrl: video.thumbnailUrl,
          publishedAt: video.publishedAt,
          durationSeconds: video.durationSeconds,
        });

        if (!created) continue; // ja conhecido, nada a fazer

        logger.info(`Novo video detectado: "${created.title}" (canal ${channel.channel_name}).`);
        await boss.send(QUEUE_VIDEO_PROCESSING, { sourceVideoId: created.id });

        if (video.publishedAt && (!newest || video.publishedAt > newest)) {
          newest = video.publishedAt;
        }
      }

      await youtubeChannelsRepository.updatePollState(channel.id, { lastVideoPublishedAt: newest });
    } catch (err) {
      logger.error(`Falha ao checar o canal "${channel.channel_name}" (id ${channel.id}):`, err.message);
    }
  }
}

module.exports = { run };
