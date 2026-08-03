// Destrava videos parados em 'aguardando_creditos' - chamado depois que o
// cliente compra credito avulso ou liga o cartao de excedente (webhook da
// Stripe) ou o admin ajusta credito manualmente. Mesmo mecanismo do retry
// manual ja existente (resetForRetry), so que disparado automaticamente em
// vez de clique do cliente.
'use strict';

const sourceVideosRepository = require('../repositories/sourceVideosRepository');
const queueService = require('./queueService');
const queuePriorityService = require('./queuePriorityService');
const logger = require('../lib/logger');

const QUEUE_VIDEO_PROCESSING = 'video-processing';

async function unlockAwaitingCreditsForClient(clientUserId) {
  const stuck = await sourceVideosRepository.findAwaitingCreditsByClientId(clientUserId);
  if (stuck.length === 0) return 0;

  const boss = await queueService.getBoss();
  const priority = await queuePriorityService.resolveQueuePriorityForClient(clientUserId);

  let unlocked = 0;
  for (const sourceVideo of stuck) {
    const updated = await sourceVideosRepository.resumeAwaitingCredits(sourceVideo.id);
    if (!updated) continue;
    await boss.send(QUEUE_VIDEO_PROCESSING, { sourceVideoId: sourceVideo.id }, { priority });
    unlocked += 1;
  }
  if (unlocked > 0) {
    logger.info(`Destravado(s) ${unlocked} video(s) que estavam aguardando credito (cliente ${clientUserId}).`);
  }
  return unlocked;
}

// Mesma ideia, pro video que estava esperando o computador do cliente voltar.
// Chamado pelo tunnelTestJob assim que o tunel daquele cliente reconecta.
async function unlockAwaitingTunnelForClient(clientUserId) {
  const stuck = await sourceVideosRepository.findAwaitingTunnelByClientId(clientUserId);
  if (stuck.length === 0) return 0;

  const boss = await queueService.getBoss();
  const priority = await queuePriorityService.resolveQueuePriorityForClient(clientUserId);

  let unlocked = 0;
  for (const sourceVideo of stuck) {
    const updated = await sourceVideosRepository.resumeAwaitingTunnel(sourceVideo.id);
    if (!updated) continue;
    await boss.send(QUEUE_VIDEO_PROCESSING, { sourceVideoId: sourceVideo.id }, { priority });
    unlocked += 1;
  }
  if (unlocked > 0) {
    logger.info(`Destravado(s) ${unlocked} video(s) que esperavam a conexao do cliente ${clientUserId}.`);
  }
  return unlocked;
}

module.exports = { unlockAwaitingCreditsForClient, unlockAwaitingTunnelForClient };
