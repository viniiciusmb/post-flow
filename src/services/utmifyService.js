// Avisa a Utmify de cada venda: quando ela nasce (pendente), quando o dinheiro
// entra (aprovada), quando o cartão é recusado e quando há estorno.
//
// POR QUE ISTO EXISTE, se o Asaas já está conectado à Utmify pelo painel deles:
// a integração nativa enxerga a COBRANÇA, não a origem dela. Quem chegou por um
// anúncio, por um link de afiliado ou direto pelo site é informação que só
// existe do nosso lado - ela é capturada na sessão quando a pessoa abre a
// landing (ver middleware/affiliateAttribution) e gravada em `referrals` no
// cadastro. Mandando o pedido daqui, cada venda chega à Utmify já com a UTM
// que a trouxe, que é o motivo de alguém usar a Utmify em primeiro lugar.
//
// O ID DO PEDIDO É O ID DA COBRANÇA NO ASAAS (pay_xxx), de propósito. A Utmify
// identifica pedido por orderId, então se a integração nativa do Asaas também
// entregar a mesma venda, as duas caem sobre o MESMO pedido e viram uma venda
// só - em vez de o painel mostrar tudo em dobro.
//
// TRÊS REGRAS QUE NÃO PODEM SER QUEBRADAS:
//
//   1. Nunca atrapalhar o pagamento. A Utmify é painel de acompanhamento, não
//      parte da cobrança. Se ela estiver fora do ar, lenta ou com o token
//      errado, o cliente tem que continuar conseguindo pagar igual. Por isso
//      todo envio é solto (sem await de quem chamou) e todo erro morre num
//      log - nunca sobe para o controller.
//
//   2. Ordem por pedido. No cartão, "pendente" e "aprovada" acontecem com
//      segundos de diferença. Soltas, as duas requisições podem chegar fora de
//      ordem e a venda ficaria parada como pendente num painel onde ela já foi
//      paga - exatamente o número que o fundador olha. `emOrdem()` enfileira
//      os avisos de um mesmo pedido, um depois do outro.
//
//   3. Idempotência vem de quem chama. Todo aviso sai logo depois de um UPDATE
//      condicionado ao status anterior (markPaidOnce, markRefundedOnce,
//      markStatusIfPending), que devolve null quando o aviso do Asaas chega
//      repetido - e aí este serviço nem é chamado. Não há contador aqui.
'use strict';

const config = require('../config');
const logger = require('../lib/logger');
const usersRepository = require('../repositories/usersRepository');
const referralsRepository = require('../repositories/referralsRepository');
const subscriptionPlansRepository = require('../repositories/subscriptionPlansRepository');
const creditPurchasesRepository = require('../repositories/creditPurchasesRepository');
const asaasPaymentsRepository = require('../repositories/asaasPaymentsRepository');

const URL_PADRAO = 'https://api.utmify.com.br/api-credentials/orders';

// Mesma trava do ASAAS_BASE_URL: um override que não seja local seria um jeito
// silencioso de mandar os dados de venda dos clientes para o servidor de
// outra pessoa, com tudo continuando a parecer que funciona.
function urlPedidos() {
  const override = config.utmify.baseUrlOverride;
  if (!override) return URL_PADRAO;
  try {
    const url = new URL(override);
    if (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1') return override;
    logger.error(`UTMIFY_BASE_URL aponta pra "${url.hostname}", que nao e local - ignorando por seguranca.`);
  } catch {
    logger.error(`UTMIFY_BASE_URL nao e uma URL valida ("${override}") - ignorando.`);
  }
  return URL_PADRAO;
}

// Curto de propósito. Este envio nunca segura a resposta do cliente, mas um
// fetch sem timeout fica pendurado para sempre e vaza a fila do pedido.
const TIMEOUT_MS = 8000;

const STATUS = {
  pendente: 'waiting_payment',
  pago: 'paid',
  falhou: 'refused',
  estornado: 'refunded',
  chargeback: 'chargedback',
};

const FORMA_DE_PAGAMENTO = {
  CREDIT_CARD: 'credit_card',
  PIX: 'pix',
  BOLETO: 'boleto',
};

function isConfigured() {
  return Boolean(config.utmify.apiToken);
}

// A Utmify só aceita "YYYY-MM-DD HH:MM:SS" em UTC. Um ISO com "T" e "Z" é
// recusado pela validação deles.
function dataUtc(valor) {
  const d = valor ? new Date(valor) : new Date();
  if (Number.isNaN(d.getTime())) return dataUtc(null);
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

// ---------------------------------------------------------------------------
// Fila por pedido (regra nº 2)
// ---------------------------------------------------------------------------

const filaPorPedido = new Map();

function emOrdem(orderId, tarefa) {
  const anterior = filaPorPedido.get(orderId) || Promise.resolve();
  // O segundo argumento do .then faz a corrente continuar mesmo quando o aviso
  // anterior falhou: um erro de rede no "pendente" não pode impedir o "pago"
  // de ser enviado - é justamente o aviso que mais importa.
  const proxima = anterior.then(tarefa, tarefa).catch(() => {});
  filaPorPedido.set(orderId, proxima);
  proxima.then(() => {
    // Só apaga se ninguém entrou na fila depois, senão o próximo aviso deste
    // mesmo pedido perderia a corrente e voltaria a poder ultrapassar.
    if (filaPorPedido.get(orderId) === proxima) filaPorPedido.delete(orderId);
  });
  return proxima;
}

// Para os testes: espera todos os avisos soltos terminarem. Em produção
// ninguém chama isto - o envio é sempre fora do caminho do cliente.
async function aguardarEnvios() {
  while (filaPorPedido.size > 0) {
    await Promise.all([...filaPorPedido.values()]);
  }
}

// ---------------------------------------------------------------------------
// Montagem do pedido
// ---------------------------------------------------------------------------

// O que a pessoa comprou, com nome que faça sentido no painel. A Utmify agrupa
// faturamento por produto, então "assinatura" para tudo jogaria mensalidade,
// crédito avulso e conexão extra na mesma linha.
async function produtoDaCompra(registro) {
  const precoCents = Number(registro.amount_cents);

  if (registro.purpose === 'subscription') {
    const plano = registro.plan_id ? await subscriptionPlansRepository.findById(Number(registro.plan_id)) : null;
    return {
      id: plano ? `plano-${plano.key}` : 'plano',
      name: plano ? `Post Flow ${plano.name}` : 'Post Flow - assinatura',
      planId: plano ? String(plano.id) : null,
      planName: plano ? plano.name : null,
      quantity: 1,
      priceInCents: precoCents,
    };
  }

  if (registro.purpose === 'credit_package') {
    const compra = registro.credit_purchase_id
      ? await creditPurchasesRepository.findById(Number(registro.credit_purchase_id))
      : null;
    return {
      id: 'credito-avulso',
      name: compra ? `Post Flow - ${compra.minutes} min de credito` : 'Post Flow - credito avulso',
      planId: null,
      planName: null,
      quantity: 1,
      priceInCents: precoCents,
    };
  }

  if (registro.purpose === 'extra_slots') {
    return {
      id: 'conexao-extra',
      name: 'Post Flow - conexao extra',
      planId: null,
      planName: null,
      quantity: 1,
      priceInCents: precoCents,
    };
  }

  return { id: registro.purpose || 'venda', name: 'Post Flow', planId: null, planName: null, quantity: 1, priceInCents: precoCents };
}

// A UTM que trouxe o cliente. Fica em `referrals`, gravada uma vez no cadastro
// - não no pagamento. É isso que permite a Utmify ligar a venda de hoje ao
// anúncio que a pessoa clicou semanas atrás.
async function utmDoCliente(clientUserId) {
  const indicacao = await referralsRepository.findByReferredUserId(clientUserId);
  return {
    src: null,
    sck: null,
    utm_source: indicacao?.utm_source || null,
    utm_campaign: indicacao?.utm_campaign || null,
    utm_medium: indicacao?.utm_medium || null,
    utm_content: indicacao?.utm_content || null,
    utm_term: indicacao?.utm_term || null,
  };
}

async function montarPedido(registro, { status, remoteIp = null } = {}) {
  const clientUserId = Number(registro.client_user_id);
  const [usuario, produto, trackingParameters] = await Promise.all([
    usersRepository.findById(clientUserId),
    produtoDaCompra(registro),
    utmDoCliente(clientUserId),
  ]);

  // IP de quem comprou, NUNCA nulo. A Utmify recusa a venda inteira com
  // "customer.ip cannot be null" - foi assim que, em 14-15/09/2026, a venda
  // aprovada do cartão e as duas do PIX nunca chegaram ao painel: só o aviso
  // que saía da tela de pagamento tinha o IP em mãos. Agora ele é gravado na
  // cobrança; a renovação mensal (que não tem cobrança nossa) usa o da compra
  // mais recente. Sem nenhum IP conhecido o campo NÃO vai: omitido ela aceita
  // (conferido contra a API real com isTest, que valida sem salvar).
  const ip =
    remoteIp || registro.customer_ip || (await asaasPaymentsRepository.ultimoIpDoCliente(clientUserId));

  const totalCents = Number(registro.amount_cents);
  const pago = status === 'paid';
  const estornado = status === 'refunded' || status === 'chargedback';

  return {
    orderId: registro.asaas_payment_id,
    platform: 'PostFlow',
    paymentMethod: FORMA_DE_PAGAMENTO[registro.billing_type] || 'credit_card',
    status,
    createdAt: dataUtc(registro.created_at),
    approvedDate: pago ? dataUtc(registro.paid_at) : null,
    refundedAt: estornado ? dataUtc(null) : null,
    customer: {
      name: usuario?.business_name || usuario?.email || 'Cliente',
      email: usuario?.email || null,
      phone: null,
      document: usuario?.cpf_cnpj || null,
      country: 'BR',
      ...(ip ? { ip } : {}),
    },
    products: [produto],
    trackingParameters,
    commission: {
      totalPriceInCents: totalCents,
      // A taxa do Asaas não é enviada porque não a conhecemos no momento do
      // aviso (ela só aparece no `netValue` da cobrança, que não guardamos).
      // Mandar um palpite faria o painel mostrar um lucro inventado; mandar
      // zero deixa o número ser o que ele de fato é - a venda bruta.
      gatewayFeeInCents: 0,
      userCommissionInCents: totalCents,
      currency: 'BRL',
    },
    // Venda de sandbox nunca entra na contabilidade real do painel.
    isTest: config.asaas.environment !== 'production',
  };
}

async function enviar(pedido) {
  let resposta;
  try {
    resposta = await fetch(urlPedidos(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-token': config.utmify.apiToken },
      body: JSON.stringify(pedido),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    logger.error(`Utmify: nao consegui enviar a venda ${pedido.orderId} (${pedido.status}):`, err.message);
    return false;
  }

  if (!resposta.ok) {
    const texto = await resposta.text().catch(() => '');
    logger.error(`Utmify: venda ${pedido.orderId} (${pedido.status}) recusada - HTTP ${resposta.status} ${texto.slice(0, 300)}`);
    return false;
  }

  logger.info(`Utmify: venda ${pedido.orderId} enviada como "${pedido.status}".`);
  return true;
}

// Ponto único de saída. Sem token configurado não é erro nenhum: a Utmify é
// opcional, e o sistema inteiro funciona sem ela.
function notificar(registro, { status, remoteIp = null } = {}) {
  if (!isConfigured()) return Promise.resolve(false);
  if (!registro || !registro.asaas_payment_id) return Promise.resolve(false);

  return emOrdem(registro.asaas_payment_id, async () => {
    try {
      const pedido = await montarPedido(registro, { status, remoteIp });
      return await enviar(pedido);
    } catch (err) {
      // Inclui falha ao ler o cliente/plano no banco. Nada aqui pode subir:
      // quem chamou está no meio de um pagamento.
      logger.error(`Utmify: falha ao montar a venda ${registro.asaas_payment_id}:`, err.message);
      return false;
    }
  });
}

// Venda criada e ainda não paga. No PIX é o estado em que ela vive até o
// cliente pagar no app do banco; no cartão dura segundos, e é o que faz a
// venda aparecer no painel mesmo quando o cartão acaba recusado.
function vendaPendente(registro, { remoteIp = null } = {}) {
  return notificar(registro, { status: STATUS.pendente, remoteIp });
}

function vendaPaga(registro) {
  return notificar(registro, { status: STATUS.pago });
}

function vendaRecusada(registro) {
  return notificar(registro, { status: STATUS.falhou });
}

// Contestação de cartão (chargeback) e estorno comum são coisas diferentes no
// painel: um é fraude/disputa, o outro é devolução combinada. Mandar os dois
// como "refunded" esconderia justamente o que o fundador precisa ver.
function vendaEstornada(registro, { chargeback = false } = {}) {
  return notificar(registro, { status: chargeback ? STATUS.chargeback : STATUS.estornado });
}

module.exports = {
  isConfigured,
  vendaPendente,
  vendaPaga,
  vendaRecusada,
  vendaEstornada,
  aguardarEnvios,
  // Exportados para teste: é o formato do que sai daqui que a Utmify aceita
  // ou recusa, e ele precisa ser conferível sem subir um servidor falso.
  montarPedido,
  STATUS,
};
