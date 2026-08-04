// Fluxos de cobrança da Stripe, testados contra a API DE VERDADE (modo teste).
//
// Mock aqui não provaria nada: os três bugs que estes testes travam eram todos
// da forma como a Stripe se comporta, não da nossa lógica. Um mock devolveria
// exatamente o que eu imaginasse que ela devolve, e os três teriam passado.
//
// Roda só quando STRIPE_SECRET_KEY de TESTE está no ambiente. Sem chave, os
// testes são pulados em vez de falhar: o `npm test` de qualquer pessoa
// continua verde sem precisar de credencial.
'use strict';

const test = require('node:test');
const assert = require('node:assert');

const chave = process.env.STRIPE_SECRET_KEY || '';
const temChaveDeTeste = chave.startsWith('sk_test_');
const opcoes = temChaveDeTeste
  ? {}
  : { skip: 'defina STRIPE_SECRET_KEY (sk_test_...) para rodar os testes de cobrança' };

// Só carrega o serviço quando há chave: ele lê a configuração no require.
const stripeService = temChaveDeTeste ? require('../../src/services/stripeService') : null;

async function clienteDeTeste(sufixo) {
  return stripeService.ensureCustomer(null, {
    email: `teste-${sufixo}-${Date.now()}@exemplo.com`,
    name: 'Cliente de teste',
    clientUserId: 999,
  });
}

test('o pacote avulso gera um checkout de pagamento único com o valor certo', opcoes, async () => {
  const customerId = await clienteDeTeste('pacote');
  const sessao = await stripeService.createCheckoutSessionForPackage({
    customerId,
    amountCents: 4990,
    minutes: 100,
    bucket: 'normal',
    successUrl: 'https://postflowclips.com/client/billing?pacote=sucesso',
    cancelUrl: 'https://postflowclips.com/client/billing?pacote=cancelado',
    metadata: { clientUserId: '999' },
  });

  assert.strictEqual(sessao.mode, 'payment');
  assert.strictEqual(sessao.amount_total, 4990);
  assert.ok(sessao.url, 'sem URL o cliente não tem pra onde ir pagar');
});

test('o cartão de excedente gera uma sessão de setup', opcoes, async () => {
  // Esta chamada falhava com "Missing required param: currency": a Stripe
  // recusa sessão de setup sem moeda quando o cliente ainda não tem uma. O
  // cliente clicava em "cadastrar cartão" e a tela quebrava.
  const customerId = await clienteDeTeste('cartao');
  const sessao = await stripeService.createSetupSessionForOverageCard({
    customerId,
    successUrl: 'https://postflowclips.com/client/billing?cartao=sucesso',
    cancelUrl: 'https://postflowclips.com/client/billing?cartao=cancelado',
    metadata: { clientUserId: '999' },
  });

  assert.strictEqual(sessao.mode, 'setup');
  assert.ok(sessao.url);
});

test('a fatura de excedente cobra o valor dos itens, e não zero', opcoes, async () => {
  // Este é o teste mais importante do arquivo. A fatura nascia VAZIA porque a
  // API atual não puxa os invoice items pendentes por padrão: saía com total
  // R$ 0,00, a Stripe marcava como paga, o job marcava os lançamentos como
  // pagos, e o excedente nunca era cobrado. Tudo "funcionava" e não entrava
  // dinheiro.
  const stripe = require('stripe')(chave);
  const customerId = await clienteDeTeste('excedente');
  const pm = await stripe.paymentMethods.create({ type: 'card', card: { token: 'tok_visa' } });
  await stripe.paymentMethods.attach(pm.id, { customer: customerId });
  await stripe.customers.update(customerId, { invoice_settings: { default_payment_method: pm.id } });

  const fatura = await stripeService.createInvoiceItemsAndPay({
    customerId,
    paymentMethodId: pm.id,
    items: [
      { description: 'Excedente (app do cliente) - 12 min', amountCents: 180 },
      { description: 'Excedente (VPS/proxy) - 4 min', amountCents: 100 },
    ],
  });

  assert.strictEqual(fatura.status, 'paid');
  assert.strictEqual(fatura.total, 280, 'a fatura tem que somar os itens, não sair zerada');
});

test('cobrar o excedente não estoura quando a Stripe já cobrou na finalização', opcoes, async () => {
  // Finalizar uma fatura com charge_automatically já dispara o pagamento.
  // Chamar pay() em seguida explodia com "Invoice is already paid", e como o
  // overageBillingJob trata exceção como falha de cobrança, os lançamentos
  // ficavam pendentes e o cliente era cobrado DE NOVO na hora seguinte.
  const stripe = require('stripe')(chave);
  const customerId = await clienteDeTeste('duplicado');
  const pm = await stripe.paymentMethods.create({ type: 'card', card: { token: 'tok_visa' } });
  await stripe.paymentMethods.attach(pm.id, { customer: customerId });
  await stripe.customers.update(customerId, { invoice_settings: { default_payment_method: pm.id } });

  // Não deve lançar. Se lançar, é a regressão da cobrança dupla.
  const fatura = await stripeService.createInvoiceItemsAndPay({
    customerId,
    paymentMethodId: pm.id,
    items: [{ description: 'Excedente - 5 min', amountCents: 125 }],
  });
  assert.strictEqual(fatura.total, 125);
});
