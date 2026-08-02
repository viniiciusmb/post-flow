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
async function createSetupSessionForOverageCard({ customerId, successUrl, cancelUrl, metadata }) {
  const stripe = getClient();
  return stripe.checkout.sessions.create({
    mode: 'setup',
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
  const invoice = await stripe.invoices.create({
    customer: customerId,
    auto_advance: true,
    default_payment_method: paymentMethodId,
    collection_method: 'charge_automatically',
  });
  const finalized = await stripe.invoices.finalizeInvoice(invoice.id);
  return stripe.invoices.pay(finalized.id);
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
