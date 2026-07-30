// Amostra periodica de CPU/memoria/disco da VPS - alimenta o card "Saude do
// servidor" no painel de metricas do admin (ver systemMetrics.js pro porque
// dos numeros refletirem a VPS inteira, nao so o container).
'use strict';

const systemMetrics = require('../../lib/systemMetrics');
const metricsRepository = require('../../repositories/metricsRepository');

async function run() {
  const sample = await systemMetrics.sampleNow();
  await metricsRepository.insertSystemMetricSample(sample);
  await metricsRepository.pruneOldSystemMetrics();
}

module.exports = { run };
