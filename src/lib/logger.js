// Logger minimo. Nao usa nenhuma dependencia externa - so padroniza o formato
// das mensagens no console (que o PM2/Docker ja capturam em arquivo de log).
'use strict';

function timestamp() {
  return new Date().toISOString();
}

const logger = {
  info: (...args) => console.log(`[${timestamp()}] [INFO]`, ...args),
  warn: (...args) => console.warn(`[${timestamp()}] [WARN]`, ...args),
  error: (...args) => console.error(`[${timestamp()}] [ERROR]`, ...args),
};

module.exports = logger;
