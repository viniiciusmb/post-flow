'use strict';

const ROLES = Object.freeze({
  ADMIN: 'admin',
  CLIENT: 'client',
});

const POSTING_STATUS = Object.freeze({
  PENDING: 'pending',
  QUEUED: 'queued',
  PROCESSING: 'processing',
  POSTED: 'posted',
  ERROR: 'error',
});

const DRIVE_FOLDER_TYPE = Object.freeze({
  CLIENT: 'client',
});

// Dados publicos da empresa. Aparecem na landing, na pagina de contato, nos
// Termos e na Politica de Privacidade - e sao exatamente os mesmos que vao no
// formulario de verificacao do Google e do TikTok, entao tem que bater.
// Um lugar so pra nao ficar divergindo entre as paginas.
const CONTACT = Object.freeze({
  // ATENCAO: este encaminhamento precisa existir de verdade no painel do
  // dominio (postflowtiktok.com) apontando pro e-mail que o fundador le. Uma
  // caixa que volta "usuario inexistente" reprova na revisao do Google/TikTok.
  supportEmail: 'suporte@postflowtiktok.com',
  siteUrl: 'https://postflowtiktok.com',
  responseTime: 'até 2 dias úteis',
});

module.exports = { ROLES, POSTING_STATUS, DRIVE_FOLDER_TYPE, CONTACT };
