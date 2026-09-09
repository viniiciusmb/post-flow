// Vários links por afiliado (um por lugar onde ele divulga), contagem de
// cliques por link, e os números do painel: assinaturas ativas/canceladas,
// MRR previsto, vendas do período e recorrência do período.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const affiliateLinksRepository = require('../../src/repositories/affiliateLinksRepository');
const affiliateLinkClicksRepository = require('../../src/repositories/affiliateLinkClicksRepository');
const affiliatesRepository = require('../../src/repositories/affiliatesRepository');
const referralsRepository = require('../../src/repositories/referralsRepository');
const clientSubscriptionsRepository = require('../../src/repositories/clientSubscriptionsRepository');
const settingsRepository = require('../../src/repositories/settingsRepository');
const affiliateService = require('../../src/services/affiliateService');
const afiliadoDashboardService = require('../../src/services/afiliadoDashboardService');
const { resolveRange } = require('../../src/lib/dateRanges');
const pool = require('../../src/db/pool');
const { createClient, closePool } = require('../helpers/db');

test.after(() => closePool());

let n = 0;
function idUnico(p) {
  n += 1;
  return `${p}_${process.pid}_${n}_${Date.now()}`;
}

async function planoDe(chave) {
  const { rows } = await pool.query('SELECT * FROM subscription_plans WHERE key = $1', [chave]);
  return rows[0];
}

// Indicado com plano e status, do jeito que ele existe de verdade.
async function indicar(referenteId, linkId, { plano, status } = {}) {
  const indicado = await createClient();
  await referralsRepository.create({
    referredUserId: indicado.id,
    affiliateLinkId: linkId,
    referrerUserId: referenteId,
  });
  if (plano) {
    const p = await planoDe(plano);
    await clientSubscriptionsRepository.setPlan(indicado.id, p.id);
  }
  if (status) await clientSubscriptionsRepository.setStatus(indicado.id, status);
  return indicado;
}

async function clicar(linkId, quantos, visitante = 'v1') {
  for (let i = 0; i < quantos; i++) {
    await affiliateLinkClicksRepository.record({
      affiliateLinkId: linkId,
      visitorHash: `${visitante}-${i}`,
      landingPath: '/',
    });
  }
}

test('o afiliado cria varios links e cada um guarda o proprio rotulo e codigo', async () => {
  const dono = await createClient();
  await affiliateLinksRepository.getOrCreateDefault(dono.id);
  const bio = await affiliateLinksRepository.createForOwner(dono.id, { label: 'Bio do TikTok' });
  const yt = await affiliateLinksRepository.createForOwner(dono.id, { label: 'Descrição do YouTube' });

  assert.notEqual(bio.code, yt.code, 'cada link tem endereco proprio');
  assert.equal(bio.is_default, false);

  const todos = await affiliateLinksRepository.listByOwnerWithStats(dono.id, {});
  assert.equal(todos.length, 3);
  assert.equal(todos[0].is_default, true, 'o principal vem primeiro');
});

test('cliques e vendas sao contados por link, sem um numero contaminar o outro', async () => {
  // Sem subconsulta (juntando cliques e indicações no mesmo GROUP BY), um link
  // com 6 cliques e 2 indicações reportaria 12 cliques - o defeito de fan-out
  // que já apareceu na tela "Clientes" do admin.
  const dono = await createClient();
  await affiliateLinksRepository.getOrCreateDefault(dono.id);
  const bio = await affiliateLinksRepository.createForOwner(dono.id, { label: 'Bio' });
  const grupo = await affiliateLinksRepository.createForOwner(dono.id, { label: 'Grupo' });

  await clicar(bio.id, 6, 'bio');
  await clicar(grupo.id, 2, 'grupo');
  await indicar(dono.id, bio.id, { plano: 'pro', status: 'ativo' });
  await indicar(dono.id, bio.id, { plano: 'starter', status: 'ativo' });

  const links = await affiliateLinksRepository.listByOwnerWithStats(dono.id, {});
  const doBio = links.find((l) => Number(l.id) === Number(bio.id));
  const doGrupo = links.find((l) => Number(l.id) === Number(grupo.id));

  assert.equal(doBio.clicks_total, 6, 'as 2 indicacoes nao multiplicam os cliques');
  assert.equal(doBio.referral_count, 2);
  assert.equal(doBio.active_count, 2);
  assert.equal(doGrupo.clicks_total, 2);
  assert.equal(doGrupo.referral_count, 0);
});

test('um afiliado nunca renomeia nem arquiva o link de outro', async () => {
  const dono = await createClient();
  const intruso = await createClient();
  const link = await affiliateLinksRepository.createForOwner(dono.id, { label: 'Meu' });

  assert.equal(await affiliateLinksRepository.setLabel(link.id, intruso.id, 'Roubado'), null);
  assert.equal(await affiliateLinksRepository.setArchived(link.id, intruso.id, true), null);

  const ainda = await affiliateLinksRepository.listByOwnerWithStats(dono.id, {});
  assert.equal(ainda.find((l) => Number(l.id) === Number(link.id)).label, 'Meu');
});

test('o link principal nunca pode ser arquivado', async () => {
  const dono = await createClient();
  const padrao = await affiliateLinksRepository.getOrCreateDefault(dono.id);
  assert.equal(await affiliateLinksRepository.setArchived(padrao.id, dono.id, true), null);
});

test('link arquivado continua contando clique e continua trazendo venda', async () => {
  // Arquivar é organização de tela. Se desligasse de verdade, o link que ainda
  // está na bio de alguém pararia de creditar o afiliado que o colocou lá.
  const dono = await createClient();
  await affiliateLinksRepository.getOrCreateDefault(dono.id);
  const antigo = await affiliateLinksRepository.createForOwner(dono.id, { label: 'Campanha velha' });
  await affiliateLinksRepository.setArchived(antigo.id, dono.id, true);

  const achado = await affiliateLinksRepository.findByCode(antigo.code);
  assert.ok(achado, 'o codigo continua valendo depois de arquivado');

  await clicar(antigo.id, 3, 'tarde');
  await indicar(dono.id, antigo.id, { plano: 'pro', status: 'ativo' });

  const links = await affiliateLinksRepository.listByOwnerWithStats(dono.id, {});
  const arquivado = links.find((l) => Number(l.id) === Number(antigo.id));
  assert.ok(arquivado.archived_at, 'segue marcado como arquivado');
  assert.equal(arquivado.clicks_total, 3);
  assert.equal(arquivado.referral_count, 1);
});

test('painel: ativas, canceladas e MRR previsto saem da base real de indicados', async () => {
  await settingsRepository.setValue('affiliate_commission_percent_default', 10);
  await settingsRepository.setValue('affiliate_commission_recurring_percent_default', 5);
  const dono = await createClient();
  const link = await affiliateLinksRepository.getOrCreateDefault(dono.id);

  const pro = await planoDe('pro');
  const starter = await planoDe('starter');
  await indicar(dono.id, link.id, { plano: 'pro', status: 'ativo' });
  await indicar(dono.id, link.id, { plano: 'starter', status: 'ativo' });
  await indicar(dono.id, link.id, { plano: 'starter', status: 'cancelado' });
  await indicar(dono.id, link.id, {}); // so criou conta

  const painel = await afiliadoDashboardService.montar({ userId: dono.id, since: null, until: null, rangeKey: 'all' });

  assert.equal(painel.subscriptions.active, 2);
  assert.equal(painel.subscriptions.canceled, 1);
  assert.equal(painel.subscriptions.withoutPlan, 1);
  assert.equal(
    painel.subscriptions.mrrBaseCents,
    pro.price_cents + starter.price_cents,
    'so as ATIVAS entram na base do MRR - cancelada nao paga mes que vem'
  );
  assert.equal(
    painel.subscriptions.mrrCents,
    Math.round(((pro.price_cents + starter.price_cents) * 5) / 100),
    'MRR previsto usa o percentual de RECORRENCIA, nao o de venda nova'
  );
  assert.equal(painel.percent.first, 10);
  assert.equal(painel.percent.recurring, 5);
});

test('painel: venda nova e recorrencia aparecem separadas, e a soma bate com o extrato', async () => {
  await settingsRepository.setValue('affiliate_commission_percent_default', 20);
  await settingsRepository.setValue('affiliate_commission_recurring_percent_default', 5);
  await settingsRepository.setValue('affiliate_commission_max_months', 12);
  const dono = await createClient();
  const link = await affiliateLinksRepository.getOrCreateDefault(dono.id);
  const indicado = await indicar(dono.id, link.id, { plano: 'pro', status: 'ativo' });

  const pagar = () =>
    affiliateService.recordCommissionForPayment({
      clientUserId: indicado.id,
      provider: 'asaas',
      externalPaymentId: idUnico('pay'),
      amountPaidCents: 10000,
    });
  await pagar();
  await pagar();
  await pagar();

  const painel = await afiliadoDashboardService.montar({ userId: dono.id, since: null, until: null, rangeKey: 'all' });
  assert.equal(painel.sales.count, 1);
  assert.equal(painel.sales.commissionCents, 2000);
  assert.equal(painel.recurring.count, 2);
  assert.equal(painel.recurring.commissionCents, 1000);
  assert.equal(painel.periodTotalCents, 3000);
  assert.equal(
    painel.recentCommissions.reduce((s, c) => s + c.commissionCents, 0),
    painel.periodTotalCents,
    'o extrato tem que somar exatamente o total mostrado nos cartoes'
  );
});

test('painel: cliques do periodo nao incluem os de fora dele', async () => {
  const dono = await createClient();
  const link = await affiliateLinksRepository.getOrCreateDefault(dono.id);
  await clicar(link.id, 4, 'hoje');
  await pool.query(
    `INSERT INTO affiliate_link_clicks (affiliate_link_id, visitor_hash, created_at)
     VALUES ($1, 'antigo', now() - interval '40 days')`,
    [link.id]
  );

  // O período vem de resolveRange, o MESMO que a tela usa. Cravar
  // `until: new Date()` aqui seria uma corrida entre dois relógios: o
  // created_at é o now() do Postgres e o until seria o do Node, então alguns
  // dos cliques recém-inseridos caem depois do fim do intervalo por poucos
  // milissegundos e o teste falha sem nada estar errado. resolveRange termina
  // o intervalo no fim do dia, e é isso que roda em produção.
  const { since, until, range } = resolveRange('last7days');
  const painel = await afiliadoDashboardService.montar({ userId: dono.id, since, until, rangeKey: range });
  assert.equal(painel.clicks.period, 4);
  assert.equal(painel.clicks.total, 5, 'o total historico inclui o antigo');
});
