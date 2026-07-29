'use strict';

const logger = require('../../lib/logger');

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  logger.error(err);
  const status = err.status || 500;
  const message = status === 500 ? 'Algo deu errado. Tente novamente.' : err.message;

  if (req.path.startsWith('/api/')) {
    return res.status(status).json({ error: message });
  }

  res.status(status).render('errors/generic', { title: 'Erro', message });
}

module.exports = errorHandler;
