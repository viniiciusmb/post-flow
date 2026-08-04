// Checa os canais do YouTube cadastrados, cadastra os videos novos que
// encontrar e manda cada um pra fila de processamento.
'use strict';

const youtubeChannelsRepository = require('../../repositories/youtubeChannelsRepository');
const sourceVideosRepository = require('../../repositories/sourceVideosRepository');
const ytDlpService = require('../../services/ytDlpService');
const queuePriorityService = require('../../services/queuePriorityService');
const errorReportService = require('../../services/errorReportService');
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
      if (videos.length === 0) {
        // Canal sem video nenhum na listagem. Nao e erro, mas TEM que registrar
        // a tentativa: sem isso a tela mostra a data da ultima checagem que deu
        // certo e parece que o agendamento parou.
        await youtubeChannelsRepository.markCheckFailed(channel.id, 'O canal nao devolveu nenhum video na listagem.');
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
      for (const video of [...newVideos].reverse()) {
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

        const created = await sourceVideosRepository.createIfNotExists({
          youtubeChannelId: channel.id,
          ownerClientUserId: channel.client_user_id,
          youtubeVideoId: video.videoId,
          title: (original && original.title) || video.title,
          thumbnailUrl: video.thumbnailUrl,
          publishedAt: video.publishedAt,
          durationSeconds: video.durationSeconds,
        });

        if (!created) continue; // ja conhecido, nada a fazer

        logger.info(`Novo video detectado: "${created.title}" (canal ${channel.channel_name}).`);
        await boss.send(QUEUE_VIDEO_PROCESSING, { sourceVideoId: created.id }, { priority });
      }

      await youtubeChannelsRepository.updatePollState(channel.id, { lastVideoId: videos[0].videoId });
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
