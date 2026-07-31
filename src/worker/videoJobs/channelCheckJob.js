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
      // A pagina /videos do canal sempre vem do mais novo pro mais velho -
      // usamos isso como marco d'agua por ID em vez de data (a listagem
      // rapida via --flat-playlist nao traz data de upload nenhuma, sempre
      // null, entao comparar por data nunca detectava nada de verdade).
      const videos = await ytDlpService.listChannelVideos(channel.channel_url, { limit: 15 });
      if (videos.length === 0) continue;

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
      for (const video of [...newVideos].reverse()) {
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
      }

      await youtubeChannelsRepository.updatePollState(channel.id, { lastVideoId: videos[0].videoId });
    } catch (err) {
      logger.error(`Falha ao checar o canal "${channel.channel_name}" (id ${channel.id}):`, err.message);
    }
  }
}

module.exports = { run };
