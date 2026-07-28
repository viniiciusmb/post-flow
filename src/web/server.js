'use strict';

const app = require('./app');
const config = require('../config');
const logger = require('../lib/logger');

app.listen(config.port, () => {
  logger.info(`Servidor web rodando em http://localhost:${config.port}`);
});
