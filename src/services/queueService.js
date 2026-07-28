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

module.exports = { getBoss };
