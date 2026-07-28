'use strict';

const crypto = require('crypto');
const googleService = require('../../services/googleService');
const driveConnectionsRepository = require('../../repositories/driveConnectionsRepository');

function connect(req, res) {
  const state = crypto.randomBytes(16).toString('hex');
  req.session.googleOAuthState = state;
  res.redirect(googleService.buildAuthorizeUrl(state));
}

async function callback(req, res) {
  const { code, state, error, error_description: errorDescription } = req.query;

  if (error) {
    return res.redirect(`/admin/drive?google_error=${encodeURIComponent(errorDescription || error)}`);
  }

  if (!state || state !== req.session.googleOAuthState) {
    return res.redirect('/admin/drive?google_error=Sessao+expirada,+tente+conectar+novamente');
  }
  delete req.session.googleOAuthState;

  const tokens = await googleService.exchangeCodeForToken(code);
  if (!tokens.refresh_token) {
    return res.redirect(
      '/admin/drive?google_error=Google+nao+retornou+permissao+offline,+revogue+o+acesso+em+myaccount.google.com/permissions+e+tente+de+novo'
    );
  }
  const email = await googleService.getUserEmail(tokens.access_token);

  await driveConnectionsRepository.upsert({
    adminUserId: req.session.user.id,
    googleAccountEmail: email,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresIn: tokens.expires_in,
  });

  res.redirect('/admin/drive?google_connected=1');
}

module.exports = { connect, callback };
