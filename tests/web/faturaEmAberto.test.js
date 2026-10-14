// Cliente com a renovação recusada no cartão consegue pagar pelo painel.
//
// 14/10/2026: a primeira renovação que falhou no sistema (o primeiro cliente
// pagante, cartão recusado em 13/10) deixou o cliente "inadimplente", e a tela
// só dizia "atualize o cartão" - sem nenhum lugar para fazer isso. Agora a tela
// recebe a fatura vencida do Asaas, que aceita outro cartão ou PIX.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const pool = require('../../src/db/pool');
const config = require('../../src/config');
const { startServer, stopServer, createLoginableClient, createAgent } = require('../helpers/http');
const clientSubscriptionsRepository = require('../../src/repositories/clientSubscriptionsRepository');
const subscriptionPlansRepository = require('../../src/repositories/subscriptionPlansRepository');
const { comAsaasFalso, respostasPadrao } = require('../helpers/asaasFalso');

let baseUrl;

test.before(async () => {
  baseUrl = await startServer();
  config.asaas.apiKey = config.asaas.apiKey || '$aact_hmlg_teste';
});

test.after(async () => {
  await stopServer();
  await pool.end();
});

async function assinante(status) {
  const cliente = await createLoginableClient();
  const [plano] = await subscriptionPlansRepository.listActive();
  await clientSubscriptionsRepository.setPlan(cliente.id, plano.id);
  await clientSubscriptionsRepository.setAsaasSubscription(cliente.id, {
    customerId: 'cus_fatura',
    subscriptionId: `sub_fatura_${process.pid}_${Date.now()}`,
  });
  await clientSubscriptionsRepository.setStatus(cliente.id, status);
  const agent = createAgent(baseUrl);
  await agent.login(cliente.email, cliente.password);
  return agent;
}

const vencidas = () => ({
  body: {
    data: [
      { id: 'pay_velha', value: 229.9, dueDate: '2026-09-13', invoiceUrl: 'https://www.asaas.com/i/velha' },
      { id: 'pay_nova', value: 229.9, dueDate: '2026-10-13', invoiceUrl: 'https://www.asaas.com/i/nova' },
    ],
  },
});

test('inadimplente vê a mensalidade vencida mais recente, com o link para pagar', async () => {
  const agent = await assinante('inadimplente');
  await comAsaasFalso({ ...respostasPadrao(), 'GET /payments': vencidas }, async () => {
    const r = await agent.get('/api/client/billing/overview');
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(r.body.subscription.faturaEmAberto, {
      valorCents: 22990,
      vencimento: '2026-10-13',
      url: 'https://www.asaas.com/i/nova',
    });
  });
});

test('quem está em dia não recebe fatura nenhuma (nem consulta o Asaas)', async () => {
  const agent = await assinante('ativo');
  await comAsaasFalso({ ...respostasPadrao(), 'GET /payments': vencidas }, async (chamadas) => {
    const r = await agent.get('/api/client/billing/overview');
    assert.equal(r.body.subscription.faturaEmAberto, null);
    assert.ok(!chamadas.some((c) => c.metodo === 'GET' && c.caminho === '/payments'));
  });
});

test('Asaas fora do ar não derruba a tela de Plano e uso', async () => {
  const agent = await assinante('inadimplente');
  const rotas = { ...respostasPadrao(), 'GET /payments': () => ({ status: 500, body: { errors: [{ description: 'fora' }] } }) };
  await comAsaasFalso(rotas, async () => {
    const r = await agent.get('/api/client/billing/overview');
    assert.equal(r.status, 200);
    assert.equal(r.body.subscription.faturaEmAberto, null);
  });
});
