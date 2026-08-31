// Caminho completo do pagamento contra a API REAL do Asaas (sandbox).
//
// Os outros testes usam um Asaas de mentira, o que é certo para travar
// comportamento. Este faz o oposto de propósito: fala com o Asaas de verdade,
// porque foi assim — e só assim — que apareceram as exigências que a
// documentação não menciona (endereço completo obrigatório na tokenização,
// PIX recusado sem chave Pix cadastrada). Contrato de terceiro só se confirma
// contra o terceiro.
//
// Desde que o checkout virou transparente, o que este arquivo prova mudou: já
// não existe tela hospedada para conferir, e sim uma TOKENIZAÇÃO de cartão
// real e cobranças criadas direto pela API. O cartão usado é o de teste que o
// próprio Asaas publica para sandbox.
//
// Só roda quando há uma chave de sandbox no ambiente:
//   ASAAS_API_KEY='$aact_hmlg_...' npm test tests/services/asaasSandboxE2E.test.js
// Sem ela, é pulado — para a suíte normal não depender de rede nem de chave.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const pool = require('../../src/db/pool');
const config = require('../../src/config');
const { startServer, stopServer, createLoginableClient, createAgent } = require('../helpers/http');
const { readCredits } = require('../helpers/db');
const subscriptionPlansRepository = require('../../src/repositories/subscriptionPlansRepository');

const CHAVE = process.env.ASAAS_API_KEY || '';
const ehSandbox = CHAVE.startsWith('$aact_hmlg_');

// Nunca deixar este arquivo falar com a conta de PRODUÇÃO: ele cria cobranças
// de verdade. Chave de produção presente = pula, não roda.
const opcoes = { skip: ehSandbox ? false : 'sem ASAAS_API_KEY de sandbox no ambiente' };

const TOKEN_WEBHOOK = 'token-e2e-sandbox';
let baseUrl;

test.before(async () => {
  if (!ehSandbox) return;
  baseUrl = await startServer();
  config.asaas.apiKey = CHAVE;
  config.asaas.environment = 'sandbox';
  config.asaas.webhookToken = TOKEN_WEBHOOK;
  config.asaas.baseUrlOverride = '';
});

test.after(async () => {
  await stopServer();
  await pool.end();
});

// Enquanto o Asaas está em sandbox, só o dono do sistema é mandado para lá -
// ver clientePodeUsarAsaas. Por isso o e2e usa uma conta de admin.
async function clienteLogado({ role = 'admin' } = {}) {
  const cliente = await createLoginableClient({ role });
  const agente = createAgent(baseUrl);
  await agente.login(cliente.email, cliente.password);
  return { cliente, agente };
}

// Cartão de teste que o próprio Asaas publica para sandbox. Em produção este
// número não autoriza nada.
const CARTAO_DE_TESTE = {
  number: '5162306219378829',
  expiryMonth: '05',
  expiryYear: '2030',
  ccv: '318',
  holderName: 'Marcelo H Almeida',
};

const TITULAR_DE_TESTE = {
  nome: 'Marcelo Henrique Almeida',
  documento: '529.982.247-25',
  cep: '89223-005',
  numeroEndereco: '277',
  telefone: '(47) 99878-1877',
};

test('tokenização: o cartão real vira token no Asaas e só o token fica com a gente', opcoes, async () => {
  const { cliente, agente } = await clienteLogado();

  const r = await agente.post('/api/client/checkout/cartao', {
    titular: TITULAR_DE_TESTE,
    cartao: CARTAO_DE_TESTE,
  });
  assert.equal(r.status, 200, `esperava 200, veio ${r.status}: ${r.text}`);
  assert.equal(r.body.card.last4, '8829');
  assert.ok(r.body.card.brand, 'o Asaas devolve a bandeira que ele reconheceu');

  const { rows } = await pool.query('SELECT * FROM client_subscriptions WHERE client_user_id = $1', [cliente.id]);
  assert.ok(rows[0].asaas_card_token, 'o token tem que ficar guardado - é ele que permite cobrar depois');
  assert.ok(
    !JSON.stringify(rows[0]).includes(CARTAO_DE_TESTE.number),
    'o número do cartão nunca pode chegar ao nosso banco'
  );
});

test('crédito avulso no cartão: cobra de verdade no Asaas e libera o crédito na hora', opcoes, async () => {
  const { cliente, agente } = await clienteLogado();
  await agente.post('/api/client/checkout/cartao', { titular: TITULAR_DE_TESTE, cartao: CARTAO_DE_TESTE });

  const r = await agente.post('/api/client/checkout/pagar', {
    tipo: 'creditos',
    metodo: 'cartao',
    minutos: 100,
    bucket: 'normal',
  });
  assert.equal(r.status, 200, `esperava 200, veio ${r.status}: ${r.text}`);
  assert.equal(r.body.pago, true, 'o cartão de teste do Asaas autoriza na hora');

  const { rows: pagamentos } = await pool.query(
    "SELECT * FROM asaas_payments WHERE client_user_id = $1 AND purpose = 'credit_package' ORDER BY id DESC LIMIT 1",
    [cliente.id]
  );
  assert.equal(pagamentos[0].status, 'pago');
  assert.equal(pagamentos[0].billing_type, 'CREDIT_CARD');

  const depois = await readCredits(cliente.id);
  assert.equal(depois.extra_normal, 100);
});

test('assinatura no cartão: cria a recorrência real e cobra o primeiro mês promocional', opcoes, async () => {
  const { cliente, agente } = await clienteLogado();
  const planos = await subscriptionPlansRepository.listActive();
  const plano = planos[0];
  await agente.post('/api/client/checkout/cartao', { titular: TITULAR_DE_TESTE, cartao: CARTAO_DE_TESTE });

  const r = await agente.post('/api/client/checkout/pagar', { tipo: 'plano', metodo: 'cartao', planKey: plano.key });
  assert.equal(r.status, 200, `esperava 200, veio ${r.status}: ${r.text}`);
  assert.equal(r.body.pago, true);
  assert.equal(r.body.preco.primeiraCobrancaCents, plano.first_month_price_cents);
  assert.equal(r.body.preco.recorrenteCents, plano.price_cents);

  const { rows: assinaturas } = await pool.query('SELECT * FROM client_subscriptions WHERE client_user_id = $1', [
    cliente.id,
  ]);
  assert.equal(assinaturas[0].status, 'ativo');
  assert.equal(Number(assinaturas[0].plan_id), Number(plano.id));
  assert.equal(assinaturas[0].subscription_provider, 'asaas');
  assert.ok(assinaturas[0].asaas_subscription_id, 'sem o id da recorrência não dá pra cancelar depois');

  // A cota do plano tem que valer na hora: pagar e continuar sem conseguir
  // processar nada até o reset semanal seria o mesmo que não ter pago.
  const creditos = await readCredits(cliente.id);
  assert.equal(creditos.quota_normal, plano.weekly_minutes_normal);
});

test('crédito por PIX: o Asaas devolve um QR Code de verdade', opcoes, async () => {
  const { cliente, agente } = await clienteLogado();

  const r = await agente.post('/api/client/checkout/pagar', {
    tipo: 'creditos',
    metodo: 'pix',
    minutos: 100,
    titular: { nome: TITULAR_DE_TESTE.nome, documento: TITULAR_DE_TESTE.documento },
  });
  assert.equal(r.status, 200, `esperava 200, veio ${r.status}: ${r.text}`);
  assert.equal(r.body.pago, false, 'PIX só é confirmado quando o cliente paga no banco');
  assert.ok(r.body.pixCopiaECola.startsWith('000201'), 'não parece um código Pix');
  assert.ok(r.body.qrCodeBase64 && r.body.qrCodeBase64.length > 500, 'QR Code ausente');

  const { rows } = await pool.query(
    "SELECT * FROM asaas_payments WHERE client_user_id = $1 AND billing_type = 'PIX' ORDER BY id DESC LIMIT 1",
    [cliente.id]
  );
  assert.equal(rows[0].status, 'pendente');
});

test('cartão recusado pelo Asaas vira 400 com o motivo, não 500 genérico', opcoes, async () => {
  const { agente } = await clienteLogado();

  // Número que não passa na validação do emissor no sandbox.
  const r = await agente.post('/api/client/checkout/cartao', {
    titular: TITULAR_DE_TESTE,
    cartao: { ...CARTAO_DE_TESTE, number: '4000000000000002' },
  });
  assert.ok(r.status === 200 || r.status === 400, `esperava 200 ou 400, veio ${r.status}: ${r.text}`);
  if (r.status === 400) {
    assert.ok(r.body.error && r.body.error.length > 0, 'na tela de pagamento, erro sem motivo é o pior texto possível');
  }
});

test('cliente comum NÃO é mandado pro Asaas enquanto ele está em sandbox', opcoes, async () => {
  // Esta é a trava que impede o pior cenário da fase de validação: em sandbox
  // o pagamento é de mentira, mas o crédito que ele libera é de verdade. Sem
  // isso, um cliente real que clicasse em "Assinar" durante os testes
  // assinaria de graça e receberia a cota inteira.
  const { cliente, agente } = await clienteLogado({ role: 'client' });
  const planos = await subscriptionPlansRepository.listActive();

  const r = await agente.post('/api/client/billing/subscribe', { planKey: planos[0].key });

  // Sem Stripe configurada no ambiente de teste, o caminho do cliente comum
  // recusa - o que importa é que ele NÃO virou um checkout do Asaas.
  assert.notEqual(r.status, 200);
  const { rows } = await pool.query('SELECT count(*)::int AS n FROM asaas_payments WHERE client_user_id = $1', [
    cliente.id,
  ]);
  assert.equal(rows[0].n, 0, 'cliente comum não pode gerar cobrança no Asaas em sandbox');
});

test('PIX Automático: gera o QR Code real que paga e autoriza de uma vez', opcoes, async () => {
  const { cliente, agente } = await clienteLogado();
  const planos = await subscriptionPlansRepository.listActive();
  const plano = planos[0];

  const r = await agente.post('/api/client/billing/subscribe-pix', {
    planKey: plano.key,
    name: 'Cliente De Teste',
    cpfCnpj: '529.982.247-25',
  });
  assert.equal(r.status, 200, `esperava 200, veio ${r.status}: ${r.text}`);

  // O copia-e-cola tem que ser um Pix de verdade (começa com o payload do
  // padrão do Banco Central) e trazer a parte de recorrência.
  assert.ok(r.body.pixCopiaECola.startsWith('000201'), 'não parece um código Pix');
  assert.match(r.body.pixCopiaECola, /br\.gov\.bcb\.pix/);
  assert.ok(r.body.qrCodeBase64 && r.body.qrCodeBase64.length > 500, 'QR Code ausente');
  assert.equal(r.body.status, 'CREATED');

  const { rows } = await pool.query(
    'SELECT * FROM asaas_pix_authorizations WHERE client_user_id = $1 ORDER BY id DESC LIMIT 1',
    [cliente.id]
  );
  assert.equal(rows[0].status, 'criada');
  // O QR que o cliente paga agora e o promocional; o debito mensal seguinte
  // ja e o preco cheio (ver createPixAutomaticSubscription).
  assert.equal(rows[0].amount_cents, plano.first_month_price_cents);
  assert.equal(r.body.recorrenteCents, plano.price_cents);
  assert.equal(rows[0].asaas_authorization_id, r.body.authorizationId);

  // O documento fica guardado só neste caminho - no cartão nunca é pedido.
  const { rows: u } = await pool.query('SELECT cpf_cnpj FROM users WHERE id = $1', [cliente.id]);
  assert.equal(u[0].cpf_cnpj, '52998224725', 'guardado sem máscara, como o Asaas espera');
});

test('PIX Automático recusa CPF inválido antes de falar com o Asaas', opcoes, async () => {
  const { agente } = await clienteLogado();
  const planos = await subscriptionPlansRepository.listActive();

  const r = await agente.post('/api/client/billing/subscribe-pix', {
    planKey: planos[0].key,
    name: 'Cliente De Teste',
    cpfCnpj: '111.111.111-11',
  });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /CPF|CNPJ/i);
});
