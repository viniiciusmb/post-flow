'use strict';

const crypto = require('crypto');
const tiktokService = require('../../services/tiktokService');
const tiktokAccountsRepository = require('../../repositories/tiktokAccountsRepository');

function connect(req, res) {
  const state = crypto.randomBytes(16).toString('hex');
  req.session.tiktokOAuthState = state;
  res.redirect(tiktokService.buildAuthorizeUrl(state));
}

async function callback(req, res) {
  const { code, state, error, error_description: errorDescription } = req.query;

  if (error) {
    return res.redirect(`/client?tiktok_error=${encodeURIComponent(errorDescription || error)}`);
  }

  if (!state || state !== req.session.tiktokOAuthState) {
    return res.redirect('/client?tiktok_error=Sessao+expirada,+tente+conectar+novamente');
  }
  delete req.session.tiktokOAuthState;

  const tokens = await tiktokService.exchangeCodeForToken(code);
  const userInfo = await tiktokService.getUserInfo(tokens.access_token);

  await tiktokAccountsRepository.upsertForClient({
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

  res.redirect('/client?tiktok_connected=1');
}

module.exports = { connect, callback };
