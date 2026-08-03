// Unico lugar do codigo que importa o SDK da Stripe. Toda funcao aqui checa
// a chave antes de fazer qualquer chamada - sem STRIPE_SECRET_KEY
// configurada, lanca um erro claro em vez de deixar o SDK explodir com
// mensagem criptica. Nenhuma chave fica hardcoded - tudo vem de
// config.stripe (variavel de ambiente, ver src/config/index.js).
'use strict';

const Stripe = require('stripe');
const config = require('../config');

let stripeClient = null;

function getClient() {
  if (!config.stripe.secretKey) {
    throw new Error(
      'Stripe ainda nao configurado (falta STRIPE_SECRET_KEY) - peca as chaves ao usuario antes de usar essa funcionalidade.'
    );
  }
  if (!stripeClient) stripeClient = new Stripe(config.stripe.secretKey);
  return stripeClient;
}

function isConfigured() {
  return Boolean(config.stripe.secretKey);
}

async function ensureCustomer(existingCustomerId, { email, name, clientUserId }) {
  if (existingCustomerId) return existingCustomerId;
  const stripe = getClient();
  const customer = await stripe.customers.create({
    email,
    name: name || undefined,
    metadata: { clientUserId: String(clientUserId) },
  });
  return customer.id;
}

async function createCheckoutSessionForSubscription({ customerId, priceId, successUrl, cancelUrl, metadata }) {
  const stripe = getClient();
  return stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    metadata,
    success_url: successUrl,
    cancel_url: cancelUrl,
  });
}

// Muda o preco da assinatura ja existente (upgrade/downgrade de plano) sem
// prorated - a cota de credito ja e ajustada separadamente no proximo ciclo
// semanal (ver client_credits/creditWeeklyResetJob), entao nao queremos que
// a Stripe tambem tente cobrar/creditar diferenca no meio do mes.
async function changeSubscriptionPrice({ subscriptionId, priceId }) {
  const stripe = getClient();
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  return stripe.subscriptions.update(subscriptionId, {
    items: [{ id: subscription.items.data[0].id, price: priceId }],
    proration_behavior: 'none',
  });
}

async function cancelSubscription(subscriptionId) {
  const stripe = getClient();
  return stripe.subscriptions.cancel(subscriptionId);
}

// Pacote avulso de credito - pagamento unico (nao assinatura). Preco/minutos
// vem da tabela settings (credit_package_minutes/credit_package_price_cents),
// nao fica fixo no codigo.
async function createCheckoutSessionForPackage({ customerId, amountCents, minutes, bucket, successUrl, cancelUrl, metadata }) {
  const stripe = getClient();
  return stripe.checkout.sessions.create({
    mode: 'payment',
    customer: customerId,
    line_items: [
      {
        price_data: {
          currency: 'brl',
          unit_amount: amountCents,
          product_data: { name: `Pacote avulso de credito Post Flow (${minutes} min)` },
        },
        quantity: 1,
      },
    ],
    metadata: { ...metadata, bucket, minutes: String(minutes) },
    success_url: successUrl,
    cancel_url: cancelUrl,
  });
}

// Cadastra cartao pra cobranca automatica de excedente sem cobrar nada na
// hora (modo "setup") - o cartao so e debitado depois, pelo
// overageBillingJob semanal.
// Guarda o cartao do cliente pra cobrar o excedente DEPOIS, sem ele estar na
// tela (o overageBillingJob roda de hora em hora, sozinho).
//
// Dois parametros aqui nao sao opcionais, e a falta deles so aparece tarde:
//
//   currency  - a Stripe recusa a sessao de setup sem moeda quando o cliente
//               ainda nao tem uma definida. Era erro na hora de abrir a tela:
//               "Missing required param: currency".
//
// A sessao de setup ja guarda o cartao pronto pra uso futuro; quem declara
// que a cobranca acontece com o cliente ausente e o off_session:true na hora
// de pagar a fatura (ver createInvoiceItemsAndPay). Sem esse par, cobranca
// automatica de excedente e recusada por autenticacao pendente - e o cliente
// nem estaria online pra autenticar.
async function createSetupSessionForOverageCard({ customerId, successUrl, cancelUrl, metadata }) {
  const stripe = getClient();
  return stripe.checkout.sessions.create({
    mode: 'setup',
    currency: 'brl',
    customer: customerId,
    metadata,
    success_url: successUrl,
    cancel_url: cancelUrl,
  });
}

async function retrieveSetupIntent(setupIntentId) {
  const stripe = getClient();
  return stripe.setupIntents.retrieve(setupIntentId);
}

// Marca o cartao como padrao do customer na Stripe - e o que
// overageBillingJob usa (default_payment_method) pra cobrar off-session.
async function setDefaultPaymentMethod(customerId, paymentMethodId) {
  const stripe = getClient();
  return stripe.customers.update(customerId, { invoice_settings: { default_payment_method: paymentMethodId } });
}

function constructWebhookEvent(rawBody, signature) {
  if (!config.stripe.webhookSecret) {
    throw new Error('Stripe ainda não configurado (falta STRIPE_WEBHOOK_SECRET).');
  }
  const stripe = getClient();
  return stripe.webhooks.constructEvent(rawBody, signature, config.stripe.webhookSecret);
}

// Fecha a fatura de excedente do ciclo: um item por cobranca pendente,
// cobrado do cartao padrao do cliente (off-session, o cliente ja nao esta
// no painel nesse momento - e um job de fundo semanal).
async function createInvoiceItemsAndPay({ customerId, paymentMethodId, items }) {
  const stripe = getClient();
  for (const item of items) {
    await stripe.invoiceItems.create({
      customer: customerId,
      amount: item.amountCents,
      currency: 'brl',
      description: item.description,
    });
  }
  // auto_advance FALSE de proposito. Com true, a Stripe finaliza e cobra
  // sozinha em segundo plano; o pay() logo abaixo entao explodia com "Invoice
  // is already paid". E o pior nao era o erro: o overageBillingJob trata
  // exceção como falha de cobranca e deixa os lancamentos como 'pendente',
  // entao na hora seguinte ele criava os itens DE NOVO e cobrava o cliente
  // uma segunda vez. Controlando finalize+pay aqui, o resultado da cobranca e
  // o que a funcao devolve, e so entao os lancamentos sao marcados como pagos.
  const invoice = await stripe.invoices.create({
    customer: customerId,
    auto_advance: false,
    default_payment_method: paymentMethodId,
    collection_method: 'charge_automatically',
    // Sem isto a fatura nasce VAZIA. Os invoiceItems acima ficam "pendentes"
    // no cliente, e as versoes atuais da API nao os puxam por padrao: a
    // cobranca saia com total R$ 0,00, a Stripe marcava como paga, o job
    // marcava os lancamentos como pagos, e o cliente nunca era cobrado pelo
    // excedente. Falha silenciosa: tudo "funcionava", so nao entrava dinheiro.
    pending_invoice_items_behavior: 'include',
  });
  // Finalizar uma fatura com collection_method 'charge_automatically' JA
  // dispara a cobranca. Chamar pay() em seguida explodia com "Invoice is
  // already paid" - e como o overageBillingJob trata exceção como falha, os
  // lancamentos ficavam 'pendente' e o cliente era cobrado DE NOVO na hora
  // seguinte. Por isso conferimos o status antes: so chamamos pay() se a
  // fatura realmente ficou em aberto.
  const finalized = await stripe.invoices.finalizeInvoice(invoice.id);
  if (finalized.status === 'paid') return finalized;
  // off_session: true diz a Stripe que ninguem esta na frente da tela pra
  // responder a um desafio do banco - e o caso do excedente, cobrado por um
  // job de fundo.
  return stripe.invoices.pay(finalized.id, { off_session: true });
}

// Cobranca imediata de UM video, no cartao ja salvo, sem ninguem na frente da
// tela. Diferente de createInvoiceItemsAndPay (que junta o excedente acumulado
// numa fatura): aqui e um pagamento so, avulso, cobrado ANTES de processar.
//
// Devolve { ok, id, motivo }. Nao lanca excecao em recusa de cartao: cartao
// recusado e um resultado esperado do fluxo (o video fica esperando e o cliente
// e avisado), nao um erro de programa.
async function chargeNow({ customerId, paymentMethodId, amountCents, description, metadata = {} }) {
  const stripe = getClient();
  try {
    const intent = await stripe.paymentIntents.create({
      customer: customerId,
      payment_method: paymentMethodId,
      amount: amountCents,
      currency: 'brl',
      description,
      metadata,
      // Ninguem esta olhando a tela: se o banco pedir confirmacao (3-D Secure),
      // nao ha como responder. A Stripe entao recusa com um erro claro em vez
      // de deixar o pagamento pendurado esperando alguem que nao vai aparecer.
      off_session: true,
      confirm: true,
    });
    if (intent.status === 'succeeded') return { ok: true, id: intent.id };
    return { ok: false, id: intent.id, motivo: `Pagamento ficou em "${intent.status}".` };
  } catch (err) {
    // Recusa de cartao chega como excecao no SDK, mas e resultado, nao falha.
    return { ok: false, id: err.raw?.payment_intent?.id || null, motivo: err.message };
  }
}

async function createProductAndPrice({ name, priceCents, intervalMonths }) {
  const stripe = getClient();
  const product = await stripe.products.create({ name });
  const price = await stripe.prices.create({
    product: product.id,
    currency: 'brl',
    unit_amount: priceCents,
    recurring: { interval: 'month', interval_count: intervalMonths || 1 },
  });
  return { productId: product.id, priceId: price.id };
}

module.exports = {
  chargeNow,
  isConfigured,
  ensureCustomer,
  createCheckoutSessionForSubscription,
  changeSubscriptionPrice,
  cancelSubscription,
  createCheckoutSessionForPackage,
  createSetupSessionForOverageCard,
  retrieveSetupIntent,
  setDefaultPaymentMethod,
  constructWebhookEvent,
  createInvoiceItemsAndPay,
  createProductAndPrice,
};
