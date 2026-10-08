// Quem vê o painel remodelado (08/10/2026).
//
// O fundador está refazendo a navegação em três frentes - "Vídeos do YouTube",
// "Lives" e "Redes sociais" (TikTok, Instagram e Facebook separados) - e quer
// testar com a conta dele antes de abrir pra todo mundo. Quem não está na
// lista continua com o menu antigo, sem ver diferença nenhuma.
//
// O admin sempre vê: é ele quem testa. As outras contas ficam numa lista em
// settings.painel_novo_user_ids (hoje só a Rise Style, #17). Para abrir ao
// público: trocar `ehPainelNovo` por `return true` (e apagar a chave).
'use strict';

const settingsRepository = require('../repositories/settingsRepository');
const { ROLES } = require('../config/constants');

const CHAVE = 'painel_novo_user_ids';

async function idsLiberados() {
  const lista = await settingsRepository.getValue(CHAVE, []);
  return Array.isArray(lista) ? lista.map(Number).filter(Number.isFinite) : [];
}

async function ehPainelNovo(user) {
  if (!user) return false;
  if (user.role === ROLES.ADMIN) return true;
  return (await idsLiberados()).includes(Number(user.id));
}

module.exports = { CHAVE, ehPainelNovo, idsLiberados };
