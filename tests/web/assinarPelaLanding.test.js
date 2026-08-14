// Clicar num plano na landing tem que terminar no checkout.
//
// Antes o botão "Começar" da landing levava pra /register e, depois de criar a
// conta, pro painel — a pessoa que já tinha escolhido e decidido pagar caía
// numa tela que não pede pagamento nenhum, e precisava caçar a tela de planos
// pra escolher tudo de novo.
//
// O plano viaja na SESSÃO (não na URL do POST) porque é o único carregador que
// sobrevive ao ida-e-volta do login com Google. Estes testes travam as três
// coisas que fazem o fluxo funcionar: capturar, usar uma vez só, e nunca
// custar o acesso quando o checkout não puder abrir.
'use strict';

const test = require('node:test');
const { after } = test;
const assert = require('node:assert/strict');
const pool = require('../../src/db/pool');
const stripeService = require('../../src/services/stripeService');
const subscriptionPlansRepository = require('../../src/repositories/subscriptionPlansRepository');
const { startServer, stopServer, createAgent, createLoginableClient } = require('../helpers/http');

const CHECKOUT_FALSO = 'https://checkout.stripe.com/c/pay/sessao-de-mentira';

// O servidor sobe uma vez pro arquivo inteiro e cai num hook. Subir e derrubar
// dentro de cada teste parecia mais arrumado, mas quando uma asserção falha o
// stopServer() do fim nunca roda: o servidor fica escutando, o Node não
// consegue encerrar e a SUÍTE INTEIRA trava em vez de reportar a falha - que é
// exatamente quando você mais precisa dela reportando.
after(() => stopServer());

// Stripe de mentira: o que se testa aqui é o CAMINHO (quem vai pra onde),
// não o comportamento da Stripe.
function comStripe(fn, { criarSessao = async () => ({ url: CHECKOUT_FALSO }) } = {}) {
  const original = {
    isConfigured: stripeService.isConfigured,
    customerExists: stripeService.customerExists,
    ensureCustomer: stripeService.ensureCustomer,
    createCheckoutSessionForSubscription: stripeService.createCheckoutSessionForSubscription,
  };
  const chamadas = [];
  stripeService.isConfigured = () => true;
  stripeService.customerExists = async () => true;
  stripeService.ensureCustomer = async () => 'cus_teste';
  stripeService.createCheckoutSessionForSubscription = async (args) => {
    chamadas.push(args);
    return criarSessao(args);
  };
  return fn(chamadas).finally(() => Object.assign(stripeService, original));
}

// Os planos precisam de stripe_price_id pra virar checkout - em banco de teste
// eles nascem sem (o preço é criado na Stripe por script separado).
async function darPrecoAosPlanos() {
  await pool.query(`UPDATE subscription_plans SET stripe_price_id = 'price_' || key WHERE stripe_price_id IS NULL`);
}

let contador = 0;
function novoEmail() {
  contador += 1;
  return `landing${contador}_${Date.now()}@teste.local`;
}

async function cadastrar(agente, email) {
  return agente.post('/register', {
    email,
    password: 'senha-de-teste-123',
    businessName: 'Teste',
    acceptedTerms: '1',
  });
}

test('escolher um plano na landing e criar a conta termina no checkout daquele plano', async () => {
  const url = await startServer();
  await darPrecoAosPlanos();

  await comStripe(async (chamadas) => {
    const agente = createAgent(url);
    // É isto que o botão da landing faz.
    await agente.get('/register?plano=pro');
    const r = await cadastrar(agente, novoEmail());

    assert.equal(r.status, 302);
    assert.equal(
      r.headers.get('location'),
      CHECKOUT_FALSO,
      'depois de criar a conta a pessoa tem que cair no checkout, não no painel'
    );

    const plano = await subscriptionPlansRepository.findByKey('pro');
    assert.equal(chamadas.length, 1);
    assert.equal(chamadas[0].priceId, plano.stripe_price_id, 'tem que ser o preço do plano ESCOLHIDO');
    assert.equal(chamadas[0].metadata.planKey, 'pro');
  });

});

test('cadastro sem escolher plano continua indo pro painel', async () => {
  const url = await startServer();
  await darPrecoAosPlanos();

  await comStripe(async (chamadas) => {
    const agente = createAgent(url);
    await agente.get('/register');
    const r = await cadastrar(agente, novoEmail());

    assert.equal(r.headers.get('location'), '/client');
    assert.equal(chamadas.length, 0, 'sem plano escolhido não pode abrir checkout nenhum');
  });

});

test('plano inventado na URL é ignorado em vez de virar busca', async () => {
  // O valor vai direto numa busca de plano. Sem lista fechada, a URL mandaria
  // no que o sistema procura.
  const url = await startServer();

  await comStripe(async (chamadas) => {
    const agente = createAgent(url);
    await agente.get('/register?plano=' + encodeURIComponent("'; DROP TABLE users; --"));
    const r = await cadastrar(agente, novoEmail());

    assert.equal(r.headers.get('location'), '/client');
    assert.equal(chamadas.length, 0);
  });

});

test('quem JÁ tem conta e clica num plano também cai no checkout ao entrar', async () => {
  // A tela de entrar é a SPA: ela decide pra onde ir depois do login. Sem o
  // servidor mandar o destino, este caminho perdia a escolha e caía no painel
  // — o mesmo beco sem saída que o cadastro tinha.
  const url = await startServer();
  await darPrecoAosPlanos();
  const cliente = await createLoginableClient();

  await comStripe(async (chamadas) => {
    const agente = createAgent(url);
    await agente.get('/register?plano=max');
    const r = await agente.post('/api/auth/login', { email: cliente.email, password: cliente.password });

    assert.equal(r.status, 200, r.text);
    assert.equal(r.body.redirectTo, CHECKOUT_FALSO, 'o servidor tem que mandar a tela pro checkout');

    const plano = await subscriptionPlansRepository.findByKey('max');
    assert.equal(chamadas[0].priceId, plano.stripe_price_id, 'tem que ser o preço do plano escolhido');
  });

});

test('login normal, sem plano escolhido, manda a tela pro painel', async () => {
  const url = await startServer();
  const cliente = await createLoginableClient();

  await comStripe(async (chamadas) => {
    const agente = createAgent(url);
    const r = await agente.post('/api/auth/login', { email: cliente.email, password: cliente.password });

    assert.equal(r.body.redirectTo, '/client');
    assert.equal(chamadas.length, 0);
  });

});

test('o plano é usado UMA vez: o login seguinte não reabre o checkout', async () => {
  // Sem consumir, todo login daquela sessão jogaria a pessoa num checkout que
  // ela não pediu de novo.
  const url = await startServer();
  await darPrecoAosPlanos();

  await comStripe(async (chamadas) => {
    const agente = createAgent(url);
    await agente.get('/register?plano=starter');
    const email = novoEmail();
    await cadastrar(agente, email);
    assert.equal(chamadas.length, 1);

    // Mesma sessão, entrando de novo.
    const r = await agente.post('/login', { email, password: 'senha-de-teste-123' });
    assert.equal(r.headers.get('location'), '/client', 'o checkout não pode voltar sozinho');
    assert.equal(chamadas.length, 1, 'nenhuma sessão de checkout nova');
  });

});

test('checkout que não abre não impede o acesso: cai na tela de planos', async () => {
  // A conta já existe e a pessoa já está logada. Perder o checkout é ruim;
  // devolver uma página de erro depois de ela ter se cadastrado seria pior.
  const url = await startServer();
  await darPrecoAosPlanos();

  await comStripe(
    async () => {
      const agente = createAgent(url);
      await agente.get('/register?plano=pro');
      const r = await cadastrar(agente, novoEmail());
      assert.equal(r.headers.get('location'), '/client/billing');
    },
    {
      criarSessao: async () => {
        const err = new Error('Stripe fora do ar');
        err.type = 'StripeAPIError';
        throw err;
      },
    }
  );

});
