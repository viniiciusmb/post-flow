// O checkout transparente pela porta da frente: HTTP de verdade, com sessão,
// CSRF e os controllers reais.
//
// O que estes testes travam:
//   - o PREÇO nunca vem da tela. Um POST montado à mão mandando o valor que
//     quiser não pode mudar quanto é cobrado;
//   - assinar deixou de mandar o cliente para o domínio do Asaas e passa a
//     abrir a NOSSA tela de checkout;
//   - o contexto entrega o que a tela precisa (dois degraus de preço, cartão
//     salvo, limites efetivos) sem vazar o token do cartão;
//   - sem sessão, nada;
//   - sem token anti-CSRF, nada.
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

// Fora do comAsaasFalso, o serviço precisa se declarar configurado para que os
// controllers escolham o caminho do Asaas.
function comAsaasLigado(fn) {
  const anterior = { ...config.asaas };
  config.asaas.apiKey = '$aact_prod_teste';
  config.asaas.environment = 'production';
  return Promise.resolve()
    .then(fn)
    .finally(() => Object.assign(config.asaas, anterior));
}

test('a página do checkout exige sessão', async () => {
  const anonimo = createAgent(baseUrl);
  const r = await anonimo.get('/client/checkout');
  assert.ok(r.status === 302 || r.status === 401, `esperava redirecionar pro login, veio ${r.status}`);
});

test('a API do checkout exige sessão', async () => {
  const anonimo = createAgent(baseUrl);
  const r = await anonimo.get('/api/client/checkout/contexto');
  assert.equal(r.status, 401);
});

test('pagar sem o token anti-CSRF é recusado', async () => {
  const { agent } = await agenteLogado();
  const r = await agent.postSemCsrf('/api/client/checkout/pagar', { tipo: 'creditos', minutos: 25 });
  assert.ok(r.status === 403 || r.status === 401, `esperava recusa por CSRF, veio ${r.status}`);
});

test('o contexto traz os dois degraus de preço e NUNCA o token do cartão', async () => {
  const { cliente, agent } = await agenteLogado();
  const plano = await subscriptionPlansRepository.findByKey('max');
  await clientSubscriptionsRepository.setPlan(cliente.id, plano.id);
  await clientSubscriptionsRepository.setAsaasCard(cliente.id, {
    customerId: 'cus_x',
    token: 'tok_supersecreto',
    brand: 'VISA',
    last4: '4242',
    exp: '05/2030',
  });
  await clientSubscriptionsRepository.setExtraSlots(cliente.id, { slots: 2 });

  const r = await agent.get('/api/client/checkout/contexto');
  assert.equal(r.status, 200);

  const starter = r.body.plans.find((p) => p.key === 'starter');
  assert.ok(starter.firstMonthPriceCents < starter.priceCents, 'a tela precisa dos dois preços');

  assert.deepEqual(r.body.card, { brand: 'VISA', last4: '4242', exp: '05/2030' });
  assert.ok(
    !JSON.stringify(r.body).includes('tok_supersecreto'),
    'o token do cartão não pode sair do servidor: ele é o que autoriza cobrar'
  );

  // Limite efetivo = plano + conexões compradas. É o número que a tela mostra
  // e o mesmo que o servidor aplica.
  assert.equal(r.body.subscription.limites.canais, plano.max_youtube_channels + 2);
  assert.equal(r.body.subscription.limites.contas, plano.max_tiktok_accounts + 2);
  assert.equal(r.body.subscription.extraSlots, 2);

  // O minuto avulso segue a taxa do plano, não uma constante.
  assert.equal(r.body.package.centsPerMinute, plano.overage_cents_normal);
  assert.ok(r.body.empresa.cnpj, 'quem vai digitar um cartão procura saber de quem é a empresa');
});

test('assinar manda para a NOSSA tela de checkout, não para o domínio do Asaas', async () => {
  await comAsaasLigado(async () => {
    const { agent } = await agenteLogado();
    const r = await agent.post('/api/client/billing/subscribe', { planKey: 'pro' });
    assert.equal(r.status, 200);
    assert.equal(r.body.checkoutUrl, '/client/checkout?plano=pro');
    assert.ok(!r.body.checkoutUrl.includes('asaas'), 'ninguém mais sai do site para pagar');
  });
});

test('comprar crédito e cadastrar cartão também abrem a tela de dentro', async () => {
  await comAsaasLigado(async () => {
    const { agent } = await agenteLogado();

    const pacote = await agent.post('/api/client/billing/buy-package', { minutes: 100 });
    assert.equal(pacote.body.checkoutUrl, '/client/checkout?creditos=100');

    const cartao = await agent.post('/api/client/billing/overage-card/setup');
    assert.equal(cartao.body.checkoutUrl, '/client/checkout?cartao=1');
  });
});

test('o valor NUNCA vem do corpo da requisição', async () => {
  await comAsaasFalso(respostasPadrao(), async (chamadas) => {
    const { cliente, agent } = await agenteLogado();
    const plano = await subscriptionPlansRepository.findByKey('pro');
    await clientSubscriptionsRepository.setPlan(cliente.id, plano.id);
    await clientSubscriptionsRepository.setAsaasCard(cliente.id, {
      customerId: 'cus_do_teste',
      token: 'tok_falso',
      brand: 'VISA',
      last4: '4242',
      exp: '05/2030',
    });
    chamadas.length = 0;

    // Um POST montado à mão tentando comprar 100 minutos por 1 centavo, e de
    // quebra mandando um preço unitário próprio.
    const r = await agent.post('/api/client/checkout/pagar', {
      tipo: 'creditos',
      metodo: 'cartao',
      minutos: 100,
      priceCents: 1,
      amountCents: 1,
      centsPerMinute: 0,
    });
    assert.equal(r.status, 200);

    const cobranca = chamadas.find((c) => c.metodo === 'POST' && c.caminho === '/payments');
    const esperado = (100 * plano.overage_cents_normal) / 100;
    assert.equal(cobranca.corpo.value, esperado, 'o preço é recalculado no servidor, a partir do plano');

    const compras = await creditPurchasesRepository.listByClientId(cliente.id);
    assert.equal(compras[0].amount_cents, 100 * plano.overage_cents_normal);
  });
});

test('minutos absurdos são encaixados no piso/teto em vez de virarem cobrança absurda', async () => {
  await comAsaasFalso(respostasPadrao(), async (chamadas) => {
    const { cliente, agent } = await agenteLogado();
    const plano = await subscriptionPlansRepository.findByKey('starter');
    await clientSubscriptionsRepository.setPlan(cliente.id, plano.id);
    await clientSubscriptionsRepository.setAsaasCard(cliente.id, {
      customerId: 'cus_do_teste',
      token: 'tok_falso',
      brand: 'VISA',
      last4: '4242',
      exp: '05/2030',
    });
    chamadas.length = 0;

    await agent.post('/api/client/checkout/pagar', { tipo: 'creditos', metodo: 'cartao', minutos: 999999 });
    const cobranca = chamadas.find((c) => c.metodo === 'POST' && c.caminho === '/payments');
    const contexto = await agent.get('/api/client/checkout/contexto');
    assert.equal(cobranca.corpo.value, (contexto.body.package.maxMinutes * plano.overage_cents_normal) / 100);
  });
});

test('conexão extra em quantidade absurda é recusada antes de cobrar', async () => {
  await comAsaasFalso(respostasPadrao(), async (chamadas) => {
    const { cliente, agent } = await agenteLogado();
    const plano = await subscriptionPlansRepository.findByKey('max');
    await clientSubscriptionsRepository.setPlan(cliente.id, plano.id);
    chamadas.length = 0;

    const r = await agent.post('/api/client/checkout/pagar', { tipo: 'extras', metodo: 'cartao', quantidade: 5000 });
    assert.equal(r.status, 400);
    assert.equal(chamadas.length, 0, 'um erro de digitação não pode virar uma cobrança de milhares de reais');
  });
});

test('erro de preenchimento vira 400 com o motivo, não 500 genérico', async () => {
  await comAsaasFalso(respostasPadrao(), async () => {
    const { agent } = await agenteLogado();
    const r = await agent.post('/api/client/checkout/cartao', {
      titular: { nome: 'Fulano de Tal', documento: '111.111.111-11', cep: '89223005', numeroEndereco: '1' },
      cartao: { number: '5162306219378829', expiryMonth: '05', expiryYear: '2030', ccv: '318', holderName: 'FULANO' },
    });
    assert.equal(r.status, 400);
    assert.match(r.body.error, /CPF ou CNPJ inválido/);
  });
});

test('pagar no cartão salva o cartão mas NÃO autoriza cobrança automática', async () => {
  await comAsaasFalso(respostasPadrao(), async () => {
    const { cliente, agent } = await agenteLogado();
    const plano = await subscriptionPlansRepository.findByKey('starter');
    await clientSubscriptionsRepository.setPlan(cliente.id, plano.id);

    const r = await agent.post('/api/client/checkout/pagar', {
      tipo: 'plano',
      metodo: 'cartao',
      planKey: 'starter',
      titular: {
        nome: 'Marcelo Henrique Almeida',
        documento: '52998224725',
        cep: '89223005',
        numeroEndereco: '277',
      },
      cartao: {
        number: '5162306219378829',
        expiryMonth: '05',
        expiryYear: '2030',
        ccv: '318',
        holderName: 'MARCELO H ALMEIDA',
      },
    });
    assert.equal(r.status, 200, r.text);

    const sub = await clientSubscriptionsRepository.getOrCreate(cliente.id);
    assert.ok(sub.asaas_card_token, 'o cartão que pagou fica salvo pra não precisar redigitar');
    assert.equal(
      sub.overage_card_enabled,
      false,
      'pagar uma compra não pode virar autorização de cobranças futuras'
    );
  });
});

test('a cobrança automática só liga com um pedido explícito, e exige cartão salvo', async () => {
  await comAsaasFalso(respostasPadrao(), async () => {
    const { cliente, agent } = await agenteLogado();

    // Sem cartão nenhum: ligar deixaria a assinatura marcada como "cobra
    // automático" sem nada pra cobrar - falharia longe da tela, no meio de um
    // processamento.
    const semCartao = await agent.post('/api/client/billing/overage-card/enable');
    assert.equal(semCartao.status, 400);
    assert.equal((await clientSubscriptionsRepository.getOrCreate(cliente.id)).overage_card_enabled, false);

    await clientSubscriptionsRepository.setAsaasCard(cliente.id, {
      customerId: 'cus_do_teste',
      token: 'tok_falso',
      brand: 'VISA',
      last4: '4242',
      exp: '05/2030',
    });
    // Salvar por si só não liga nada.
    assert.equal((await clientSubscriptionsRepository.getOrCreate(cliente.id)).overage_card_enabled, false);

    const comCartao = await agent.post('/api/client/billing/overage-card/enable');
    assert.equal(comCartao.status, 200);
    assert.equal(comCartao.body.overageCardEnabled, true);

    // E dá para desligar de volta sem perder o cartão.
    const desligado = await agent.post('/api/client/billing/overage-card/disable');
    assert.equal(desligado.body.overageCardEnabled, false);
    const sub = await clientSubscriptionsRepository.getOrCreate(cliente.id);
    assert.ok(sub.asaas_card_token, 'desligar a cobrança não pode apagar o cartão salvo');
  });
});

test('"não salvar" apaga o cartão e desliga a cobrança junto', async () => {
  await comAsaasFalso(respostasPadrao(), async () => {
    const { cliente, agent } = await agenteLogado();
    await clientSubscriptionsRepository.setAsaasCard(cliente.id, {
      customerId: 'cus_do_teste',
      token: 'tok_falso',
      brand: 'VISA',
      last4: '4242',
      exp: '05/2030',
      enableOverage: true,
    });

    const r = await agent.delete('/api/client/checkout/cartao');
    assert.equal(r.status, 200);

    const sub = await clientSubscriptionsRepository.getOrCreate(cliente.id);
    assert.equal(sub.asaas_card_token, null);
    // Deixar "cobra automático" ligado sem cartão é o estado que só falha longe
    // da tela: as duas coisas têm que cair juntas.
    assert.equal(sub.overage_card_enabled, false);
  });
});
