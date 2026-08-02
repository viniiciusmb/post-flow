'use strict';

const app = require('./app');
const config = require('../config');
const logger = require('../lib/logger');
const { startHeartbeat } = require('../lib/heartbeat');
const processGuard = require('../lib/processGuard');

const server = app.listen(config.port, () => {
  logger.info(`Servidor web rodando em http://localhost:${config.port}`);
  startHeartbeat('web');
});

// Para de aceitar conexao nova e espera as requisicoes em voo terminarem antes
// de sair - senao todo deploy corta requisicao de cliente pela metade.
processGuard.install('web', {
  onShutdown: () =>
    new Promise((resolve) => {
      server.close(resolve);
      setTimeout(resolve, 5000).unref();
    }),
});
