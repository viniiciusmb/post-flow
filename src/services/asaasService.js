// Único lugar do código que fala com o Asaas.
//
// Não existe SDK oficial em Node, então falamos HTTP direto — o que aqui é
// vantagem: a superfície que usamos é pequena e fica toda visível neste
// arquivo, sem uma camada de abstração escondendo o que vai na requisição.
//
// Escopo atual (o resto continua na Stripe, ver clientBillingApiController):
//   - assinatura mensal (cartão pelo Checkout do Asaas, PIX Automático)
//   - compra de crédito avulso (pagamento único, PIX ou cartão)
//
// A cobrança automática de excedente NÃO está aqui: ela depende de
// tokenização de cartão, que na produção só é liberada pelo gerente da conta
// Asaas. Até lá, esse fluxo segue na Stripe.
'use strict';

const crypto = require('crypto');
const config = require('../config');
const logger = require('../lib/logger');

const BASE_URL_POR_AMBIENTE = {
  sandbox: 'https://api-sandbox.asaas.com/v3',
  production: 'https://api.asaas.com/v3',
};

// Erro do Asaas com o código de negócio preservado. O controller precisa
// distinguir "documento inválido" (culpa do preenchimento, vira 400 com o
// texto do Asaas na tela) de "fora do ar" (vira 502) — sem isso tudo cai no
// "Algo deu errado" genérico, que na tela de pagamento é o pior texto
// possível. Foi exatamente esse o estrago no dia da troca de chaves da Stripe.
class AsaasError extends Error {
  constructor(message, { status, code = null, corpo = null } = {}) {
    super(message);
    this.name = 'AsaasError';
    this.status = status;
    this.code = code;
    this.corpo = corpo;
  }

  // Erro que o cliente causou (e pode corrigir) versus erro nosso/do Asaas.
  get isCulpaDoCliente() {
    return this.status >= 400 && this.status < 500 && this.status !== 401;
  }
}

function isConfigured() {
  return Boolean(config.asaas.apiKey);
}

// So aceita redirecionamento pra localhost. Um override apontando pra
// qualquer outro host seria um jeito silencioso de desviar pagamento de
// verdade - entao ele e ignorado com aviso, e o Asaas de verdade continua
// sendo usado, em vez de o sistema obedecer cegamente.
function overrideLocalValido(valor) {
  if (!valor) return null;
  try {
    const url = new URL(valor);
    if (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1') return valor;
    logger.error(`ASAAS_BASE_URL aponta pra "${url.hostname}", que nao e local - ignorando por seguranca.`);
    return null;
  } catch {
    logger.error(`ASAAS_BASE_URL nao e uma URL valida ("${valor}") - ignorando.`);
    return null;
  }
}

function baseUrl() {
  const override = overrideLocalValido(config.asaas.baseUrlOverride);
  if (override) return override;
  return BASE_URL_POR_AMBIENTE[config.asaas.environment] || BASE_URL_POR_AMBIENTE.sandbox;
}

function assertConfigured() {
  if (!isConfigured()) {
    throw new AsaasError(
      'Asaas ainda nao configurado (falta ASAAS_API_KEY) - peca a chave ao usuario antes de usar essa funcionalidade.',
      { status: 500 }
    );
  }
  const check = config.validateAsaasConfig();
  if (!check.ok) throw new AsaasError(check.motivo, { status: 500 });
}

// Timeout explícito: sem ele, uma instabilidade do Asaas deixaria a
// requisição do cliente pendurada até o navegador desistir, e o botão de
// pagar preso em "carregando" sem nunca dizer o que houve.
const TIMEOUT_MS = 20_000;

async function request(method, caminho, { body = null, query = null } = {}) {
  assertConfigured();

  const url = new URL(baseUrl() + caminho);
  if (query) {
    for (const [chave, valor] of Object.entries(query)) {
      if (valor !== undefined && valor !== null) url.searchParams.set(chave, String(valor));
    }
  }

  let resposta;
  try {
    resposta = await fetch(url, {
      method,
      headers: {
        access_token: config.asaas.apiKey,
        'Content-Type': 'application/json',
        // O Asaas usa isto pra identificar a integração no suporte deles.
        'User-Agent': 'PostFlow',
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    // Rede fora, DNS, timeout: nunca é culpa do cliente.
    throw new AsaasError(`Nao consegui falar com o Asaas: ${err.message}`, { status: 502 });
  }

  const texto = await resposta.text();
  let corpo = null;
  if (texto) {
    try {
      corpo = JSON.parse(texto);
    } catch {
      // O Asaas fora do ar responde HTML (página de erro), não JSON. Tratar
      // isso como "resposta ilegível" em vez de deixar o JSON.parse estourar
      // com uma mensagem que não diz nada sobre o que aconteceu.
      throw new AsaasError(`Resposta ilegivel do Asaas (HTTP ${resposta.status}).`, {
        status: resposta.status >= 400 ? resposta.status : 502,
        corpo: texto.slice(0, 500),
      });
    }
  }

  if (!resposta.ok) {
    // Formato de erro do Asaas: { errors: [{ code, description }] }
    const primeiro = Array.isArray(corpo?.errors) ? corpo.errors[0] : null;
    const descricao = primeiro?.description || `HTTP ${resposta.status}`;
    throw new AsaasError(descricao, {
      status: resposta.status,
      code: primeiro?.code || null,
      corpo,
    });
  }

  return corpo;
}

// ---------- clientes ----------

// O Asaas EXIGE cpfCnpj: não existe cliente sem documento. Por isso o
// documento é pedido na tela antes de qualquer pagamento (ver o fluxo de
// cobrança no painel do cliente), e não no cadastro.
async function createCustomer({ name, cpfCnpj, email, mobilePhone, clientUserId }) {
  return request('POST', '/customers', {
    body: {
      name,
      cpfCnpj,
      email: email || undefined,
      mobilePhone: mobilePhone || undefined,
      // Amarra o cliente do Asaas ao nosso usuário: no painel deles dá pra
      // achar de quem é a conta sem consultar o nosso banco.
      externalReference: String(clientUserId),
    },
  });
}

async function updateCustomer(customerId, campos) {
  return request('POST', `/customers/${encodeURIComponent(customerId)}`, { body: campos });
}

// Mesma lição que a Stripe deu em 14/08/2026: id guardado no nosso banco pode
// apontar pro nada depois de trocar a chave ou o ambiente (sandbox e produção
// são contas completamente separadas). Conferir antes de usar evita que todo
// botão de pagamento morra com erro genérico.
async function customerExists(customerId) {
  try {
    const cliente = await request('GET', `/customers/${encodeURIComponent(customerId)}`);
    return Boolean(cliente) && cliente.deleted !== true;
  } catch (err) {
    if (err instanceof AsaasError && err.status === 404) return false;
    throw err;
  }
}

// ---------- checkout (tela de pagamento hospedada pelo Asaas) ----------

// Usamos a tela do Asaas de propósito: assim o cartão do cliente nunca passa
// pelo nosso servidor, e não herdamos a obrigação de PCI que vem junto de
// receber número de cartão.
async function createCheckout(body) {
  return request('POST', '/checkouts', { body });
}

// ---------- assinaturas ----------

// Depois que o cliente paga um checkout de assinatura, o aviso do Asaas traz
// o id do CHECKOUT e do cliente - não o da assinatura criada. Como é ela que
// precisamos guardar (para trocar de plano ou cancelar depois), buscamos a
// assinatura pelo cliente. Ordenado pelo mais recente porque o cliente pode
// ter uma assinatura antiga cancelada.
async function listSubscriptionsByCustomer(customerId, { limit = 10 } = {}) {
  const r = await request('GET', '/subscriptions', { query: { customer: customerId, limit } });
  return Array.isArray(r?.data) ? r.data : [];
}

async function getSubscription(subscriptionId) {
  return request('GET', `/subscriptions/${encodeURIComponent(subscriptionId)}`);
}

async function updateSubscription(subscriptionId, campos) {
  return request('POST', `/subscriptions/${encodeURIComponent(subscriptionId)}`, { body: campos });
}

async function cancelSubscription(subscriptionId) {
  return request('DELETE', `/subscriptions/${encodeURIComponent(subscriptionId)}`);
}

// ---------- cobranças ----------

async function getPayment(paymentId) {
  return request('GET', `/payments/${encodeURIComponent(paymentId)}`);
}

async function listPaymentsByCustomer(customerId, { limit = 50, offset = 0 } = {}) {
  return request('GET', '/payments', { query: { customer: customerId, limit, offset } });
}

// ---------- webhook ----------

// O endereço do webhook é público: sem conferir o token, qualquer um poderia
// mandar "pagamento recebido" e ganhar crédito de graça. Comparação em tempo
// constante para não vazar o token caractere a caractere pelo tempo de
// resposta (mesmo cuidado do middleware de CSRF).
function webhookTokenValido(tokenRecebido) {
  const esperado = config.asaas.webhookToken;
  if (!esperado) {
    logger.error('ASAAS_WEBHOOK_TOKEN nao configurado - recusando webhook do Asaas por seguranca.');
    return false;
  }
  if (typeof tokenRecebido !== 'string' || tokenRecebido.length === 0) return false;

  const a = Buffer.from(tokenRecebido);
  const b = Buffer.from(esperado);
  // timingSafeEqual exige tamanhos iguais; comparar o tamanho antes vaza
  // apenas o comprimento, que não é segredo útil.
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

module.exports = {
  AsaasError,
  isConfigured,
  baseUrl,
  createCustomer,
  updateCustomer,
  customerExists,
  createCheckout,
  listSubscriptionsByCustomer,
  getSubscription,
  updateSubscription,
  cancelSubscription,
  getPayment,
  listPaymentsByCustomer,
  webhookTokenValido,
};
