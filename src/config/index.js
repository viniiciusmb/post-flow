// Carrega e valida as variaveis de ambiente uma unica vez, em um lugar so.
// Qualquer outro arquivo do projeto deve importar config daqui em vez de
// ler process.env diretamente.
'use strict';

require('dotenv').config();

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Variavel de ambiente obrigatoria ausente: ${name}. Confira seu arquivo .env.`);
  }
  return value;
}

const config = {
  env: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 3000),
  isProduction: process.env.NODE_ENV === 'production',

  databaseUrl: required('DATABASE_URL'),
  sessionSecret: required('SESSION_SECRET'),
  encryptionKey: required('APP_ENCRYPTION_KEY'),

  tiktok: {
    clientKey: process.env.TIKTOK_CLIENT_KEY || '',
    clientSecret: process.env.TIKTOK_CLIENT_SECRET || '',
    redirectUri: process.env.TIKTOK_REDIRECT_URI || '',
  },

  google: {
    clientId: process.env.GOOGLE_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    redirectUri: process.env.GOOGLE_REDIRECT_URI || '',
  },
};

module.exports = config;
