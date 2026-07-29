'use strict';

const crypto = require('crypto');
const googleService = require('../../services/googleService');
const driveConnectionsRepository = require('../../repositories/driveConnectionsRepository');
const { ROLES } = require('../../config/constants');

// Admin conecta pela pagina EJS /admin/drive; cliente conecta pelo dashboard
// novo (React), que so tem rota de API - por isso o cliente volta pra
// /client (SPA) com a querystring, em vez de uma pagina propria.
function returnPathFor(role) {
  return role === ROLES.ADMIN ? '/admin/drive' : '/client';
}

function connect(req, res) {
  const state = crypto.randomBytes(16).toString('hex');
  req.session.googleOAuthState = state;
  req.session.googleOAuthReturnPath = returnPathFor(req.session.user.role);
  res.redirect(googleService.buildAuthorizeUrl(state));
}

async function callback(req, res) {
  const { code, state, error, error_description: errorDescription } = req.query;
  const returnPath = req.session.googleOAuthReturnPath || returnPathFor(req.session.user.role);

  if (error) {
    return res.redirect(`${returnPath}?google_error=${encodeURIComponent(errorDescription || error)}`);
  }

  if (!state || state !== req.session.googleOAuthState) {
    return res.redirect(`${returnPath}?google_error=Sessao+expirada,+tente+conectar+novamente`);
  }
  delete req.session.googleOAuthState;
  delete req.session.googleOAuthReturnPath;

  const tokens = await googleService.exchangeCodeForToken(code);
  if (!tokens.refresh_token) {
    return res.redirect(
      `${returnPath}?google_error=Google+nao+retornou+permissao+offline,+revogue+o+acesso+em+myaccount.google.com/permissions+e+tente+de+novo`
    );
  }
  const email = await googleService.getUserEmail(tokens.access_token);

  await driveConnectionsRepository.upsert({
    ownerUserId: req.session.user.id,
    googleAccountEmail: email,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresIn: tokens.expires_in,
  });

  res.redirect(`${returnPath}?google_connected=1`);
}

module.exports = { connect, callback };
