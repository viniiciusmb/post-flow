// Ressuscita video preso numa etapa "em andamento" cujo worker morreu.
//
// Aconteceu 3x em 01/08/2026 (videos #988, #1838, #1683) e sempre precisou de
// UPDATE manual no banco: o video-worker cai/e reiniciado no meio do
// processamento e a linha fica em 'downloading'/'cutting' pra sempre.
//
// A deteccao NAO e por tempo puro. Os deploys usam start-first (o container
// novo sobe antes do antigo desligar), entao um video "ha 40 minutos em
// cutting" pode estar sendo processado normalmente pelo container antigo -
// reseta-lo corromperia o corte. O que decide e o sinal de vida
// (processing_heartbeat_at, tocado a cada 60s pelo processVideoJob): so quem
// parou de bater ha varios minutos esta morto de verdade.
//
// Ressuscitar sai barato porque o pipeline e retomavel: volta pra 'detected' e
// o proximo processamento pula download/transcricao/cortes ja concluidos.
'use strict';

const logger = require('../../lib/logger');
const sourceVideosRepository = require('../../repositories/sourceVideosRepository');
const youtubeChannelsRepository = require('../../repositories/youtubeChannelsRepository');
const queueService = require('../../services/queueService');
const queuePriorityService = require('../../services/queuePriorityService');

const QUEUE_VIDEO_PROCESSING = 'video-processing';

// Mesma logica de posse do processVideoJob/videoErrorRetryJob: video de canal
// pertence ao cliente dono do canal, video avulso/upload guarda o cliente
// direto na propria linha.
async function resolveClientId(sourceVideo) {
  if (!sourceVideo.youtube_channel_id) return sourceVideo.client_user_id;
  const channel = await youtubeChannelsRepository.findById(sourceVideo.youtube_channel_id);
  return channel ? channel.client_user_id : null;
}

// 10 minutos = 10x o intervalo do heartbeat. Margem grande de proposito: o
// custo de esperar mais um pouco e baixo, o custo de resetar um video vivo e
// alto (corte corrompido / trabalho duplicado).
const STALE_MINUTES = 10;
const MAX_RECOVERIES = 3;

async function run({ boss: injectedBoss } = {}) {
  const stuck = await sourceVideosRepository.findStuckProcessing(STALE_MINUTES);
  if (stuck.length === 0) return { recovered: 0, gaveUp: 0 };

  const boss = injectedBoss || (await queueService.getBoss());

  let recovered = 0;
  let gaveUp = 0;

  for (const video of stuck) {
    const lastBeat = video.processing_heartbeat_at || video.processing_started_at || video.updated_at;
    const minutesSilent = Math.round((Date.now() - new Date(lastBeat).getTime()) / 60_000);

    const revived = await sourceVideosRepository.markRecoveredFromStuck(video.id, MAX_RECOVERIES);
    if (!revived) {
      // Ja foi ressuscitado MAX_RECOVERIES vezes e travou de novo - o problema
      // e o video (ou uma etapa dele), nao o worker. Vira erro de verdade pra
      // aparecer pro cliente em vez de ficar em loop de ressurreicao.
      gaveUp += 1;
      await sourceVideosRepository.updateStatus(video.id, 'error', {
        errorMessage: `O processamento travou ${MAX_RECOVERIES} vezes seguidas. Tente processar de novo.`,
      });
      logger.error(
        `Video-fonte #${video.id} travou em "${video.status}" pela ${MAX_RECOVERIES + 1}a vez - desistindo e marcando como erro.`
      );
      continue;
    }

    recovered += 1;
    logger.info(
      `Video-fonte #${video.id} estava travado em "${video.status}" sem sinal de vida ha ${minutesSilent} min - reenfileirado pra retomar de onde parou (tentativa ${revived.stuck_recovery_count}/${MAX_RECOVERIES}).`
    );

    const clientUserId = await resolveClientId(video);
    const priority = clientUserId ? await queuePriorityService.resolveQueuePriorityForClient(clientUserId) : 0;
    await boss.send(QUEUE_VIDEO_PROCESSING, { sourceVideoId: video.id }, { priority });
  }

  return { recovered, gaveUp };
}

module.exports = { run, STALE_MINUTES, MAX_RECOVERIES };
