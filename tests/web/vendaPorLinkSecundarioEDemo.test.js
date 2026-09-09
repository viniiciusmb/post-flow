// Duas coisas que só a pilha inteira prova:
//
//   1. Uma venda que entra por um link SECUNDÁRIO do afiliado (o da bio do
//      TikTok, não o principal) credita o afiliado certo e fica marcada como
//      vinda daquele link - senão a tela diria "de onde vêm as vendas" e a
//      resposta seria sempre "do principal".
//   2. O modo demonstração preenche o painel sem gravar nada no banco.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const affiliateLinksRepository = require('../../src/repositories/affiliateLinksRepository');
const affiliateService = require('../../src/services/affiliateService');
const settingsRepository = require('../../src/repositories/settingsRepository');
const demonstracao = require('../../src/lib/demonstracaoDeAfiliado');
const pool = require('../../src/db/pool');
const { startServer, stopServer, createLoginableClient, createAgent } = require('../helpers/http');

let baseUrl;

test.before(async () => {
  baseUrl = await startServer();
});
test.after(async () => {
  await stopServer();
  await pool.end();
});

test('venda que entra por um link secundario credita o dono e aparece com o rotulo daquele link', async () => {
  await settingsRepository.setValue('affiliate_commission_percent_default', 20);
  await settingsRepository.setValue('affiliate_commission_recurring_percent_default', 5);
  await settingsRepository.setValue('affiliate_commission_max_months', 12);

  const dono = await createLoginableClient();
  await affiliateLinksRepository.getOrCreateDefault(dono.id);
  const bio = await affiliateLinksRepository.createForOwner(dono.id, { label: 'Bio do TikTok' });

  // Alguém clica no link da bio e cria conta.
  const visitante = createAgent(baseUrl);
  await visitante.get(`/?ref=${bio.code}`);
  const email = `indicado_${process.pid}_${Date.now()}@teste.local`;
  const cadastro = await visitante.post('/register', {
    email,
    password: 'senha-de-teste-123',
    businessName: 'Vindo da bio',
    acceptedTerms: true,
  });
  assert.equal(cadastro.status, 302, `cadastro falhou: ${cadastro.status} ${cadastro.text}`);

  const { rows } = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
  const indicadoId = rows[0].id;

  const { rows: ref } = await pool.query('SELECT * FROM referrals WHERE referred_user_id = $1', [indicadoId]);
  assert.equal(Number(ref[0].affiliate_link_id), Number(bio.id), 'a indicacao guarda QUAL link trouxe');
  assert.equal(Number(ref[0].referrer_user_id), Number(dono.id));

  // O indicado paga a primeira mensalidade.
  const r = await affiliateService.recordCommissionForPayment({
    clientUserId: indicadoId,
    provider: 'asaas',
    externalPaymentId: `pay_bio_${process.pid}_${Date.now()}`,
    amountPaidCents: 15990,
  });
  assert.equal(r.kind, 'primeira');
  assert.equal(Number(r.affiliateUserId), Number(dono.id));

  const agente = createAgent(baseUrl);
  await agente.login(dono.email, dono.password);
  const painel = await agente.get('/api/client/commissions/overview?range=all');
  const naTela = painel.body.links.find((l) => l.id === Number(bio.id));
  assert.equal(naTela.referralCount, 1);
  assert.equal(naTela.commissionCents, r.credited, 'a comissao aparece pendurada no link que a trouxe');

  const indicacao = painel.body.recentReferrals.find((x) => x.businessName === 'Vindo da bio');
  assert.equal(indicacao.linkLabel, 'Bio do TikTok');
});

test('modo demonstracao preenche o painel sem gravar NADA no banco', async () => {
  const dono = await createLoginableClient();
  const agente = createAgent(baseUrl);
  await agente.login(dono.email, dono.password);

  const vazio = await agente.get('/api/client/commissions/overview?range=all');
  assert.equal(vazio.body.subscriptions.active, 0, 'conta nova comeca zerada');

  await settingsRepository.setValue(demonstracao.CHAVE, [Number(dono.id)]);
  try {
    const cheio = await agente.get('/api/client/commissions/overview?range=all');
    const d = cheio.body;

    assert.ok(d.subscriptions.active > 0);
    assert.ok(d.clicks.total > 0);
    assert.ok(d.balance.totalEarnedCents > 0);

    // Coerência interna: os cartões têm que bater com o extrato e com as
    // listas. Números escritos à mão um a um se contradizem no primeiro
    // filtro de período, e é exatamente aí que se percebe que são falsos.
    assert.equal(
      d.sales.commissionCents + d.recurring.commissionCents,
      d.periodTotalCents,
      'venda nova + recorrencia = total do periodo'
    );
    assert.equal(
      d.recentCommissions.reduce((s, c) => s + c.commissionCents, 0),
      d.periodTotalCents,
      'o extrato soma o total do periodo'
    );
    assert.equal(d.recentReferrals.length, d.referralCount, 'a lista de indicados bate com a contagem');
    assert.equal(
      d.subscriptions.active + d.subscriptions.canceled + d.subscriptions.overdue + d.subscriptions.withoutPlan,
      d.referralCount,
      'todo indicado esta em exatamente um estado'
    );
    assert.equal(
      d.subscriptions.mrrCents,
      Math.round((d.subscriptions.mrrBaseCents * d.percent.recurring) / 100),
      'o MRR previsto e a base vezes o percentual de recorrencia mostrado na tela'
    );
    assert.equal(
      d.links.reduce((s, l) => s + l.referralCount, 0),
      d.referralCount,
      'os cadastros por link somam o total de indicados'
    );
    assert.ok(d.links.every((l) => l.visitorsPeriod <= l.clicksPeriod), 'pessoas distintas nunca passa de cliques');
    // Saldo negativo é impossível na vida real (ninguém saca o que não ganhou)
    // e foi o que apareceu na primeira versão, com os saques cravados em
    // reais enquanto a comissão vinha de um percentual configurável.
    assert.ok(d.balance.availableCents >= 0, 'saldo disponivel nunca pode ser negativo');
    assert.equal(
      d.balance.availableCents + d.recentWithdrawals.reduce((s, w) => s + w.amountCents, 0),
      d.balance.totalEarnedCents,
      'disponivel + ja sacado = total ganho'
    );
    assert.ok(
      Math.abs(d.links.reduce((s, l) => s + l.clicksPeriod, 0) - d.clicks.period) <= d.links.length,
      'os cliques por link somam o total do periodo (fora o arredondamento)'
    );

    // Nada disso existe no banco.
    const gravado = await pool.query(
      `SELECT (SELECT count(*)::int FROM commission_entries WHERE affiliate_user_id = $1) AS entradas,
              (SELECT count(*)::int FROM referrals WHERE referrer_user_id = $1) AS indicacoes,
              (SELECT coalesce(max(balance_available_cents), 0)::int FROM affiliates WHERE user_id = $1) AS saldo`,
      [dono.id]
    );
    assert.deepEqual(gravado.rows[0], { entradas: 0, indicacoes: 0, saldo: 0 });

    // O pedido de saque também não pode virar dinheiro a pagar.
    const saque = await agente.post('/api/client/commissions/withdraw');
    assert.equal(saque.status, 200);
    const saques = await pool.query('SELECT count(*)::int AS n FROM affiliate_withdrawals WHERE affiliate_user_id = $1', [dono.id]);
    assert.equal(saques.rows[0].n, 0, 'nenhum saque de verdade foi criado');
  } finally {
    await settingsRepository.setValue(demonstracao.CHAVE, []);
  }

  const voltou = await agente.get('/api/client/commissions/overview?range=all');
  assert.equal(voltou.body.subscriptions.active, 0, 'desligar a chave devolve os numeros reais');
});

test('conta que nao esta na lista de demonstracao nunca ve numero inventado', async () => {
  const demo = await createLoginableClient();
  const normal = await createLoginableClient();
  await settingsRepository.setValue(demonstracao.CHAVE, [Number(demo.id)]);
  try {
    const agente = createAgent(baseUrl);
    await agente.login(normal.email, normal.password);
    const painel = await agente.get('/api/client/commissions/overview?range=all');
    assert.equal(painel.body.referralCount, 0);
    assert.equal(painel.body.clicks.total, 0);
    assert.equal(painel.body.balance.totalEarnedCents, 0);
  } finally {
    await settingsRepository.setValue(demonstracao.CHAVE, []);
  }
});
