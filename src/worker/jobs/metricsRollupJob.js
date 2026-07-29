// Fecha o resumo diario (ontem) e limpa transcricoes antigas - roda uma vez
// por dia. So o worker de postagem agenda isso (nao o worker de video), pra
// nao rodar em duplicidade.
'use strict';

const metricsRepository = require('../../repositories/metricsRepository');
const logger = require('../../lib/logger');

const TRANSCRIPT_RETENTION_DAYS = 90;

async function run() {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  await metricsRepository.computeDailyRollup(yesterday);

  const pruned = await metricsRepository.pruneOldTranscripts(TRANSCRIPT_RETENTION_DAYS);
  if (pruned > 0) {
    logger.info(`Retencao: transcricao removida de ${pruned} video(s) com mais de ${TRANSCRIPT_RETENTION_DAYS} dias.`);
  }
}

module.exports = { run };
