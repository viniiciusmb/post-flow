'use strict';

const logger = require('../../lib/logger');

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  logger.error(err);
  const status = err.status || 500;
  res.status(status).render('errors/generic', {
    title: 'Erro',
    message: status === 500 ? 'Algo deu errado. Tente novamente.' : err.message,
  });
}

module.exports = errorHandler;
