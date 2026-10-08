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

async function chamar(metodo, caminho, corpo) {
  if (!configurado()) throw new OutstandError('A integração com Instagram e Facebook não está configurada.', 503);
  let resposta;
  try {
    resposta = await fetch(baseUrl() + caminho, {
      method: metodo,
      headers: {
        Authorization: `Bearer ${config.outstand.apiKey}`,
        ...(corpo ? { 'Content-Type': 'application/json' } : {}),
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

async function urlDeAutorizacao({ network, userId, redirectUri }) {
  const dados = await chamar('POST', `/v1/social-networks/${network}/auth-url`, {
    redirect_uri: redirectUri,
    tenant_id: tenantDe(userId),
    // Sem isso, quem conecta a segunda conta acaba reautorizando a primeira
    // (a rede reaproveita a sessão aberta no navegador).
    force_account_selection: true,
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

module.exports = {
  OutstandError,
  configurado,
  tenantDe,
  urlDeAutorizacao,
  buscarConta,
  paginasPendentes,
  finalizarPendente,
  removerConta,
};
