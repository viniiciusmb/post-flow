// Livro de receita (migration 086).
//
// Até 13/09/2026 a mensalidade do 2º mês em diante não ficava gravada em lugar
// nenhum: quem cobra é a assinatura recorrente do Asaas, e o aviso dela só
// reativava o plano e pagava comissão. A receita recorrente - a que sustenta o
// negócio - era justamente a parte invisível.
//
// O que estes testes travam:
//   - primeira mensalidade x recorrência decidida pelo histórico do cliente;
//   - aviso repetido não conta duas vezes;
//   - estorno sai da receita no dia em que aconteceu, sem reescrever o passado;
//   - MRR usa a mensalidade CHEIA e ignora cortesia;
//   - o webhook de renovação registra a recorrência de ponta a ponta.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const pool = require('../../src/db/pool');
const config = require('../../src/config');
const db = require('../helpers/db');
const receitaService = require('../../src/services/receitaService');
const clientSubscriptionsRepository = require('../../src/repositories/clientSubscriptionsRepository');
const subscriptionPlansRepository = require('../../src/repositories/subscriptionPlansRepository');
const { resolveRange } = require('../../src/lib/dateRanges');
const { startServer, stopServer, createLoginableClient, createAgent } = require('../helpers/http');

const TOKEN = 'token-do-webhook-receita';
let url;

test.before(async () => {
  url = await startServer();
  config.asaas.webhookToken = TOKEN;
  config.asaas.apiKey = '$aact_hmlg_teste';
  config.asaas.environment = 'sandbox';
});
test.after(async () => {
  await stopServer();
  await pool.end();
});

let seq = 0;
const idUnico = (p) => `${p}_${process.pid}_${Date.now()}_${seq++}`;

async function linhasDoCliente(clientUserId) {
  const { rows } = await pool.query(
    'SELECT * FROM revenue_entries WHERE client_user_id = $1 ORDER BY paid_at, id',
    [clientUserId]
  );
  return rows;
}

// --- Registro ---

test('a primeira mensalidade de um cliente é "primeira"; as seguintes são recorrência', async () => {
  const cliente = await db.createClient();
  await receitaService.registrarMensalidade({ clientUserId: cliente.id, provider: 'asaas', externalId: idUnico('pay'), amountCents: 13990 });
  await receitaService.registrarMensalidade({ clientUserId: cliente.id, provider: 'asaas', externalId: idUnico('pay'), amountCents: 22990 });
  await receitaService.registrarMensalidade({ clientUserId: cliente.id, provider: 'asaas', externalId: idUnico('pay'), amountCents: 22990 });

  const linhas = await linhasDoCliente(cliente.id);
  assert.deepEqual(linhas.map((l) => l.kind), ['primeira_mensalidade', 'recorrencia', 'recorrencia']);
});

test('aviso repetido do provedor não conta a mesma cobrança duas vezes', async () => {
  const cliente = await db.createClient();
  const id = idUnico('pay');
  // O caminho síncrono do checkout e o webhook chegam juntos.
  await Promise.all([
    receitaService.registrarMensalidade({ clientUserId: cliente.id, provider: 'asaas', externalId: id, amountCents: 9990 }),
    receitaService.registrarMensalidade({ clientUserId: cliente.id, provider: 'asaas', externalId: id, amountCents: 9990 }),
  ]);
  assert.equal((await linhasDoCliente(cliente.id)).length, 1);
});

test('estornar a primeira venda NÃO faz a próxima mensalidade virar "primeira" de novo', async () => {
  const cliente = await db.createClient();
  const primeira = idUnico('pay');
  await receitaService.registrarMensalidade({ clientUserId: cliente.id, provider: 'asaas', externalId: primeira, amountCents: 5990 });
  await receitaService.marcarEstorno({ provider: 'asaas', externalId: primeira });
  await receitaService.registrarMensalidade({ clientUserId: cliente.id, provider: 'asaas', externalId: idUnico('pay'), amountCents: 5990 });

  const linhas = await linhasDoCliente(cliente.id);
  assert.equal(linhas.filter((l) => l.kind === 'primeira_mensalidade').length, 1, 'o mesmo cliente contaria duas vezes como venda nova');
});

test('registrar receita nunca derruba o pagamento, mesmo com dado inválido', async () => {
  const r = await receitaService.registrar({ clientUserId: null, kind: 'tipo-que-nao-existe', provider: 'asaas', externalId: idUnico('x'), amountCents: 100 });
  assert.equal(r, null);
});

test('mesesEntre conta mês inteiro só quando o dia é alcançado', () => {
  assert.equal(receitaService.mesesEntre('2026-01-15T12:00:00Z', '2026-02-14T12:00:00Z'), 0);
  assert.equal(receitaService.mesesEntre('2026-01-15T12:00:00Z', '2026-02-15T12:00:00Z'), 1);
  assert.equal(receitaService.mesesEntre('2025-09-13T12:00:00Z', '2026-09-13T12:00:00Z'), 12);
});

// --- Leitura ---

test('o período soma cada tipo no lugar certo e desconta o estorno', async () => {
  const hoje = resolveRange('today');
  const antes = await receitaService.painel(hoje);

  const cliente = await db.createClient();
  await receitaService.registrarMensalidade({ clientUserId: cliente.id, provider: 'asaas', externalId: idUnico('pay'), amountCents: 10000 });
  await receitaService.registrarMensalidade({ clientUserId: cliente.id, provider: 'asaas', externalId: idUnico('pay'), amountCents: 20000 });
  await receitaService.registrar({ clientUserId: cliente.id, kind: 'credito_avulso', provider: 'asaas', externalId: idUnico('pay'), amountCents: 625 });
  await receitaService.registrar({ clientUserId: cliente.id, kind: 'excedente', provider: 'stripe', externalId: idUnico('pi'), amountCents: 300 });
  const estornada = idUnico('pay');
  await receitaService.registrar({ clientUserId: cliente.id, kind: 'conexoes_extras', provider: 'asaas', externalId: estornada, amountCents: 1490 });
  await receitaService.marcarEstorno({ provider: 'asaas', externalId: estornada });

  const depois = await receitaService.painel(resolveRange('today'));
  const d = (k) => depois.periodo[k] - antes.periodo[k];

  assert.equal(d('primeiraCents'), 10000);
  assert.equal(d('recorrenciaCents'), 20000);
  assert.equal(depois.periodo.extras.creditoAvulsoCents - antes.periodo.extras.creditoAvulsoCents, 625);
  assert.equal(depois.periodo.extras.excedenteCents - antes.periodo.extras.excedenteCents, 300);
  assert.equal(d('extrasCents'), 625 + 300 + 1490, 'o valor estornado continua no bruto do dia em que entrou');
  assert.equal(d('estornosCents'), 1490);
  assert.equal(d('liquidoCents'), 10000 + 20000 + 625 + 300, 'líquido = bruto - estornos');
  assert.equal(d('novasAssinaturas'), 1);
});

test('MRR soma a mensalidade CHEIA de quem paga e deixa cortesia de fora', async () => {
  const antes = (await receitaService.painel(resolveRange('today'))).atual;
  const max = await subscriptionPlansRepository.findByKey('max');

  // Pagante: tem assinatura recorrente no Asaas.
  const pagante = await db.createClient();
  await clientSubscriptionsRepository.setPlan(pagante.id, max.id);
  await pool.query('UPDATE client_subscriptions SET asaas_subscription_id = $2 WHERE client_user_id = $1', [pagante.id, idUnico('sub')]);

  // Cortesia: plano atribuído à mão, nenhuma cobrança.
  const cortesia = await db.createClient();
  await clientSubscriptionsRepository.setPlan(cortesia.id, max.id);

  const atual = (await receitaService.painel(resolveRange('today'))).atual;
  assert.equal(atual.mrrCents - antes.mrrCents, Number(max.price_cents), 'MRR tem que usar a mensalidade cheia, não a de estreia');
  assert.equal(atual.pagantes - antes.pagantes, 1);
  assert.equal(atual.cortesia - antes.cortesia, 1, 'cortesia aparece contada à parte, fora do MRR');
});

test('cancelar carimba a data, e voltar a ativo apaga o carimbo', async () => {
  const cliente = await db.createClient();
  const pro = await subscriptionPlansRepository.findByKey('pro');
  await clientSubscriptionsRepository.setPlan(cliente.id, pro.id);

  const cancelado = await clientSubscriptionsRepository.setStatus(cliente.id, 'cancelado');
  assert.ok(cancelado.canceled_at);
  const deNovo = await clientSubscriptionsRepository.setStatus(cliente.id, 'cancelado');
  assert.equal(new Date(deNovo.canceled_at).getTime(), new Date(cancelado.canceled_at).getTime(), 'aviso repetido adiantou a data');

  const voltou = await clientSubscriptionsRepository.setStatus(cliente.id, 'ativo');
  assert.equal(voltou.canceled_at, null);
});

// --- Ponta a ponta ---

async function webhook(corpo) {
  const r = await fetch(`${url}/api/asaas/webhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'asaas-access-token': TOKEN },
    body: JSON.stringify(corpo),
  });
  return r.status;
}

test('renovação mensal pelo webhook entra como recorrência, e o estorno dela sai', async () => {
  const cliente = await db.createClient();
  const max = await subscriptionPlansRepository.findByKey('max');
  const sub = idUnico('sub');
  await clientSubscriptionsRepository.setPlan(cliente.id, max.id);
  await pool.query('UPDATE client_subscriptions SET asaas_subscription_id = $2 WHERE client_user_id = $1', [cliente.id, sub]);
  // A primeira mensalidade já tinha entrado pelo checkout.
  await receitaService.registrarMensalidade({ clientUserId: cliente.id, provider: 'asaas', externalId: idUnico('pay'), amountCents: 13990 });

  const renovacao = idUnico('pay');
  const pagamento = { id: renovacao, subscription: sub, value: 229.9, billingType: 'CREDIT_CARD' };
  assert.equal(await webhook({ event: 'PAYMENT_CONFIRMED', payment: pagamento }), 200);
  assert.equal(await webhook({ event: 'PAYMENT_RECEIVED', payment: pagamento }), 200);

  let linhas = await linhasDoCliente(cliente.id);
  assert.equal(linhas.length, 2, 'CONFIRMED + RECEIVED da mesma cobrança contaram duas vezes');
  assert.equal(linhas[1].kind, 'recorrencia');
  assert.equal(linhas[1].amount_cents, 22990);

  assert.equal(await webhook({ event: 'PAYMENT_REFUNDED', payment: pagamento }), 200);
  linhas = await linhasDoCliente(cliente.id);
  assert.ok(linhas[1].refunded_at, 'o estorno da renovação não foi marcado');
});

test('o painel de receita é só do admin', async () => {
  const cliente = await createLoginableClient();
  const agenteCliente = createAgent(url);
  await agenteCliente.login(cliente.email, cliente.password);
  const negado = await agenteCliente.get('/api/admin/revenue?range=today');
  assert.notEqual(negado.status, 200, 'um cliente conseguiu ver a receita da empresa');

  const admin = await createLoginableClient({ role: 'admin' });
  const agenteAdmin = createAgent(url);
  await agenteAdmin.login(admin.email, admin.password);
  const r = await agenteAdmin.get('/api/admin/revenue?range=this_month');
  assert.equal(r.status, 200, r.text);
  assert.ok(typeof r.body.atual.mrrCents === 'number');
  assert.equal(r.body.porMes.length, 12, 'o gráfico sempre mostra 12 meses');
  assert.ok(Array.isArray(r.body.assinaturas));

  const inicio = await agenteAdmin.get('/api/admin/dashboard?range=today');
  assert.equal(inicio.status, 200, inicio.text);
  assert.equal(inicio.body.receita.mrrCents, r.body.atual.mrrCents, 'Início e Receita discordam do MRR');
});
