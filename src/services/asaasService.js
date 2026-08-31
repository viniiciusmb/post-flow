// Único lugar do código que fala com o Asaas.
//
// Não existe SDK oficial em Node, então falamos HTTP direto — o que aqui é
// vantagem: a superfície que usamos é pequena e fica toda visível neste
// arquivo, sem uma camada de abstração escondendo o que vai na requisição.
//
// Escopo atual — todo o dinheiro do sistema passa por aqui:
//   - assinatura mensal (cartão tokenizado no nosso próprio checkout, ou PIX
//     Automático)
//   - compra de crédito avulso (pagamento único, PIX ou cartão)
//   - conexões extras (assinatura mensal separada, cartão)
//   - cobrança automática de excedente (cartão tokenizado)
//
// A tokenização de cartão foi liberada para a conta em 31/08/2026, e é ela que
// permitiu duas coisas ao mesmo tempo: o checkout deixar de ser a tela
// hospedada do Asaas (agora é a nossa, ver checkoutService) e o excedente sair
// da Stripe.
//
// REGRA QUE NÃO PODE SER QUEBRADA: número de cartão, CVV e validade passam por
// aqui uma única vez, viram token, e NUNCA são gravados nem registrados em log.
// Só o token, a bandeira e os 4 últimos dígitos sobrevivem à requisição.
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

// ---------- PIX Automático ----------

// Cria a autorização de débito recorrente. A resposta traz o QR Code que o
// cliente lê no app do banco: ele paga a primeira mensalidade E autoriza as
// próximas no mesmo gesto.
//
// paymentCreationMode 'SUBSCRIPTION' é o que faz o Asaas gerar as cobranças
// seguintes sozinho. Com 'MANUAL', cada mês viraria responsabilidade nossa -
// e uma cobrança esquecida é receita perdida em silêncio.
async function createPixAutomaticAuthorization({
  customerId,
  planName,
  amountCents,
  // O QR que o cliente paga AGORA pode ter valor diferente do que sera
  // debitado todo mes - e assim que a promocao de primeiro mes cabe numa
  // autorizacao de valor fixo.
  primeiraCobrancaCents = null,
  pixKey,
  contractId,
  startDate,
  finishDate,
}) {
  return request('POST', '/pix/automatic/authorizations', {
    body: {
      customerId,
      frequency: 'MONTHLY',
      contractId,
      startDate,
      finishDate,
      value: amountCents / 100,
      description: planName,
      paymentCreationMode: 'SUBSCRIPTION',
      // Cobrança que falha (sem saldo na conta do cliente) é tentada de novo
      // até 3x em 7 dias antes de desistir - o padrão do Banco Central para
      // Pix Automático. Sem política de repetição, um único dia sem saldo
      // cancelaria a mensalidade.
      retryPolicy: 'ALLOW_THREE_IN_SEVEN_DAYS',
      // minLimitValue NÃO vai junto: o Asaas recusa valor mínimo quando o
      // valor já é fixo ("Não é permitido definir um valor mínimo quando um
      // valor fixo já foi especificado").
      immediateQrCode: {
        originalValue: (primeiraCobrancaCents || amountCents) / 100,
        expirationSeconds: 3600,
        description: planName,
        pixKey,
      },
    },
  });
}

async function getPixAutomaticAuthorization(authorizationId) {
  return request('GET', `/pix/automatic/authorizations/${encodeURIComponent(authorizationId)}`);
}

// A conta precisa de pelo menos uma chave Pix para gerar qualquer cobrança
// por Pix - sem isso o Asaas recusa com "é necessário criar uma chave Pix".
async function listPixKeys() {
  const r = await request('GET', '/pix/addressKeys');
  return Array.isArray(r?.data) ? r.data : [];
}

// Chave Pix aleatoria (EVP): nao expoe CNPJ, telefone nem e-mail da empresa
// dentro do codigo Pix que o cliente enxerga.
async function criarChavePixAleatoria() {
  return request('POST', '/pix/addressKeys', { body: { type: 'EVP' } });
}

async function listWebhooks() {
  const r = await request('GET', '/webhooks');
  return Array.isArray(r?.data) ? r.data : [];
}

async function createWebhook({ name, url, email, authToken, events }) {
  return request('POST', '/webhooks', {
    body: {
      name,
      url,
      email,
      enabled: true,
      interrupted: false,
      apiVersion: 3,
      authToken,
      // Em ordem: reduz a chance de um aviso de "expirou" chegar antes do
      // "pago" do mesmo checkout (o codigo ja trata, mas ordem ajuda).
      sendType: 'SEQUENTIALLY',
      events,
    },
  });
}

async function updateWebhook(webhookId, campos) {
  return request('PUT', `/webhooks/${encodeURIComponent(webhookId)}`, { body: campos });
}

// ---------- cartão tokenizado (checkout transparente) ----------

// Troca os dados do cartão por um token opaco. É a única função do sistema que
// enxerga número e CVV, e ela não devolve nenhum dos dois: a resposta do Asaas
// traz apenas os 4 últimos dígitos, a bandeira e o token.
//
// creditCardHolderInfo é obrigatório e o Asaas confere o conjunto inteiro —
// faltar o CEP ou o número do endereço faz a tokenização ser recusada com um
// erro que, sem isto escrito aqui, pareceria "cartão inválido" na tela de quem
// está pagando.
//
// remoteIp é exigido pela análise antifraude do Asaas. Mandar o IP do nosso
// servidor no lugar do IP de quem está pagando faria toda transação parecer vir
// do mesmo lugar, que é exatamente o padrão que a antifraude penaliza.
async function tokenizeCard({ customerId, card, holder, remoteIp }) {
  return request('POST', '/creditCard/tokenizeCreditCard', {
    body: {
      customer: customerId,
      creditCard: {
        holderName: card.holderName,
        number: card.number,
        expiryMonth: card.expiryMonth,
        expiryYear: card.expiryYear,
        ccv: card.ccv,
      },
      creditCardHolderInfo: {
        name: holder.name,
        email: holder.email,
        cpfCnpj: holder.cpfCnpj,
        postalCode: holder.postalCode,
        addressNumber: holder.addressNumber,
        addressComplement: holder.addressComplement || null,
        phone: holder.phone || undefined,
        mobilePhone: holder.mobilePhone || holder.phone || undefined,
      },
      remoteIp,
    },
  });
}

// ---------- pagamento avulso (uma cobrança só) ----------

// Cria a cobrança. No cartão com token, o Asaas já responde com o resultado da
// autorização (status CONFIRMED quando passou), então dá para dizer "deu certo"
// na mesma requisição em que o cliente clicou — que é o ponto inteiro do
// checkout transparente. No PIX a cobrança nasce PENDING e o QR Code vem numa
// segunda chamada.
async function createPayment({
  customerId,
  billingType,
  amountCents,
  dueDate,
  description,
  externalReference,
  creditCardToken = null,
  remoteIp = null,
}) {
  return request('POST', '/payments', {
    body: {
      customer: customerId,
      billingType,
      value: amountCents / 100,
      dueDate,
      description,
      externalReference,
      creditCardToken: creditCardToken || undefined,
      remoteIp: remoteIp || undefined,
    },
  });
}

// QR Code de uma cobrança PIX já criada. Vem separado no Asaas (não junto da
// criação), então são sempre duas idas — não há como economizar uma.
async function getPixQrCode(paymentId) {
  return request('GET', `/payments/${encodeURIComponent(paymentId)}/pixQrCode`);
}

// ---------- assinatura por cartão tokenizado ----------

// Assinatura recorrente cobrada no cartão salvo. nextDueDate no futuro faz o
// Asaas NÃO cobrar agora: a primeira mensalidade (a promocional) é uma cobrança
// avulsa separada, e esta assinatura só começa a valer no mês seguinte, já pelo
// preço cheio. Foi assim que os dois degraus de preço couberam num produto que
// só aceita um valor fixo por assinatura.
async function createSubscription({
  customerId,
  billingType,
  amountCents,
  nextDueDate,
  description,
  externalReference,
  creditCardToken = null,
  remoteIp = null,
}) {
  return request('POST', '/subscriptions', {
    body: {
      customer: customerId,
      billingType,
      value: amountCents / 100,
      nextDueDate,
      cycle: 'MONTHLY',
      description,
      externalReference,
      creditCardToken: creditCardToken || undefined,
      remoteIp: remoteIp || undefined,
    },
  });
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
  tokenizeCard,
  createPayment,
  getPixQrCode,
  createSubscription,
  listSubscriptionsByCustomer,
  createPixAutomaticAuthorization,
  getPixAutomaticAuthorization,
  listPixKeys,
  criarChavePixAleatoria,
  listWebhooks,
  createWebhook,
  updateWebhook,
  getSubscription,
  updateSubscription,
  cancelSubscription,
  getPayment,
  listPaymentsByCustomer,
  webhookTokenValido,
};
