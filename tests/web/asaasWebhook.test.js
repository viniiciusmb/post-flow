// O webhook do Asaas: é por aqui que o dinheiro vira crédito.
//
// A tela de retorno depois do pagamento não serve para confirmar nada — o
// cliente pode fechar o navegador, e no PIX ele paga no app do banco e nunca
// volta ao site. Só o aviso do Asaas é confiável, e é ele que libera crédito.
// Ou seja: todo erro aqui é erro com dinheiro no meio.
//
// O que estes testes travam:
//   - sem o token combinado, nada acontece (o endereço é público);
//   - aviso repetido NÃO credita duas vezes (o Asaas entrega "pelo menos uma
//     vez", então repetição é o normal, não a exceção);
//   - checkout desconhecido não derruba o endpoint;
//   - assinatura ativa o plano e aplica a cota;
//   - checkout expirado não credita e para de mentir "pendente" no histórico;
//   - renovação mensal reativa quem estava inadimplente;
//   - erro nosso responde 500 (o Asaas reenvia) e não 200 (que perderia o aviso).
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const pool = require('../../src/db/pool');
const config = require('../../src/config');
const { startServer, stopServer, createLoginableClient } = require('../helpers/http');
const asaasCheckoutsRepository = require('../../src/repositories/asaasCheckoutsRepository');
const creditPurchasesRepository = require('../../src/repositories/creditPurchasesRepository');
const clientSubscriptionsRepository = require('../../src/repositories/clientSubscriptionsRepository');
const subscriptionPlansRepository = require('../../src/repositories/subscriptionPlansRepository');
const { readCredits } = require('../helpers/db');

const TOKEN = 'token-secreto-do-webhook-asaas';
let baseUrl;

test.before(async () => {
  baseUrl = await startServer();
  config.asaas.webhookToken = TOKEN;
  // Chave presente só para o serviço se considerar configurado; nenhum teste
  // aqui sai para a rede (o webhook é o Asaas falando conosco, não o contrário).
  config.asaas.apiKey = '$aact_hmlg_teste';
  config.asaas.environment = 'sandbox';
});

test.after(async () => {
  await stopServer();
  await pool.end();
});

async function enviarWebhook(corpo, { token = TOKEN } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (token !== null) headers['asaas-access-token'] = token;
  const r = await fetch(`${baseUrl}/api/asaas/webhook`, {
    method: 'POST',
    headers,
    body: JSON.stringify(corpo),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}

let contador = 0;
function idDeCheckout() {
  contador += 1;
  return `chk_${contador}_${Date.now()}`;
}

async function compraPendente(clientUserId, { minutes = 100, bucket = 'normal', amountCents = 2500 } = {}) {
  const compra = await creditPurchasesRepository.create({
    clientUserId, bucket, minutes, amountCents, provider: 'asaas',
  });
  const checkoutId = idDeCheckout();
  await asaasCheckoutsRepository.create({
    asaasCheckoutId: checkoutId,
    clientUserId,
    purpose: 'credit_package',
    creditPurchaseId: compra.id,
    amountCents,
  });
  return { compra, checkoutId };
}

test('sem o token combinado, o webhook é recusado e nada acontece', async () => {
  const cliente = await createLoginableClient();
  const { compra, checkoutId } = await compraPendente(cliente.id);

  const semToken = await enviarWebhook({ event: 'CHECKOUT_PAID', checkout: { id: checkoutId } }, { token: null });
  assert.equal(semToken.status, 401);

  const tokenErrado = await enviarWebhook(
    { event: 'CHECKOUT_PAID', checkout: { id: checkoutId } },
    { token: 'token-de-atacante' }
  );
  assert.equal(tokenErrado.status, 401);

  // O ponto do teste: o endereço é público, então sem essa checagem qualquer
  // um ganharia crédito de graça só avisando "paguei".
  const depois = await creditPurchasesRepository.findById(compra.id);
  assert.equal(depois.status, 'pendente');
  const creditos = await readCredits(cliente.id);
  assert.ok(!creditos || creditos.extra_normal === 0);
});

test('checkout pago libera o crédito comprado', async () => {
  const cliente = await createLoginableClient();
  const { compra, checkoutId } = await compraPendente(cliente.id, { minutes: 150 });

  const r = await enviarWebhook({ event: 'CHECKOUT_PAID', checkout: { id: checkoutId } });
  assert.equal(r.status, 200);

  const depois = await creditPurchasesRepository.findById(compra.id);
  assert.equal(depois.status, 'pago');

  const creditos = await readCredits(cliente.id);
  assert.equal(creditos.extra_normal, 150);
});

test('aviso repetido NÃO credita duas vezes', async () => {
  const cliente = await createLoginableClient();
  const { checkoutId } = await compraPendente(cliente.id, { minutes: 200 });

  await enviarWebhook({ event: 'CHECKOUT_PAID', checkout: { id: checkoutId } });
  const segundo = await enviarWebhook({ event: 'CHECKOUT_PAID', checkout: { id: checkoutId } });
  const terceiro = await enviarWebhook({ event: 'CHECKOUT_PAID', checkout: { id: checkoutId } });

  // Repetição tem que ser aceita (2xx), senão o Asaas pausa a fila da conta.
  assert.equal(segundo.status, 200);
  assert.equal(terceiro.status, 200);

  const creditos = await readCredits(cliente.id);
  assert.equal(creditos.extra_normal, 200, 'creditou mais de uma vez o mesmo pagamento');
});

test('checkout que não é nosso não derruba o endpoint', async () => {
  const r = await enviarWebhook({ event: 'CHECKOUT_PAID', checkout: { id: 'chk_de_outro_sistema' } });
  assert.equal(r.status, 200, 'tem que responder 2xx - 15 recusas seguidas pausam a fila da conta');
});

test('assinatura paga ativa o plano e aplica a cota', async () => {
  const cliente = await createLoginableClient();
  const planos = await subscriptionPlansRepository.listActive();
  const plano = planos[0];

  const checkoutId = idDeCheckout();
  await clientSubscriptionsRepository.getOrCreate(cliente.id);
  await asaasCheckoutsRepository.create({
    asaasCheckoutId: checkoutId,
    clientUserId: cliente.id,
    purpose: 'subscription',
    planId: plano.id,
    amountCents: plano.price_cents,
  });

  const r = await enviarWebhook({
    event: 'CHECKOUT_PAID',
    checkout: { id: checkoutId, customer: 'cus_teste_123' },
  });
  assert.equal(r.status, 200);

  const assinatura = await clientSubscriptionsRepository.getOrCreate(cliente.id);
  assert.equal(Number(assinatura.plan_id), Number(plano.id));
  assert.equal(assinatura.status, 'ativo');
  assert.equal(assinatura.asaas_customer_id, 'cus_teste_123');
  assert.equal(assinatura.subscription_provider, 'asaas');

  // A cota do plano entra na hora na primeira ativação - senão o cliente
  // pagaria e continuaria sem conseguir processar nada até o reset semanal.
  const creditos = await readCredits(cliente.id);
  assert.ok(creditos.quota_normal > 0, 'a cota do plano tem que ser aplicada na ativação');
});

test('checkout expirado não credita e para de mentir "pendente" no histórico', async () => {
  const cliente = await createLoginableClient();
  const { compra, checkoutId } = await compraPendente(cliente.id, { minutes: 75 });

  const r = await enviarWebhook({ event: 'CHECKOUT_EXPIRED', checkout: { id: checkoutId } });
  assert.equal(r.status, 200);

  const depois = await creditPurchasesRepository.findById(compra.id);
  assert.equal(depois.status, 'falhou');

  const creditos = await readCredits(cliente.id);
  assert.ok(!creditos || creditos.extra_normal === 0, 'expirar não pode creditar nada');
});

test('aviso de expiração que chega DEPOIS do pagamento não desfaz o crédito', async () => {
  const cliente = await createLoginableClient();
  const { compra, checkoutId } = await compraPendente(cliente.id, { minutes: 50 });

  await enviarWebhook({ event: 'CHECKOUT_PAID', checkout: { id: checkoutId } });
  // O Asaas pode entregar fora de ordem; um "expirou" atrasado não pode
  // transformar uma compra paga em falha.
  await enviarWebhook({ event: 'CHECKOUT_EXPIRED', checkout: { id: checkoutId } });

  const depois = await creditPurchasesRepository.findById(compra.id);
  assert.equal(depois.status, 'pago');
  const creditos = await readCredits(cliente.id);
  assert.equal(creditos.extra_normal, 50);
});

test('pagamento avisado SEM o CHECKOUT_PAID ainda libera o crédito', async () => {
  // Achado num teste real: um PIX de checkout confirmado pelo painel do Asaas
  // gerou PAYMENT_RECEIVED e nenhum CHECKOUT_PAID. Sem esta rede de
  // segurança, o cliente pagava e ficava sem crédito.
  const cliente = await createLoginableClient();
  const { compra, checkoutId } = await compraPendente(cliente.id, { minutes: 60 });

  const r = await enviarWebhook({
    event: 'PAYMENT_RECEIVED',
    payment: { id: 'pay_sem_checkout_paid', checkoutSession: checkoutId, customer: 'cus_x', value: 15.0 },
  });
  assert.equal(r.status, 200);

  const depois = await creditPurchasesRepository.findById(compra.id);
  assert.equal(depois.status, 'pago');
  const creditos = await readCredits(cliente.id);
  assert.equal(creditos.extra_normal, 60);
});

test('receber os DOIS avisos do mesmo pagamento credita uma vez só', async () => {
  const cliente = await createLoginableClient();
  const { checkoutId } = await compraPendente(cliente.id, { minutes: 80 });

  await enviarWebhook({ event: 'CHECKOUT_PAID', checkout: { id: checkoutId } });
  await enviarWebhook({
    event: 'PAYMENT_RECEIVED',
    payment: { id: 'pay_dobrado', checkoutSession: checkoutId, customer: 'cus_y', value: 20.0 },
  });

  const creditos = await readCredits(cliente.id);
  assert.equal(creditos.extra_normal, 80, 'os dois avisos do mesmo pagamento não podem creditar duas vezes');
});

test('mensalidade paga reativa quem estava inadimplente', async () => {
  const cliente = await createLoginableClient();
  const planos = await subscriptionPlansRepository.listActive();
  await clientSubscriptionsRepository.getOrCreate(cliente.id);
  await clientSubscriptionsRepository.setPlan(cliente.id, planos[0].id);
  await clientSubscriptionsRepository.setAsaasSubscription(cliente.id, {
    customerId: 'cus_renov',
    subscriptionId: 'sub_renov_1',
  });
  await clientSubscriptionsRepository.setStatus(cliente.id, 'inadimplente');

  const r = await enviarWebhook({
    event: 'PAYMENT_RECEIVED',
    payment: { id: 'pay_1', subscription: 'sub_renov_1', value: 197.0 },
  });
  assert.equal(r.status, 200);

  const assinatura = await clientSubscriptionsRepository.getOrCreate(cliente.id);
  assert.equal(assinatura.status, 'ativo');
});

test('mensalidade vencida marca inadimplente', async () => {
  const cliente = await createLoginableClient();
  const planos = await subscriptionPlansRepository.listActive();
  await clientSubscriptionsRepository.getOrCreate(cliente.id);
  await clientSubscriptionsRepository.setPlan(cliente.id, planos[0].id);
  await clientSubscriptionsRepository.setAsaasSubscription(cliente.id, {
    customerId: 'cus_venc',
    subscriptionId: 'sub_venc_1',
  });
  await clientSubscriptionsRepository.setStatus(cliente.id, 'ativo');

  await enviarWebhook({
    event: 'PAYMENT_OVERDUE',
    payment: { id: 'pay_venc', subscription: 'sub_venc_1', value: 197.0 },
  });

  const assinatura = await clientSubscriptionsRepository.getOrCreate(cliente.id);
  assert.equal(assinatura.status, 'inadimplente');
});

test('evento que não nos interessa é aceito sem fazer nada', async () => {
  const r = await enviarWebhook({ event: 'PAYMENT_BANK_SLIP_VIEWED', payment: { id: 'pay_x' } });
  assert.equal(r.status, 200);
});

test('corpo sem evento é recusado', async () => {
  const r = await enviarWebhook({ semEvento: true });
  assert.equal(r.status, 400);
});

// ---------- PIX Automático ----------
//
// O cliente lê um QR Code que paga a primeira mensalidade E autoriza as
// próximas. Ele sai do nosso site para o app do banco e pode nunca voltar —
// então o aviso do Asaas é a ÚNICA forma de saber que a assinatura começou.

const asaasPixAuthorizationsRepository = require('../../src/repositories/asaasPixAuthorizationsRepository');

async function autorizacaoPendente(clientUserId, plano) {
  contador += 1;
  const id = `auth_${contador}_${Date.now()}`;
  await clientSubscriptionsRepository.getOrCreate(clientUserId);
  await asaasPixAuthorizationsRepository.create({
    asaasAuthorizationId: id,
    clientUserId,
    planId: plano.id,
    asaasCustomerId: `cus_pix_${contador}`,
    amountCents: plano.price_cents,
  });
  return id;
}

test('autorização de PIX ativada liga o plano e aplica a cota', async () => {
  const cliente = await createLoginableClient();
  const planos = await subscriptionPlansRepository.listActive();
  const id = await autorizacaoPendente(cliente.id, planos[0]);

  const r = await enviarWebhook({
    event: 'PIX_AUTOMATIC_RECURRING_AUTHORIZATION_ACTIVATED',
    pixAutomaticAuthorization: id,
  });
  assert.equal(r.status, 200);

  const assinatura = await clientSubscriptionsRepository.getOrCreate(cliente.id);
  assert.equal(assinatura.status, 'ativo');
  assert.equal(Number(assinatura.plan_id), Number(planos[0].id));
  assert.equal(assinatura.subscription_provider, 'asaas_pix');
  assert.equal(assinatura.asaas_pix_authorization_id, id);

  const creditos = await readCredits(cliente.id);
  assert.ok(creditos.quota_normal > 0);
});

test('ativação repetida não aplica a cota duas vezes', async () => {
  const cliente = await createLoginableClient();
  const planos = await subscriptionPlansRepository.listActive();
  const id = await autorizacaoPendente(cliente.id, planos[0]);

  await enviarWebhook({ event: 'PIX_AUTOMATIC_RECURRING_AUTHORIZATION_ACTIVATED', pixAutomaticAuthorization: id });
  const cotaDepoisDeUma = (await readCredits(cliente.id)).quota_normal;

  await enviarWebhook({ event: 'PIX_AUTOMATIC_RECURRING_AUTHORIZATION_ACTIVATED', pixAutomaticAuthorization: id });
  const cotaDepoisDeDuas = (await readCredits(cliente.id)).quota_normal;

  assert.equal(cotaDepoisDeDuas, cotaDepoisDeUma, 'aviso repetido não pode dobrar a cota do plano');
});

test('autorização recusada no banco não liga plano nenhum', async () => {
  const cliente = await createLoginableClient();
  const planos = await subscriptionPlansRepository.listActive();
  const id = await autorizacaoPendente(cliente.id, planos[0]);

  await enviarWebhook({ event: 'PIX_AUTOMATIC_RECURRING_AUTHORIZATION_REFUSED', pixAutomaticAuthorization: id });

  const assinatura = await clientSubscriptionsRepository.getOrCreate(cliente.id);
  assert.notEqual(assinatura.status, 'ativo');
  const autorizacao = await asaasPixAuthorizationsRepository.findByAsaasId(id);
  assert.equal(autorizacao.status, 'recusada');
});

test('cancelar a autorização depois de ativa marca inadimplente', async () => {
  const cliente = await createLoginableClient();
  const planos = await subscriptionPlansRepository.listActive();
  const id = await autorizacaoPendente(cliente.id, planos[0]);

  await enviarWebhook({ event: 'PIX_AUTOMATIC_RECURRING_AUTHORIZATION_ACTIVATED', pixAutomaticAuthorization: id });
  await enviarWebhook({ event: 'PIX_AUTOMATIC_RECURRING_AUTHORIZATION_CANCELLED', pixAutomaticAuthorization: id });

  // Sem autorização não há cobrança - mas não cancelamos de imediato: pode
  // ter sido engano, e ele pode autorizar de novo.
  const assinatura = await clientSubscriptionsRepository.getOrCreate(cliente.id);
  assert.equal(assinatura.status, 'inadimplente');
});

test('recusa atrasada NÃO derruba uma autorização que já ativou', async () => {
  const cliente = await createLoginableClient();
  const planos = await subscriptionPlansRepository.listActive();
  const id = await autorizacaoPendente(cliente.id, planos[0]);

  await enviarWebhook({ event: 'PIX_AUTOMATIC_RECURRING_AUTHORIZATION_ACTIVATED', pixAutomaticAuthorization: id });
  await enviarWebhook({ event: 'PIX_AUTOMATIC_RECURRING_AUTHORIZATION_EXPIRED', pixAutomaticAuthorization: id });

  const autorizacao = await asaasPixAuthorizationsRepository.findByAsaasId(id);
  assert.equal(autorizacao.status, 'ativa', 'aviso fora de ordem não pode desfazer uma ativação');
  const assinatura = await clientSubscriptionsRepository.getOrCreate(cliente.id);
  assert.equal(assinatura.status, 'ativo');
});

