// Pool unico de conexoes com o Postgres, compartilhado por toda a aplicacao
// (web e worker). Nao criar outros `new Pool()` em outros arquivos.
'use strict';

const { Pool } = require('pg');
const config = require('../config');

const pool = new Pool({ connectionString: config.databaseUrl });

pool.on('error', (err) => {
  // Erros em clientes ociosos do pool nao devem derrubar o processo.
  console.error('Erro inesperado no pool do Postgres:', err);
});

module.exports = pool;
