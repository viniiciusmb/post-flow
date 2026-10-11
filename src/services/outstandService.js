// Cliente da API da Outstand (https://www.outstand.so/docs).
//
// A Outstand publica no Instagram e no Facebook usando o app DELA, já aprovado
// pela Meta. É o quebra-galho enquanto o Post Flow não tem app próprio: o que
// se pula é a revisão da Meta, não a API oficial (por baixo é a mesma).
//
// Isolado neste arquivo de propósito: se a Outstand mudar de preço, cair ou a
// Meta travar o app dela, trocar de fornecedor é trocar este arquivo - nenhuma
// tela e nenhum controller fala com a Outstand direto.
//
// Cada cliente nosso vira um "tenant" lá (`pf_<id do usuário>`). Isso NÃO é
// uma trava de segurança: o tenant vai aberto na URL de autorização e o cliente
// pode editá-lo. Quem decide de quem é a conta é a sessão de quem iniciou a
// conexão (ver socialAccountsApiController).
'use strict';

const fs = require('node:fs');
const config = require('../config');
const logger = require('../lib/logger');

const BASE_URL = 'https://api.outstand.so';
const TIMEOUT_MS = 20000;

class OutstandError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'OutstandError';
    this.status = status;
  }
}

function baseUrl() {
  const override = config.outstand.baseUrlOverride;
  if (!override) return BASE_URL;
  try {
    const url = new URL(override);
    if (['localhost', '127.0.0.1', '::1'].includes(url.hostname)) return override.replace(/\/$/, '');
    logger.error(`OUTSTAND_BASE_URL aponta pra "${url.hostname}", que nao e local - ignorando por seguranca.`);
  } catch {
    logger.error(`OUTSTAND_BASE_URL nao e uma URL valida ("${override}") - ignorando.`);
  }
  return BASE_URL;
}

function configurado() {
  return Boolean(config.outstand.apiKey);
}

function tenantDe(userId) {
  return `pf_${Number(userId)}`;
}

async function chamar(metodo, caminho, corpo, { cabecalhos = {} } = {}) {
  if (!configurado()) throw new OutstandError('A integração com Instagram e Facebook não está configurada.', 503);
  let resposta;
  try {
    resposta = await fetch(baseUrl() + caminho, {
      method: metodo,
      headers: {
        Authorization: `Bearer ${config.outstand.apiKey}`,
        ...(corpo ? { 'Content-Type': 'application/json' } : {}),
        ...cabecalhos,
      },
      body: corpo ? JSON.stringify(corpo) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    throw new OutstandError(`Não foi possível falar com a Outstand (${err.message}).`, 502);
  }
  const texto = await resposta.text();
  let dados = null;
  try {
    dados = texto ? JSON.parse(texto) : null;
  } catch {
    dados = null;
  }
  if (!resposta.ok || (dados && dados.success === false)) {
    const msg = (dados && (dados.error || dados.message)) || `HTTP ${resposta.status}`;
    throw new OutstandError(`Outstand recusou ${metodo} ${caminho.split('?')[0]}: ${msg}`, resposta.status);
  }
  return dados;
}

async function urlDeAutorizacao({ network, userId, redirectUri, outraConta = false }) {
  const dados = await chamar('POST', `/v1/social-networks/${network}/auth-url`, {
    redirect_uri: redirectUri,
    tenant_id: tenantDe(userId),
    // Só na SEGUNDA conta da mesma rede: sem isso, ela reautorizaria a primeira
    // (a rede reaproveita a sessão aberta no navegador). Na primeira, forçar o
    // login de novo só atrapalha - foi na tela de login forçado do Instagram
    // que a primeira tentativa real falhou.
    force_account_selection: outraConta,
  });
  return dados.data.auth_url;
}

async function buscarConta(accountId) {
  const dados = await chamar('GET', `/v1/social-accounts?id=${encodeURIComponent(accountId)}`);
  return (dados.data || [])[0] || null;
}

async function paginasPendentes(sessionToken) {
  const dados = await chamar('GET', `/v1/social-accounts/pending/${encodeURIComponent(sessionToken)}`);
  return dados.data;
}

async function finalizarPendente(sessionToken, pageIds) {
  const dados = await chamar('POST', `/v1/social-accounts/pending/${encodeURIComponent(sessionToken)}/finalize`, {
    selectedPageIds: pageIds,
  });
  return dados.connectedAccounts || [];
}

async function removerConta(accountId) {
  await chamar('DELETE', `/v1/social-accounts/${encodeURIComponent(accountId)}`);
}

// Manda o arquivo do corte pra Outstand e devolve a URL pública que a
// publicação usa. São 3 passos (pedir a URL de envio, mandar os bytes, confirmar).
// A URL de envio é do armazenamento DELES, não da API: vai sem a nossa chave.
const TIMEOUT_ENVIO_MS = 10 * 60 * 1000;
async function enviarMidia(caminhoDoArquivo, nomeDoArquivo) {
  const tamanho = fs.statSync(caminhoDoArquivo).size;
  const pedido = await chamar('POST', '/v1/media/upload', { filename: nomeDoArquivo, content_type: 'video/mp4' });
  const { id, upload_url: uploadUrl } = pedido.data;
  let resposta;
  try {
    resposta = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(tamanho) },
      body: fs.createReadStream(caminhoDoArquivo),
      duplex: 'half',
      signal: AbortSignal.timeout(TIMEOUT_ENVIO_MS),
    });
  } catch (err) {
    throw new OutstandError(`Não foi possível enviar o vídeo pra Outstand (${err.message}).`, 502);
  }
  if (!resposta.ok) throw new OutstandError(`O armazenamento da Outstand recusou o vídeo (HTTP ${resposta.status}).`, resposta.status);
  const confirmado = await chamar('POST', `/v1/media/${encodeURIComponent(id)}/confirm`, { size: tamanho });
  return confirmado.data.url;
}

// Cria a publicação, pra sair AGORA (sem scheduledAt). `chave` vai como
// Idempotency-Key: repetir a chamada com a mesma chave devolve a publicação já
// criada em vez de publicar o vídeo duas vezes.
async function criarPublicacao({ accountId, rede, legenda, midiaUrl, nomeDoArquivo, chave }) {
  const corpo = {
    accounts: [accountId],
    containers: [{ content: legenda || '', media: [{ url: midiaUrl, filename: nomeDoArquivo }] }],
  };
  // No Facebook, vídeo sem esta marca sai como vídeo comum da Página, não como
  // Reel. No Instagram, vídeo publicado pela API já é Reel.
  if (rede === 'facebook') corpo.facebook = { publishAsReel: true };
  const dados = await chamar('POST', '/v1/posts', corpo, { cabecalhos: { 'Idempotency-Key': chave } });
  return dados.post;
}

// O resultado da publicação NAQUELA conta: { status: 'pending'|'published'|'failed', error, url }.
async function situacaoDaPublicacao(postId, accountId) {
  const dados = await chamar('GET', `/v1/posts/${encodeURIComponent(postId)}`);
  const contas = (dados.post && dados.post.socialAccounts) || [];
  const conta = contas.find((c) => c.id === accountId) || contas[0];
  if (!conta) return { status: 'pending', error: null, url: null };
  return { status: conta.status || 'pending', error: conta.error || null, url: conta.platformPostUrl || null };
}

module.exports = {
  OutstandError,
  enviarMidia,
  criarPublicacao,
  situacaoDaPublicacao,
  configurado,
  tenantDe,
  urlDeAutorizacao,
  buscarConta,
  paginasPendentes,
  finalizarPendente,
  removerConta,
};
