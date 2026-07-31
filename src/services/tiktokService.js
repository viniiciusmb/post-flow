// Integracao com a API v2 do TikTok (Login Kit + dados basicos do perfil).
// Referencia: https://developers.tiktok.com/doc/oauth-user-access-token-management
'use strict';

const fs = require('fs');
const config = require('../config');

const AUTHORIZE_URL = 'https://www.tiktok.com/v2/auth/authorize/';
const TOKEN_URL = 'https://open.tiktokapis.com/v2/oauth/token/';
const USER_INFO_URL = 'https://open.tiktokapis.com/v2/user/info/';
const PUBLISH_INIT_URL = 'https://open.tiktokapis.com/v2/post/publish/inbox/video/init/';
const PUBLISH_STATUS_URL = 'https://open.tiktokapis.com/v2/post/publish/status/fetch/';
// Teto de tamanho de chunk da Content Posting API - qualquer corte nosso (15
// a 180s, vertical) fica bem abaixo disso, entao na pratica e sempre 1 chunk so.
const MAX_CHUNK_SIZE_BYTES = 64 * 1024 * 1024;
// Status que a TikTok pode devolver enquanto ainda esta processando -
// qualquer coisa fora dessas duas listas conta como "ainda processando".
const PUBLISH_DONE_STATUSES = ['PUBLISH_COMPLETE', 'SEND_TO_USER_INBOX'];
const PUBLISH_FAILED_STATUSES = ['FAILED'];

// user.info.basic: nome/avatar pro painel. user.info.stats: seguidores/
// curtidas/videos pro dashboard do cliente. video.upload: escopo que a
// PUBLISH_INIT_URL de verdade exige, ja que ela usa o endpoint de INBOX
// (/inbox/video/init/, modo rascunho) - "video.publish" so vale pro
// endpoint de publicacao direta no perfil (/publish/video/init/), que
// nao e o que este app chama. Pedimos video.publish tambem so por
// seguranca/futuro, mas sozinho ele NAO autoriza o fluxo de inbox (foi
// a causa real do erro "did not authorize the scope" - nao tinha nada a
// ver com config do Developer Console). Pedimos tudo agora pra nao ter
// que refazer a conexao com o cliente depois - so vale a partir de
// quando o cliente reconectar (tokens antigos nao ganham escopo novo
// sozinhos).
const SCOPES = ['user.info.basic', 'user.info.stats', 'video.publish', 'video.upload'];

function buildAuthorizeUrl(state) {
  const params = new URLSearchParams({
    client_key: config.tiktok.clientKey,
    response_type: 'code',
    scope: SCOPES.join(','),
    redirect_uri: config.tiktok.redirectUri,
    state,
    // Sem isso, clicar em "Conectar outra conta" com o navegador ja logado
    // na TikTok pulava direto pra tela de sucesso reautorizando a MESMA
    // conta de antes (a TikTok reusa a sessao do navegador silenciosamente).
    // disable_auto_auth=1 forca a tela de autorizacao aparecer sempre, dando
    // chance da pessoa trocar de conta ali (ou sair/entrar com outra antes).
    disable_auto_auth: '1',
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

// Inicia a publicacao em modo rascunho/inbox (o app ainda nao foi aprovado
// pra "Direct Post" - ver migrations/006_create_postings.sql). A TikTok
// devolve uma URL pra onde mandamos os bytes do video em seguida.
async function initInboxVideo(accessToken, videoSizeBytes) {
  const chunkSize = Math.min(videoSizeBytes, MAX_CHUNK_SIZE_BYTES);
  const totalChunkCount = Math.max(1, Math.ceil(videoSizeBytes / chunkSize));

  const response = await fetch(PUBLISH_INIT_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json; charset=UTF-8' },
    body: JSON.stringify({
      source_info: {
        source: 'FILE_UPLOAD',
        video_size: videoSizeBytes,
        chunk_size: chunkSize,
        total_chunk_count: totalChunkCount,
      },
    }),
  });

  const data = await response.json();
  if (!response.ok || data.error?.code !== 'ok') {
    throw new Error(`TikTok recusou iniciar a publicacao: ${data.error?.message || response.statusText}`);
  }
  return { publishId: data.data.publish_id, uploadUrl: data.data.upload_url, chunkSize, totalChunkCount };
}

// Envia os bytes do arquivo pra upload_url devolvida pelo init, em pedacos
// (na pratica quase sempre 1 pedaco so, ver MAX_CHUNK_SIZE_BYTES acima).
async function uploadVideoFile(uploadUrl, filePath, videoSizeBytes, chunkSize, totalChunkCount) {
  const fd = fs.openSync(filePath, 'r');
  try {
    for (let i = 0; i < totalChunkCount; i++) {
      const start = i * chunkSize;
      const end = Math.min(start + chunkSize, videoSizeBytes) - 1;
      const length = end - start + 1;
      const buffer = Buffer.alloc(length);
      fs.readSync(fd, buffer, 0, length, start);

      const response = await fetch(uploadUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': 'video/mp4',
          'Content-Range': `bytes ${start}-${end}/${videoSizeBytes}`,
          'Content-Length': String(length),
        },
        body: buffer,
      });
      if (!response.ok && response.status !== 201) {
        const text = await response.text().catch(() => '');
        throw new Error(
          `Falha ao enviar o video pro TikTok (pedaco ${i + 1}/${totalChunkCount}): HTTP ${response.status} ${text.slice(0, 300)}`
        );
      }
    }
  } finally {
    fs.closeSync(fd);
  }
}

// Consulta se a TikTok ja terminou de processar a publicacao. Devolve
// { done, failed, raw } - "raw" fica disponivel pra log quando algo sair
// diferente do esperado (a API pode ter mudado desde a ultima checagem).
async function fetchPublishStatus(accessToken, publishId) {
  const response = await fetch(PUBLISH_STATUS_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json; charset=UTF-8' },
    body: JSON.stringify({ publish_id: publishId }),
  });

  const data = await response.json();
  if (!response.ok || data.error?.code !== 'ok') {
    throw new Error(`Falha ao consultar status da publicacao no TikTok: ${data.error?.message || response.statusText}`);
  }

  const status = data.data?.status;
  return {
    done: PUBLISH_DONE_STATUSES.includes(status),
    failed: PUBLISH_FAILED_STATUSES.includes(status),
    failReason: data.data?.fail_reason || null,
    postIds: data.data?.publicaly_available_post_id || null,
    raw: data.data,
  };
}

module.exports = {
  buildAuthorizeUrl,
  exchangeCodeForToken,
  refreshAccessToken,
  getUserInfo,
  getUserStats,
  initInboxVideo,
  uploadVideoFile,
  fetchPublishStatus,
};
