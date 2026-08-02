// Fila de tarefas em segundo plano, usando o proprio Postgres (pg-boss) -
// sem precisar instalar/administrar Redis na VPS.
'use strict';

const PgBoss = require('pg-boss');
const config = require('../config');
const logger = require('../lib/logger');

let bossInstance;

async function getBoss() {
  if (bossInstance) return bossInstance;

  bossInstance = new PgBoss(config.databaseUrl);
  bossInstance.on('error', (err) => logger.error('Erro na fila (pg-boss):', err));
  await bossInstance.start();
  return bossInstance;
}

// Encerramento limpo no SIGTERM do deploy: devolve pra fila os jobs que este
// processo pegou mas ainda nao terminou, em vez de deixa-los "em execucao"
// esperando o timeout do pg-boss.
async function stopBoss() {
  if (!bossInstance) return;
  const boss = bossInstance;
  bossInstance = undefined;
  await boss.stop({ graceful: true, timeout: 5000 });
}

module.exports = { getBoss, stopBoss };
