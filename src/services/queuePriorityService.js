// Prioridade da fila video-processing por plano (Max > Pro > Starter, ver
// subscription_plans.queue_priority). pg-boss aceita `priority` (inteiro,
// maior roda primeiro) na opcao do `boss.send()` - continua sendo 1 video
// processado por vez (videoScheduler.js nao usa batchSize/teamSize), so
// muda QUAL video da fila e pego a seguir.
'use strict';

const clientSubscriptionsRepository = require('../repositories/clientSubscriptionsRepository');

async function resolveQueuePriorityForClient(clientUserId) {
  const subscription = await clientSubscriptionsRepository.getOrCreate(clientUserId);
  return subscription.queue_priority || 0;
}

module.exports = { resolveQueuePriorityForClient };
