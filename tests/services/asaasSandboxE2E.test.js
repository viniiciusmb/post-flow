// Caminho completo do pagamento contra a API REAL do Asaas (sandbox).
//
// Os outros testes usam um Asaas de mentira, o que é certo para travar
// comportamento. Este faz o oposto de propósito: fala com o Asaas de verdade,
// porque foi assim — e só assim — que apareceram as exigências que a
// documentação não menciona (endereço completo obrigatório quando se manda
// dado do cliente, limite de 30 caracteres no nome do item, PIX recusado sem
// chave Pix cadastrada). Contrato de terceiro só se confirma contra o terceiro.
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

async function avisarPagamento(checkoutId, extras = {}) {
  const r = await fetch(`${baseUrl}/api/asaas/webhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'asaas-access-token': TOKEN_WEBHOOK },
    body: JSON.stringify({ event: 'CHECKOUT_PAID', checkout: { id: checkoutId, ...extras } }),
  });
  return r.status;
}

test('compra de crédito avulso: cria a cobrança no Asaas e libera o crédito quando o dinheiro entra', opcoes, async () => {
  const { cliente, agente } = await clienteLogado();

  const r = await agente.post('/api/client/billing/buy-package', { minutes: 100, bucket: 'normal' });
  assert.equal(r.status, 200, `esperava 200, veio ${r.status}: ${r.text}`);

  // O link é a tela de pagamento hospedada pelo Asaas - é para onde o cliente
  // é mandado, e onde o cartão dele é digitado (nunca no nosso servidor).
  assert.match(r.body.checkoutUrl, /^https:\/\/sandbox\.asaas\.com\/checkoutSession\/show\//);

  const { rows: checkouts } = await pool.query(
    'SELECT * FROM asaas_checkouts WHERE client_user_id = $1 ORDER BY id DESC LIMIT 1',
    [cliente.id]
  );
  assert.equal(checkouts.length, 1);
  assert.equal(checkouts[0].purpose, 'credit_package');
  assert.equal(checkouts[0].status, 'pendente');
  // 100 min x R$ 0,25 = R$ 25,00
  assert.equal(checkouts[0].amount_cents, 2500);
  // O id guardado é o mesmo do link - é ele que liga o aviso de pagamento a
  // este cliente, já que o aviso não traz nada mais nosso.
  assert.ok(r.body.checkoutUrl.endsWith(checkouts[0].asaas_checkout_id));

  const { rows: compras } = await pool.query(
    'SELECT * FROM credit_purchases WHERE client_user_id = $1 ORDER BY id DESC LIMIT 1',
    [cliente.id]
  );
  assert.equal(compras[0].status, 'pendente');
  assert.equal(compras[0].provider, 'asaas');
  assert.equal(compras[0].minutes, 100);

  // Antes de pagar, nenhum crédito.
  const antes = await readCredits(cliente.id);
  assert.ok(!antes || antes.extra_normal === 0);

  assert.equal(await avisarPagamento(checkouts[0].asaas_checkout_id), 200);

  const depois = await readCredits(cliente.id);
  assert.equal(depois.extra_normal, 100);
  const { rows: comprasDepois } = await pool.query('SELECT status FROM credit_purchases WHERE id = $1', [compras[0].id]);
  assert.equal(comprasDepois[0].status, 'pago');
});

test('assinatura mensal: cria a recorrência no Asaas e ativa o plano quando o cliente paga', opcoes, async () => {
  const { cliente, agente } = await clienteLogado();
  const planos = await subscriptionPlansRepository.listActive();
  const plano = planos[0];

  const r = await agente.post('/api/client/billing/subscribe', { planKey: plano.key });
  assert.equal(r.status, 200, `esperava 200, veio ${r.status}: ${r.text}`);
  assert.match(r.body.checkoutUrl, /^https:\/\/sandbox\.asaas\.com\/checkoutSession\/show\//);

  const { rows: checkouts } = await pool.query(
    "SELECT * FROM asaas_checkouts WHERE client_user_id = $1 AND purpose = 'subscription' ORDER BY id DESC LIMIT 1",
    [cliente.id]
  );
  assert.equal(checkouts.length, 1);
  assert.equal(Number(checkouts[0].plan_id), Number(plano.id));
  assert.equal(checkouts[0].amount_cents, plano.price_cents);

  assert.equal(await avisarPagamento(checkouts[0].asaas_checkout_id, { customer: 'cus_e2e_falso' }), 200);

  const { rows: assinaturas } = await pool.query('SELECT * FROM client_subscriptions WHERE client_user_id = $1', [cliente.id]);
  assert.equal(assinaturas[0].status, 'ativo');
  assert.equal(Number(assinaturas[0].plan_id), Number(plano.id));
  assert.equal(assinaturas[0].subscription_provider, 'asaas');

  // A cota do plano tem que valer na hora: pagar e continuar sem conseguir
  // processar nada até o reset semanal seria o mesmo que não ter pago.
  const creditos = await readCredits(cliente.id);
  assert.ok(creditos.quota_normal > 0, 'a cota do plano tem que entrar na ativação');
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
  const { rows } = await pool.query('SELECT count(*)::int AS n FROM asaas_checkouts WHERE client_user_id = $1', [
    cliente.id,
  ]);
  assert.equal(rows[0].n, 0, 'cliente comum não pode gerar cobrança no Asaas em sandbox');
});

test('o nome do item respeita o limite de 30 caracteres do Asaas', opcoes, async () => {
  const { agente } = await clienteLogado();
  // 1000 minutos gera o nome mais longo possível ("Credito Post Flow 1000min").
  const r = await agente.post('/api/client/billing/buy-package', { minutes: 1000, bucket: 'normal' });
  assert.equal(r.status, 200, `o Asaas recusaria o nome longo demais: ${r.text}`);
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
  assert.equal(rows[0].amount_cents, plano.price_cents);
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
