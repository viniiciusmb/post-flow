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

// Carrega tudo que a investigação precisa: método e caminho chamados, status
// HTTP e a resposta CRUA da Outstand (o painel de erros guarda isso por
// ocorrência - ver lib/contextoDeErro). O caminho vai sem query string.
class OutstandError extends Error {
  constructor(message, status, { metodo = null, caminho = null, resposta = null, etapa = null } = {}) {
    super(message);
    this.name = 'OutstandError';
    this.status = status;
    this.metodo = metodo;
    this.caminho = caminho ? String(caminho).split('?')[0] : null;
    this.resposta = resposta === null || resposta === undefined ? null : String(resposta).slice(0, 4000);
    this.etapa = etapa;
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
    throw new OutstandError(`Não foi possível falar com a Outstand (${err.message}).`, 502, {
      metodo,
      caminho,
      resposta: err.cause ? `${err.message} (${err.cause.code || err.cause.message || err.cause})` : err.message,
    });
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
    throw new OutstandError(`Outstand recusou ${metodo} ${caminho.split('?')[0]}: ${msg}`, resposta.status, {
      metodo,
      caminho,
      resposta: texto,
    });
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

// Lê os números da conta (seguidores etc.) só pra provar que a autorização
// ainda vale: a chamada usa o token da rede, então token cancelado aparece
// aqui antes de aparecer numa publicação. Janela de 1 dia pra ser leve.
async function conferirConta(accountId) {
  const ate = Math.floor(Date.now() / 1000);
  return chamar('GET', `/v1/social-accounts/${encodeURIComponent(accountId)}/metrics?since=${ate - 86400}&until=${ate}`);
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
  let pedido;
  try {
    pedido = await chamar('POST', '/v1/media/upload', { filename: nomeDoArquivo, content_type: 'video/mp4' });
  } catch (err) {
    err.etapa = 'pedir_url_de_envio';
    throw err;
  }
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
    throw new OutstandError(`Não foi possível enviar o vídeo pra Outstand (${err.message}).`, 502, {
      metodo: 'PUT',
      caminho: 'armazenamento da Outstand',
      resposta: `${err.message} - ${tamanho} bytes`,
      etapa: 'enviar_arquivo',
    });
  }
  if (!resposta.ok) {
    const corpo = await resposta.text().catch(() => '');
    throw new OutstandError(`O armazenamento da Outstand recusou o vídeo (HTTP ${resposta.status}).`, resposta.status, {
      metodo: 'PUT',
      caminho: 'armazenamento da Outstand',
      resposta: corpo,
      etapa: 'enviar_arquivo',
    });
  }
  try {
    const confirmado = await chamar('POST', `/v1/media/${encodeURIComponent(id)}/confirm`, { size: tamanho });
    return confirmado.data.url;
  } catch (err) {
    err.etapa = 'confirmar_envio';
    throw err;
  }
}

// Cria a publicação, pra sair AGORA (sem scheduledAt: o horário é decidido
// pela nossa fila). `chave` vai como Idempotency-Key: repetir a chamada com a
// mesma chave devolve a publicação já criada em vez de publicar duas vezes.
// `configuracao` é o bloco próprio da rede, já com a chave no nome da rede
// (ex.: { facebook: { publishAsReel: true } }) - ver socialPostingService.
async function criarPublicacao({ accountId, legenda, midiaUrl, nomeDoArquivo, chave, configuracao = {} }) {
  const corpo = {
    accounts: [accountId],
    containers: [{ content: legenda || '', media: [{ url: midiaUrl, filename: nomeDoArquivo }] }],
    ...configuracao,
  };
  const dados = await chamar('POST', '/v1/posts', corpo, { cabecalhos: { 'Idempotency-Key': chave } });
  // A Outstand ignora em silêncio campo com nome errado (ex.: post_mode em vez
  // de postMode) e só avisa em `warnings`. Devolvido pra quem chamou registrar:
  // é o único jeito de descobrir que uma opção nossa não está chegando na rede.
  return { ...dados.post, avisos: Array.isArray(dados.warnings) ? dados.warnings : [] };
}

// As pastas (boards) de uma conta do Pinterest: todo pin precisa de uma.
async function pastasDoPinterest(accountId) {
  const dados = await chamar('GET', `/v1/pinterest/accounts/${encodeURIComponent(accountId)}/boards`);
  return (dados.data || []).map((b) => ({ id: String(b.id), nome: b.name, privada: b.privacy && b.privacy !== 'PUBLIC' }));
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
  pastasDoPinterest,
  situacaoDaPublicacao,
  configurado,
  tenantDe,
  urlDeAutorizacao,
  buscarConta,
  paginasPendentes,
  finalizarPendente,
  removerConta,
  conferirConta,
};
