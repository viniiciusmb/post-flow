// O caminho completo do estorno, pelo webhook do Asaas — que é o provedor de
// pagamento de verdade do sistema.
//
// Antes disto, TODO evento de estorno caía no `default:` do webhook e era
// ignorado em silêncio: o dinheiro voltava para o cliente, a comissão do
// afiliado continuava creditada e sacável, o plano seguia ativo, o crédito
// avulso seguia no saldo e as conexões extras seguiam liberadas.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const pool = require('../../src/db/pool');
const config = require('../../src/config');
const { startServer, stopServer, createLoginableClient } = require('../helpers/http');
const asaasPaymentsRepository = require('../../src/repositories/asaasPaymentsRepository');
const creditPurchasesRepository = require('../../src/repositories/creditPurchasesRepository');
const clientCreditsRepository = require('../../src/repositories/clientCreditsRepository');
const clientSubscriptionsRepository = require('../../src/repositories/clientSubscriptionsRepository');
const subscriptionPlansRepository = require('../../src/repositories/subscriptionPlansRepository');
const affiliateLinksRepository = require('../../src/repositories/affiliateLinksRepository');
const affiliatesRepository = require('../../src/repositories/affiliatesRepository');
const referralsRepository = require('../../src/repositories/referralsRepository');
const affiliateService = require('../../src/services/affiliateService');
const settingsRepository = require('../../src/repositories/settingsRepository');
const { readCredits } = require('../helpers/db');

const TOKEN = 'token-secreto-do-webhook-asaas';
let baseUrl;

test.before(async () => {
  baseUrl = await startServer();
  config.asaas.webhookToken = TOKEN;
  config.asaas.apiKey = '$aact_hmlg_teste';
  config.asaas.environment = 'sandbox';
});

test.after(async () => {
  await stopServer();
  await pool.end();
});

async function enviar(corpo) {
  const r = await fetch(`${baseUrl}/api/asaas/webhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'asaas-access-token': TOKEN },
    body: JSON.stringify(corpo),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}

let n = 0;
function idPagamento() {
  n += 1;
  return `pay_wh_${process.pid}_${n}_${Date.now()}`;
}

// Cobrança de mensalidade já paga, com afiliado por trás — o cenário em que o
// estorno custa dinheiro de dois jeitos ao mesmo tempo.
async function mensalidadePagaComAfiliado() {
  await settingsRepository.setValue('affiliate_commission_percent_default', 20);
  await settingsRepository.setValue('affiliate_commission_recurring_percent_default', 5);
  await settingsRepository.setValue('affiliate_commission_max_months', 12);

  const afiliado = await createLoginableClient();
  const link = await affiliateLinksRepository.getOrCreateDefault(afiliado.id);
  const cliente = await createLoginableClient();
  await referralsRepository.create({
    referredUserId: cliente.id,
    affiliateLinkId: link.id,
    referrerUserId: afiliado.id,
  });

  const plano = await subscriptionPlansRepository.findByKey('pro');
  const paymentId = idPagamento();
  await asaasPaymentsRepository.create({
    asaasPaymentId: paymentId,
    clientUserId: cliente.id,
    purpose: 'subscription',
    planId: plano.id,
    billingType: 'CREDIT_CARD',
    amountCents: 10000,
  });
  await asaasPaymentsRepository.markPaidOnce(paymentId);
  await clientSubscriptionsRepository.setPlan(cliente.id, plano.id);
  await clientSubscriptionsRepository.setStatus(cliente.id, 'ativo');
  await affiliateService.recordCommissionForPayment({
    clientUserId: cliente.id,
    provider: 'asaas',
    externalPaymentId: paymentId,
    amountPaidCents: 10000,
  });

  return { afiliado, cliente, paymentId, plano };
}

test('PAYMENT_REFUNDED tira a comissao do afiliado e deixa o cliente inadimplente', async () => {
  const { afiliado, cliente, paymentId } = await mensalidadePagaComAfiliado();
  assert.equal((await affiliatesRepository.getOrCreate(afiliado.id)).balance_available_cents, 2000);

  const r = await enviar({ event: 'PAYMENT_REFUNDED', payment: { id: paymentId, value: 100 } });

  assert.equal(r.status, 200);
  assert.equal((await affiliatesRepository.getOrCreate(afiliado.id)).balance_available_cents, 0);
  assert.equal((await clientSubscriptionsRepository.getOrCreate(cliente.id)).status, 'inadimplente');
  assert.equal((await asaasPaymentsRepository.findByAsaasId(paymentId)).status, 'estornado');
});

test('contestacao no cartao (chargeback) age na hora, sem esperar o julgamento', async () => {
  // O valor é retido no momento em que a contestação é aberta. Esperar o
  // julgamento deixaria a comissão sacável por semanas — e saque não volta.
  const { afiliado, paymentId } = await mensalidadePagaComAfiliado();

  await enviar({ event: 'PAYMENT_CHARGEBACK_REQUESTED', payment: { id: paymentId } });

  assert.equal((await affiliatesRepository.getOrCreate(afiliado.id)).balance_available_cents, 0);
});

test('o mesmo aviso de estorno chegando duas vezes debita uma vez so', async () => {
  const { afiliado, paymentId } = await mensalidadePagaComAfiliado();

  await enviar({ event: 'PAYMENT_REFUNDED', payment: { id: paymentId } });
  await enviar({ event: 'PAYMENT_REFUNDED', payment: { id: paymentId } });
  await enviar({ event: 'PAYMENT_CHARGEBACK_DISPUTE', payment: { id: paymentId } });

  assert.equal((await affiliatesRepository.getOrCreate(afiliado.id)).balance_available_cents, 0);
});

test('contestacao ganha (PAYMENT_RESTORED) devolve a comissao e reativa o cliente', async () => {
  const { afiliado, cliente, paymentId } = await mensalidadePagaComAfiliado();
  await enviar({ event: 'PAYMENT_CHARGEBACK_REQUESTED', payment: { id: paymentId } });

  await enviar({ event: 'PAYMENT_RESTORED', payment: { id: paymentId } });

  assert.equal((await affiliatesRepository.getOrCreate(afiliado.id)).balance_available_cents, 2000);
  assert.equal((await clientSubscriptionsRepository.getOrCreate(cliente.id)).status, 'ativo');
  assert.equal((await asaasPaymentsRepository.findByAsaasId(paymentId)).status, 'pago');
});

test('credito avulso estornado tira do saldo o que ainda nao foi usado', async () => {
  const cliente = await createLoginableClient();
  const compra = await creditPurchasesRepository.create({
    clientUserId: cliente.id, bucket: 'normal', minutes: 100, amountCents: 4990, provider: 'asaas',
  });
  const paymentId = idPagamento();
  await asaasPaymentsRepository.create({
    asaasPaymentId: paymentId,
    clientUserId: cliente.id,
    purpose: 'credit_package',
    creditPurchaseId: compra.id,
    billingType: 'PIX',
    amountCents: 4990,
  });
  await asaasPaymentsRepository.markPaidOnce(paymentId);
  await creditPurchasesRepository.markPaidById(compra.id, paymentId);
  await clientCreditsRepository.addExtra(cliente.id, 'normal', 100);
  // O cliente gastou 40 dos 100 antes do estorno.
  await clientCreditsRepository.reserve(cliente.id, 'normal', 40);

  await enviar({ event: 'PAYMENT_REFUNDED', payment: { id: paymentId } });

  const creditos = await readCredits(cliente.id);
  assert.equal(
    creditos.extra_normal,
    0,
    'o saldo que sobrou volta; os 40 ja usados nao tem como desfazer (o video ja foi processado)'
  );
  assert.equal((await creditPurchasesRepository.findById(compra.id)).status, 'estornado');
});

test('conexoes extras estornadas devolvem o limite ao que era antes', async () => {
  const cliente = await createLoginableClient();
  // Plano Max ativo: e o unico que vende conexao extra, entao e o unico
  // cenario em que este estorno existe. Com o cliente sem plano, o ajuste da
  // recorrencia entende que nao ha nada a cobrar e ZERA os extras - correto
  // para o caso dele, e um cenario impossivel para este teste.
  //
  // E getOrCreate antes do setExtras: setExtras e um UPDATE puro e nao faz
  // nada se a linha da assinatura ainda nao existe.
  await clientSubscriptionsRepository.getOrCreate(cliente.id);
  const max = await subscriptionPlansRepository.findByKey('max');
  await clientSubscriptionsRepository.setPlan(cliente.id, max.id);
  await clientSubscriptionsRepository.setStatus(cliente.id, 'ativo');
  await clientSubscriptionsRepository.setExtras(cliente.id, { canais: 2, contas: 1 });
  const paymentId = idPagamento();
  await asaasPaymentsRepository.create({
    asaasPaymentId: paymentId,
    clientUserId: cliente.id,
    purpose: 'extra_slots',
    // `slots` (o total) continua sendo preenchido porque a constraint
    // chk_asaas_payments_alvo, criada na migration 073, ainda o exige - a 078
    // separou a informacao em duas colunas mas nao mexeu na constraint. O
    // codigo de producao faz igual (ver checkoutService).
    slots: 2,
    extraChannels: 1,
    extraTiktokAccounts: 1,
    billingType: 'CREDIT_CARD',
    amountCents: 3990,
  });
  await asaasPaymentsRepository.markPaidOnce(paymentId);

  await enviar({ event: 'PAYMENT_REFUNDED', payment: { id: paymentId } });

  const assinatura = await clientSubscriptionsRepository.getOrCreate(cliente.id);
  assert.equal(Number(assinatura.extra_channels), 1);
  assert.equal(Number(assinatura.extra_tiktok_accounts), 0);
});

test('estorno de cobranca que nunca foi paga nao desfaz nada', async () => {
  const cliente = await createLoginableClient();
  const paymentId = idPagamento();
  await asaasPaymentsRepository.create({
    asaasPaymentId: paymentId,
    clientUserId: cliente.id,
    purpose: 'subscription',
    planId: (await subscriptionPlansRepository.findByKey('pro')).id,
    billingType: 'PIX',
    amountCents: 10000,
  });

  await enviar({ event: 'PAYMENT_REFUNDED', payment: { id: paymentId } });

  assert.equal((await asaasPaymentsRepository.findByAsaasId(paymentId)).status, 'pendente');
});

test('estorno de pagamento desconhecido responde 200 e nao derruba o webhook', async () => {
  const r = await enviar({ event: 'PAYMENT_REFUNDED', payment: { id: 'pay_que_nunca_existiu' } });
  assert.equal(r.status, 200);
});

