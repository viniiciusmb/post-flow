// Crédito avulso só é vendido para quem tem plano ATIVO (decisão de 29/09/2026).
//
// Sem plano o cliente não conecta conta do TikTok nem canal (limite 0), então
// o minuto comprado não tinha como virar corte publicado. Quatro clientes
// pagaram por crédito que não conseguiam usar, e um pediu devolução pelo MED.
//
// O que estes testes travam: o SERVIDOR recusa (a tela esconder não basta,
// um POST montado à mão passaria), nada chega ao Asaas nem vira compra
// pendente, e a tela recebe o sinal para esconder a compra.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const pool = require('../../src/db/pool');
const config = require('../../src/config');
const { startServer, stopServer, createLoginableClient, createAgent } = require('../helpers/http');
const clientSubscriptionsRepository = require('../../src/repositories/clientSubscriptionsRepository');
const subscriptionPlansRepository = require('../../src/repositories/subscriptionPlansRepository');
const creditPurchasesRepository = require('../../src/repositories/creditPurchasesRepository');
const { comAsaasFalso, respostasPadrao } = require('../helpers/asaasFalso');

let baseUrl;

test.before(async () => {
  baseUrl = await startServer();
});

test.after(async () => {
  await stopServer();
  await pool.end();
});

async function agenteLogado() {
  const cliente = await createLoginableClient();
  const agent = createAgent(baseUrl);
  await agent.login(cliente.email, cliente.password);
  return { cliente, agent };
}

async function comPlano(clienteId, key = 'starter') {
  const plano = await subscriptionPlansRepository.findByKey(key);
  await clientSubscriptionsRepository.setPlan(clienteId, plano.id);
  return plano;
}

test('sem plano: pagar crédito no PIX e no cartão é recusado antes de chegar ao Asaas', async () => {
  await comAsaasFalso(respostasPadrao(), async (chamadas) => {
    const { cliente, agent } = await agenteLogado();
    await clientSubscriptionsRepository.setAsaasCard(cliente.id, {
      customerId: 'cus_do_teste',
      token: 'tok_falso',
      brand: 'VISA',
      last4: '4242',
      exp: '05/2030',
    });
    chamadas.length = 0;

    const cartao = await agent.post('/api/client/checkout/pagar', { tipo: 'creditos', metodo: 'cartao', minutos: 25 });
    assert.equal(cartao.status, 400);
    assert.match(cartao.body.error, /plano/i);

    const pix = await agent.post('/api/client/checkout/pagar', {
      tipo: 'creditos',
      metodo: 'pix',
      minutos: 25,
      titular: { nome: 'Fulano de Tal', documento: '52998224725' },
    });
    assert.equal(pix.status, 400);

    assert.equal(chamadas.length, 0, 'nenhuma chamada ao Asaas');
    assert.equal((await creditPurchasesRepository.listByClientId(cliente.id)).length, 0, 'nenhuma compra pendente');
  });
});

test('sem plano: o atalho antigo de comprar pacote também recusa', async () => {
  const anterior = { ...config.asaas };
  config.asaas.apiKey = '$aact_prod_teste';
  config.asaas.environment = 'production';
  try {
    const { agent } = await agenteLogado();
    const r = await agent.post('/api/client/billing/buy-package', { minutes: 25 });
    assert.equal(r.status, 400);
    assert.equal(r.body.checkoutUrl, undefined);
  } finally {
    Object.assign(config.asaas, anterior);
  }
});

test('plano inadimplente ou cancelado também não compra', async () => {
  await comAsaasFalso(respostasPadrao(), async (chamadas) => {
    for (const status of ['inadimplente', 'cancelado']) {
      const { cliente, agent } = await agenteLogado();
      await comPlano(cliente.id);
      await clientSubscriptionsRepository.setStatus(cliente.id, status);
      chamadas.length = 0;

      const r = await agent.post('/api/client/checkout/pagar', {
        tipo: 'creditos',
        metodo: 'pix',
        minutos: 25,
        titular: { nome: 'Fulano de Tal', documento: '52998224725' },
      });
      assert.equal(r.status, 400, status);
      assert.equal(chamadas.length, 0, status);
    }
  });
});

test('com plano ativo a compra passa, e a tela recebe o sinal certo nos dois casos', async () => {
  await comAsaasFalso(respostasPadrao(), async () => {
    const { cliente, agent } = await agenteLogado();

    const semPlanoCheckout = await agent.get('/api/client/checkout/contexto');
    assert.equal(semPlanoCheckout.body.package.podeComprar, false);
    const semPlanoBilling = await agent.get('/api/client/billing/overview');
    assert.equal(semPlanoBilling.body.package.podeComprar, false);

    await comPlano(cliente.id);

    const comPlanoCheckout = await agent.get('/api/client/checkout/contexto');
    assert.equal(comPlanoCheckout.body.package.podeComprar, true);
    const comPlanoBilling = await agent.get('/api/client/billing/overview');
    assert.equal(comPlanoBilling.body.package.podeComprar, true);

    const r = await agent.post('/api/client/checkout/pagar', {
      tipo: 'creditos',
      metodo: 'pix',
      minutos: 25,
      titular: { nome: 'Fulano de Tal', documento: '52998224725' },
    });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal((await creditPurchasesRepository.listByClientId(cliente.id)).length, 1);
  });
});
