// Integracao com o Google Drive (OAuth do admin + listagem de arquivos).
// Referencia: https://developers.google.com/identity/protocols/oauth2/web-server
//             https://developers.google.com/drive/api/reference/rest/v3/files/list
'use strict';

const fs = require('fs');
const crypto = require('crypto');
const config = require('../config');

const AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const FILES_URL = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files';

// drive.readonly cobre ler pastas de origem que o cliente aponta (video a
// processar). drive.file cobre so os arquivos que o proprio Post Flow cria -
// usado pra exportar os cortes prontos pra uma pasta de destino, sem pedir
// acesso a arquivos do cliente que a gente nunca tocou.
const SCOPES = [
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/userinfo.email',
];

function buildAuthorizeUrl(state) {
  const params = new URLSearchParams({
    client_id: config.google.clientId,
    redirect_uri: config.google.redirectUri,
    response_type: 'code',
    scope: SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
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
    throw new Error(`Google recusou a solicitacao de token: ${data.error_description || data.error || response.statusText}`);
  }
  return data;
}

function exchangeCodeForToken(code) {
  return requestToken(
    new URLSearchParams({
      code,
      client_id: config.google.clientId,
      client_secret: config.google.clientSecret,
      redirect_uri: config.google.redirectUri,
      grant_type: 'authorization_code',
    })
  );
}

function refreshAccessToken(refreshToken) {
  return requestToken(
    new URLSearchParams({
      client_id: config.google.clientId,
      client_secret: config.google.clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    })
  );
}

async function getUserEmail(accessToken) {
  const response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(`Falha ao buscar e-mail da conta Google: ${data.error?.message || response.statusText}`);
  }
  return data.email;
}

// Lista todos os videos (nao-excluidos) dentro de uma pasta do Drive,
// paginando ate acabar. Nao filtra por data: a deteccao de duplicados
// e feita no banco (drive_file_id e unico), entao repetir a listagem
// inteira a cada checagem e simples e seguro.
async function listVideosInFolder(accessToken, folderId) {
  const files = [];
  let pageToken;

  do {
    const params = new URLSearchParams({
      q: `'${folderId}' in parents and trashed = false and mimeType contains 'video/'`,
      fields: 'files(id,name,mimeType,size,modifiedTime),nextPageToken',
      pageSize: '100',
    });
    if (pageToken) params.set('pageToken', pageToken);

    const response = await fetch(`${FILES_URL}?${params.toString()}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(`Falha ao listar arquivos do Drive: ${data.error?.message || response.statusText}`);
    }

    files.push(...(data.files || []));
    pageToken = data.nextPageToken;
  } while (pageToken);

  return files;
}

// Sobe um corte pronto pra pasta de destino do cliente (multipart: metadata
// JSON + bytes do arquivo numa unica requisicao - simples e suficiente pro
// tamanho dos nossos cortes, sem precisar de upload resumivel em pedacos).
async function uploadFile(accessToken, folderId, filePath, filename, mimeType) {
  const boundary = `postflow-${crypto.randomBytes(8).toString('hex')}`;
  const metadata = JSON.stringify({ name: filename, parents: [folderId] });
  const fileBuffer = fs.readFileSync(filePath);

  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`),
    fileBuffer,
    Buffer.from(`\r\n--${boundary}--`),
  ]);

  const response = await fetch(`${UPLOAD_URL}?uploadType=multipart&fields=id`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body,
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(`Falha ao enviar arquivo pro Google Drive: ${data.error?.message || response.statusText}`);
  }
  return data;
}

module.exports = {
  buildAuthorizeUrl,
  exchangeCodeForToken,
  refreshAccessToken,
  getUserEmail,
  listVideosInFolder,
  uploadFile,
};
