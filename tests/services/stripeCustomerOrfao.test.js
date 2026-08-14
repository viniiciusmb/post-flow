// Customer da Stripe que existe no NOSSO banco mas não existe mais do lado
// da Stripe.
//
// Bug real, em produção (2026-08-14): as chaves de teste foram trocadas pelas
// de produção. Modo de teste e modo ao vivo são dois mundos separados na
// Stripe, então o `stripe_customer_id` que já estava salvo virou um ponteiro
// pro nada ("No such customer ... a similar object exists in test mode"). Os 2
// clientes reais que já tinham customer salvo não conseguiam mais assinar,
// comprar crédito avulso NEM cadastrar cartão: todo botão de pagamento morria
// com "Algo deu errado. Tente novamente." — que não diz nada e não dá saída.
//
// O que estes testes travam:
//   1. o fluxo se cura sozinho (recria o customer) em vez de exigir conserto
//      manual no banco a cada troca de chave;
//   2. assinatura e cartão padrão, que pertenciam ao customer morto, são
//      zerados junto — deixá-los preenchidos faria a cobrança automática de
//      excedente falhar depois, longe da tela, sem ninguém ver;
//   3. erro da Stripe não vira mais 500 genérico.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const pool = require('../../src/db/pool');
const clientSubscriptionsRepository = require('../../src/repositories/clientSubscriptionsRepository');
const stripeService = require('../../src/services/stripeService');
const { startServer, stopServer, createLoginableClient, createAgent } = require('../helpers/http');

test('zerar os vínculos da Stripe limpa TODOS os ids do customer morto', async () => {
  const cliente = await createLoginableClient();
  await clientSubscriptionsRepository.getOrCreate(cliente.id);
  await pool.query(
    `UPDATE client_subscriptions
     SET stripe_customer_id = 'cus_morto', stripe_subscription_id = 'sub_morta',
         stripe_default_payment_method_id = 'pm_morto', overage_card_enabled = true,
         status = 'ativo'
     WHERE client_user_id = $1`,
    [cliente.id]
  );

  await clientSubscriptionsRepository.clearStripeLinks(cliente.id);

  const { rows } = await pool.query(
    `SELECT * FROM client_subscriptions WHERE client_user_id = $1`,
    [cliente.id]
  );
  const sub = rows[0];
  assert.strictEqual(sub.stripe_customer_id, null);
  // Estes dois são o ponto: pertenciam ao customer que morreu. Se sobrassem, a
  // cobrança de excedente tentaria usá-los depois e falharia sozinha.
  assert.strictEqual(sub.stripe_subscription_id, null, 'a assinatura do customer morto tem que sair junto');
  assert.strictEqual(sub.stripe_default_payment_method_id, null, 'o cartão do customer morto tem que sair junto');
  assert.strictEqual(sub.overage_card_enabled, false, 'sem cartão válido, cobrança automática não pode seguir ligada');
  // O plano e o status são decisão do admin, não da Stripe: o cliente continua
  // com o que tem enquanto recadastra o pagamento.
  assert.strictEqual(sub.status, 'ativo', 'limpar o pagamento não pode derrubar o plano do cliente');
});

test('cadastrar cartão com customer órfão recria em vez de dar erro na cara do cliente', async () => {
  const url = await startServer();
  const cliente = await createLoginableClient();
  await clientSubscriptionsRepository.getOrCreate(cliente.id);
  await pool.query(
    `UPDATE client_subscriptions
     SET stripe_customer_id = 'cus_que_nao_existe_mais', stripe_subscription_id = 'sub_morta',
         stripe_default_payment_method_id = 'pm_morto', overage_card_enabled = true
     WHERE client_user_id = $1`,
    [cliente.id]
  );

  // Stripe de mentira SÓ aqui: o que este teste prova é a nossa reação ao
  // customer sumido, não o comportamento da Stripe (esse está em
  // stripeFlows.test.js, contra a API de verdade em modo teste).
  const original = {
    isConfigured: stripeService.isConfigured,
    customerExists: stripeService.customerExists,
    ensureCustomer: stripeService.ensureCustomer,
    createSetupSessionForOverageCard: stripeService.createSetupSessionForOverageCard,
  };
  let pediuSessaoPara = null;
  stripeService.isConfigured = () => true;
  stripeService.customerExists = async (id) => id !== 'cus_que_nao_existe_mais';
  stripeService.ensureCustomer = async () => 'cus_novinho_em_folha';
  stripeService.createSetupSessionForOverageCard = async ({ customerId }) => {
    pediuSessaoPara = customerId;
    return { url: 'https://checkout.stripe.com/sessao-de-mentira' };
  };

  try {
    const agente = createAgent(url);
    await agente.login(cliente.email, cliente.password);
    const r = await agente.post('/api/client/billing/overage-card/setup');

    assert.strictEqual(r.status, 200, `esperava 200, veio ${r.status}: ${r.text}`);
    assert.ok(r.body.checkoutUrl, 'sem URL o cliente não tem pra onde ir cadastrar o cartão');
    assert.strictEqual(
      pediuSessaoPara,
      'cus_novinho_em_folha',
      'a sessão tem que ser criada pro customer NOVO, não pro que já não existe'
    );

    const { rows } = await pool.query(
      `SELECT * FROM client_subscriptions WHERE client_user_id = $1`,
      [cliente.id]
    );
    assert.strictEqual(rows[0].stripe_customer_id, 'cus_novinho_em_folha', 'o id novo tem que ficar salvo');
    assert.strictEqual(rows[0].stripe_subscription_id, null, 'o resto do customer morto tem que ter saído junto');
    assert.strictEqual(rows[0].stripe_default_payment_method_id, null);
  } finally {
    Object.assign(stripeService, original);
    await stopServer();
  }
});

test('customer que AINDA existe é reaproveitado, sem criar outro à toa', async () => {
  const url = await startServer();
  const cliente = await createLoginableClient();
  await clientSubscriptionsRepository.getOrCreate(cliente.id);
  await pool.query(
    `UPDATE client_subscriptions SET stripe_customer_id = 'cus_bom' WHERE client_user_id = $1`,
    [cliente.id]
  );

  const original = {
    isConfigured: stripeService.isConfigured,
    customerExists: stripeService.customerExists,
    ensureCustomer: stripeService.ensureCustomer,
    createSetupSessionForOverageCard: stripeService.createSetupSessionForOverageCard,
  };
  let criouCustomer = false;
  let pediuSessaoPara = null;
  stripeService.isConfigured = () => true;
  stripeService.customerExists = async () => true;
  stripeService.ensureCustomer = async () => {
    criouCustomer = true;
    return 'cus_indevido';
  };
  stripeService.createSetupSessionForOverageCard = async ({ customerId }) => {
    pediuSessaoPara = customerId;
    return { url: 'https://checkout.stripe.com/sessao-de-mentira' };
  };

  try {
    const agente = createAgent(url);
    await agente.login(cliente.email, cliente.password);
    const r = await agente.post('/api/client/billing/overage-card/setup');

    assert.strictEqual(r.status, 200);
    assert.strictEqual(criouCustomer, false, 'não pode criar customer novo quando o antigo está vivo');
    assert.strictEqual(pediuSessaoPara, 'cus_bom');
  } finally {
    Object.assign(stripeService, original);
    await stopServer();
  }
});

test('falha da Stripe vira mensagem de pagamento, não "algo deu errado"', async () => {
  const url = await startServer();
  const cliente = await createLoginableClient();
  await clientSubscriptionsRepository.getOrCreate(cliente.id);

  const original = {
    isConfigured: stripeService.isConfigured,
    customerExists: stripeService.customerExists,
    ensureCustomer: stripeService.ensureCustomer,
  };
  stripeService.isConfigured = () => true;
  stripeService.customerExists = async () => true;
  stripeService.ensureCustomer = async () => {
    // Mesmo formato do erro que o SDK da Stripe lança: `type`, e `statusCode`
    // em vez de `status` - era exatamente por isso que caía no 500 genérico.
    const err = new Error('No such customer: cus_x; a similar object exists in test mode');
    err.type = 'StripeInvalidRequestError';
    err.code = 'resource_missing';
    err.statusCode = 400;
    throw err;
  };

  try {
    const agente = createAgent(url);
    await agente.login(cliente.email, cliente.password);
    const r = await agente.post('/api/client/billing/overage-card/setup');

    assert.strictEqual(r.status, 502, `esperava 502 (falha de sistema externo), veio ${r.status}`);
    assert.match(r.body.error, /pagamento/i, 'a mensagem tem que dizer que a falha foi no pagamento');
    assert.match(r.body.error, /[Nn]ada foi cobrado/, 'o cliente precisa saber que não foi cobrado');
    assert.doesNotMatch(
      r.body.error,
      /cus_x|test mode/,
      'id interno e texto em inglês da Stripe não podem vazar pra tela do cliente'
    );
  } finally {
    Object.assign(stripeService, original);
    await stopServer();
  }
});
