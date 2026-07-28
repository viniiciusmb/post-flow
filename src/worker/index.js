'use strict';

// Processo 2: tarefas em segundo plano (checar Drive, postar no TikTok).
// Na Fase 0 isso e so um esqueleto que confirma a conexao com o banco -
// os jobs de verdade (driveDiscoveryJob, postToTikTokJob) entram nas
// Fases 2 e 3, registrados aqui em scheduler.js.
const config = require('../config');
const pool = require('../db/pool');
const logger = require('../lib/logger');

async function main() {
  await pool.query('SELECT 1');
  logger.info(`Worker iniciado (env=${config.env}). Nenhum job agendado ainda (Fase 0).`);

  // Mantem o processo vivo (PM2/Docker esperam um processo de longa duracao).
  setInterval(() => {}, 1000 * 60 * 60);
}

main().catch((err) => {
  logger.error('Falha ao iniciar o worker:', err);
  process.exit(1);
});
