// Avisos do Asaas sobre assinatura encerrada e cartão recusado depois da
// análise - e a lista de eventos que a conta precisa assinar.
//
// A varredura da lista existe por causa do que foi achado em 15/09/2026: a
// conta de produção assinava só 10 eventos, e todo o tratamento de estorno e
// contestação (feito em 09/09) nunca recebeu um aviso sequer. Um `case` sem o
// evento assinado é código morto que parece funcionar.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const pool = require('../../src/db/pool');
const config = require('../../src/config');
const { startServer, stopServer } = require('../helpers/http');
const clientSubscriptionsRepository = require('../../src/repositories/clientSubscriptionsRepository');
const subscriptionPlansRepository = require('../../src/repositories/subscriptionPlansRepository');
const asaasPaymentsRepository = require('../../src/repositories/asaasPaymentsRepository');
const EVENTOS = require('../../src/config/asaasWebhookEvents');
const { comAsaasFalso, respostasPadrao } = require('../helpers/asaasFalso');
const { createClient } = require('../helpers/db');

const TOKEN = 'token-secreto-do-webhook-asaas-assinaturas';
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

async function enviarWebhook(corpo) {
  const r = await fetch(`${baseUrl}/api/asaas/webhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'asaas-access-token': TOKEN },
    body: JSON.stringify(corpo),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}

let n = 0;
function idUnico(prefixo) {
  n += 1;
  return `${prefixo}_${process.pid}_${Date.now()}_${n}`;
}

test('todo evento que o webhook trata está na lista que a conta do Asaas assina', () => {
  const fonte = fs.readFileSync(
    path.join(__dirname, '../../src/web/controllers/api/asaasWebhookApiController.js'),
    'utf8'
  );
  const tratados = [...fonte.matchAll(/case '([A-Z_]+)':/g)].map((m) => m[1]);
  assert.ok(tratados.length > 10, 'a varredura não achou os case do webhook - o formato do arquivo mudou?');

  const naoAssinados = tratados.filter((e) => !EVENTOS.includes(e));
  assert.deepEqual(naoAssinados, [], `eventos tratados no código mas não assinados no Asaas: ${naoAssinados.join(', ')}`);

  // O outro sentido: assinar um evento que ninguém trata só enche o log.
  const semTratamento = EVENTOS.filter((e) => !tratados.includes(e));
  assert.deepEqual(semTratamento, []);
});

test('SUBSCRIPTION_DELETED agenda o cancelamento para o fim do período pago', async () => {
  const cliente = await createClient();
  const [plano] = await subscriptionPlansRepository.listActive();
  await clientSubscriptionsRepository.setPlan(cliente.id, plano.id);
  const subId = idUnico('sub_hook');
  await clientSubscriptionsRepository.setAsaasSubscription(cliente.id, { customerId: 'cus_hook', subscriptionId: subId });
  await pool.query(
    `INSERT INTO revenue_entries (client_user_id, kind, provider, external_id, plan_id, amount_cents, paid_at)
     VALUES ($1, 'primeira_mensalidade', 'asaas', $2, $3, 9990, now() - interval '3 days')`,
    [cliente.id, idUnico('pay_hook'), plano.id]
  );

  const r = await enviarWebhook({
    event: 'SUBSCRIPTION_DELETED',
    subscription: { id: subId, customer: 'cus_hook', status: 'INACTIVE', deleted: true },
  });
  assert.equal(r.status, 200);

  const depois = await clientSubscriptionsRepository.getOrCreate(cliente.id);
  assert.equal(depois.status, 'ativo');
  assert.ok(depois.cancel_at, 'o cancelamento tem que ficar registrado');
});

test('SUBSCRIPTION_INACTIVATED de uma assinatura que não é nossa é aceito sem fazer nada', async () => {
  const r = await enviarWebhook({ event: 'SUBSCRIPTION_INACTIVATED', subscription: { id: idUnico('sub_alheia') } });
  assert.equal(r.status, 200, 'responder erro aqui pausaria a fila de avisos da conta inteira');
});

test('cartão reprovado depois da análise: a venda falha e a recorrência criada junto é desfeita', async () => {
  const cliente = await createClient();
  const [plano] = await subscriptionPlansRepository.listActive();
  const subId = idUnico('sub_reprovada');
  const payId = idUnico('pay_reprovado');
  // O estado que assinarComCartaoSalvo deixa quando o cartão fica "em análise":
  // recorrência criada, cobrança pendente, plano ainda não ativado.
  await clientSubscriptionsRepository.getOrCreate(cliente.id);
  await clientSubscriptionsRepository.setAsaasSubscription(cliente.id, { customerId: 'cus_rep', subscriptionId: subId });
  await asaasPaymentsRepository.create({
    asaasPaymentId: payId,
    clientUserId: cliente.id,
    purpose: 'subscription',
    billingType: 'CREDIT_CARD',
    amountCents: 9990,
    planId: plano.id,
  });

  await comAsaasFalso(respostasPadrao(), async (chamadas) => {
    const r = await enviarWebhook({ event: 'PAYMENT_REPROVED_BY_RISK_ANALYSIS', payment: { id: payId } });
    assert.equal(r.status, 200);
    assert.ok(
      chamadas.some((c) => c.metodo === 'DELETE' && c.caminho.endsWith(subId)),
      'sem cancelar, o cliente seria cobrado mês que vem por um plano que nunca valeu'
    );
  });

  assert.equal((await asaasPaymentsRepository.findByAsaasId(payId)).status, 'falhou');
  assert.equal((await clientSubscriptionsRepository.getOrCreate(cliente.id)).asaas_subscription_id, null);
});

test('recusa de uma cobrança avulsa não mexe na assinatura de quem já está ativo no plano', async () => {
  const cliente = await createClient();
  const [plano] = await subscriptionPlansRepository.listActive();
  const subId = idUnico('sub_ativa');
  const payId = idUnico('pay_recusado_ativo');
  await clientSubscriptionsRepository.setPlan(cliente.id, plano.id);
  await clientSubscriptionsRepository.setAsaasSubscription(cliente.id, { customerId: 'cus_at', subscriptionId: subId });
  await asaasPaymentsRepository.create({
    asaasPaymentId: payId,
    clientUserId: cliente.id,
    purpose: 'subscription',
    billingType: 'CREDIT_CARD',
    amountCents: 9990,
    planId: plano.id,
  });

  await comAsaasFalso(respostasPadrao(), async (chamadas) => {
    await enviarWebhook({ event: 'PAYMENT_CREDIT_CARD_CAPTURE_REFUSED', payment: { id: payId } });
    assert.ok(!chamadas.some((c) => c.metodo === 'DELETE'), 'a assinatura que está paga e valendo não pode ser cancelada');
  });
  assert.equal((await clientSubscriptionsRepository.getOrCreate(cliente.id)).asaas_subscription_id, subId);
});
