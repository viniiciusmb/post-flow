'use strict';

const crypto = require('crypto');
const tiktokService = require('../../services/tiktokService');
const tiktokAccountsRepository = require('../../repositories/tiktokAccountsRepository');
const backfillPostingsService = require('../../services/backfillPostingsService');
const planLimitsService = require('../../services/planLimitsService');

// Pra onde voltar depois de conectar. Antes caia sempre no Inicio, mesmo tendo
// saido da tela de Publicacao - a pessoa perdia o lugar e tinha que navegar de
// volta pra ver a conta que acabou de conectar.
//
// Lista fechada de destinos, e NUNCA o valor cru: o endereco vem da URL, e
// redirecionar pra qualquer coisa que chegue ali seria um redirecionamento
// aberto (um link que parece nosso levando pra fora do site).
const RETORNOS_PERMITIDOS = new Set(['/client', '/client/tiktok-account', '/client/youtube-channels']);

function destinoDeRetorno(valor) {
  return RETORNOS_PERMITIDOS.has(valor) ? valor : '/client';
}

function connect(req, res) {
  const state = crypto.randomBytes(16).toString('hex');
  req.session.tiktokOAuthState = state;
  // Guardado na sessao, nao carregado pela TikTok: o que volta do OAuth e so o
  // `state`, entao a origem tem que estar do nosso lado.
  req.session.tiktokRetorno = destinoDeRetorno(req.query.from);
  res.redirect(tiktokService.buildAuthorizeUrl(state));
}

async function callback(req, res) {
  const { code, state, error, error_description: errorDescription } = req.query;

  const voltarPara = destinoDeRetorno(req.session.tiktokRetorno);

  if (error) {
    return res.redirect(`${voltarPara}?tiktok_error=${encodeURIComponent(errorDescription || error)}`);
  }

  if (!state || state !== req.session.tiktokOAuthState) {
    return res.redirect(`${voltarPara}?tiktok_error=Sessao+expirada,+tente+conectar+novamente`);
  }
  delete req.session.tiktokOAuthState;
  delete req.session.tiktokRetorno;

  const tokens = await tiktokService.exchangeCodeForToken(code);

  // Reconectar a MESMA conta (mesmo open_id) nunca deve esbarrar no limite
  // do plano - so conta contra o limite quando e uma conta NOVA de verdade.
  const existingAccounts = await tiktokAccountsRepository.listActiveByClientId(req.session.user.id);
  const isReconnect = existingAccounts.some((a) => a.tiktok_open_id === tokens.open_id);
  if (!isReconnect) {
    const limitCheck = await planLimitsService.checkTiktokAccountLimit(req.session.user.id, existingAccounts.length);
    if (!limitCheck.allowed) {
      return res.redirect(`/client?tiktok_error=${encodeURIComponent(limitCheck.reason)}`);
    }
  }

  const userInfo = await tiktokService.getUserInfo(tokens.access_token);

  const conta = await tiktokAccountsRepository.upsertForClient({
    clientUserId: req.session.user.id,
    tiktokOpenId: tokens.open_id,
    tiktokUnionId: userInfo.union_id || null,
    displayName: userInfo.display_name || null,
    avatarUrl: userInfo.avatar_url || null,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresIn: tokens.expires_in,
    scopes: (tokens.scope || '').split(',').filter(Boolean),
  });

  // Cortes que ficaram prontos antes desta conta existir nao tinham pra onde
  // ir, e conectar depois nao voltava atras pra busca-los - a fila abria vazia
  // sem explicacao. Ver backfillPostingsService.
  await backfillPostingsService.enfileirarCortesProntos({
    clientUserId: req.session.user.id,
    tiktokAccountId: conta.id,
  });

  res.redirect(`${voltarPara}?tiktok_connected=1`);
}

module.exports = { connect, callback };
