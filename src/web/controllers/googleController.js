'use strict';

const crypto = require('crypto');
const googleService = require('../../services/googleService');
const driveConnectionsRepository = require('../../repositories/driveConnectionsRepository');

// Conecta/reconecta Google Drive - admin e cliente usam a mesma tela
// (Configurações do cliente, React) pra gerenciar a propria conexão, mesmo
// quando quem esta logado e o admin usando um canal proprio de teste.
function returnPathFor() {
  return '/client';
}

function connect(req, res) {
  const state = crypto.randomBytes(16).toString('hex');
  req.session.googleOAuthState = state;
  req.session.googleOAuthReturnPath = returnPathFor();
  res.redirect(googleService.buildAuthorizeUrl(state));
}

async function callback(req, res) {
  const { code, state, error, error_description: errorDescription } = req.query;
  const returnPath = req.session.googleOAuthReturnPath || returnPathFor();

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
