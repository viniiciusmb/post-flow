// Integracao com a API v2 do TikTok (Login Kit + dados basicos do perfil).
// Referencia: https://developers.tiktok.com/doc/oauth-user-access-token-management
'use strict';

const config = require('../config');

const AUTHORIZE_URL = 'https://www.tiktok.com/v2/auth/authorize/';
const TOKEN_URL = 'https://open.tiktokapis.com/v2/oauth/token/';
const USER_INFO_URL = 'https://open.tiktokapis.com/v2/user/info/';

// user.info.basic: nome/avatar pro painel. video.publish: necessario pra
// Fase 3 (postar no TikTok). user.info.stats: seguidores/curtidas/videos pro
// dashboard do cliente. Pedimos tudo agora pra nao ter que refazer a conexao
// com o cliente depois - so vale a partir de quando o cliente reconectar
// (tokens antigos nao ganham escopo novo sozinhos).
const SCOPES = ['user.info.basic', 'user.info.stats', 'video.publish'];

function buildAuthorizeUrl(state) {
  const params = new URLSearchParams({
    client_key: config.tiktok.clientKey,
    response_type: 'code',
    scope: SCOPES.join(','),
    redirect_uri: config.tiktok.redirectUri,
    state,
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

async function requestToken(body) {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  const data = await response.json();
  if (!response.ok || data.error) {
    throw new Error(`TikTok recusou a solicitacao de token: ${data.error_description || data.error || response.statusText}`);
  }
  return data;
}

function exchangeCodeForToken(code) {
  return requestToken(
    new URLSearchParams({
      client_key: config.tiktok.clientKey,
      client_secret: config.tiktok.clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: config.tiktok.redirectUri,
    })
  );
}

function refreshAccessToken(refreshToken) {
  return requestToken(
    new URLSearchParams({
      client_key: config.tiktok.clientKey,
      client_secret: config.tiktok.clientSecret,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    })
  );
}

async function getUserInfo(accessToken) {
  const params = new URLSearchParams({ fields: 'open_id,union_id,avatar_url,display_name' });
  const response = await fetch(`${USER_INFO_URL}?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  const data = await response.json();
  if (!response.ok || data.error?.code !== 'ok') {
    throw new Error(`Falha ao buscar dados do perfil TikTok: ${data.error?.message || response.statusText}`);
  }
  return data.data.user;
}

// Requer o escopo user.info.stats - se o token foi concedido so com
// user.info.basic (conexao antiga), a API devolve os campos de estatistica
// vazios/zerados em vez de dar erro, entao o chamador trata null com calma.
async function getUserStats(accessToken) {
  const params = new URLSearchParams({
    fields: 'follower_count,following_count,likes_count,video_count',
  });
  const response = await fetch(`${USER_INFO_URL}?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  const data = await response.json();
  if (!response.ok || data.error?.code !== 'ok') {
    throw new Error(`Falha ao buscar estatisticas do perfil TikTok: ${data.error?.message || response.statusText}`);
  }
  return data.data.user;
}

module.exports = { buildAuthorizeUrl, exchangeCodeForToken, refreshAccessToken, getUserInfo, getUserStats };
