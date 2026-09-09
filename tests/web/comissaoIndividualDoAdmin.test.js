// O admin define percentuais diferentes por afiliado: um para a primeira venda
// e outro para a recorrência (ex: 20% na entrada, 5% por mês).
//
// A armadilha desta tela é que os dois campos salvam separado, no onBlur. Se o
// servidor gravasse sempre os dois, mexer num deixaria o outro em branco - e
// "em branco" aqui não é neutro: significa voltar para o percentual padrão,
// desfazendo em silêncio um acordo combinado com o afiliado.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const affiliatesRepository = require('../../src/repositories/affiliatesRepository');
const affiliateLinksRepository = require('../../src/repositories/affiliateLinksRepository');
const referralsRepository = require('../../src/repositories/referralsRepository');
const settingsRepository = require('../../src/repositories/settingsRepository');
const affiliateService = require('../../src/services/affiliateService');
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

async function adminLogado() {
  const admin = await createLoginableClient({ role: 'admin' });
  const agente = createAgent(baseUrl);
  await agente.login(admin.email, admin.password);
  return agente;
}

// Afiliado com uma indicação (é o que o faz aparecer na lista do admin).
async function afiliadoComIndicacao() {
  const dono = await createLoginableClient();
  const link = await affiliateLinksRepository.getOrCreateDefault(dono.id);
  const indicado = await createLoginableClient();
  await referralsRepository.create({
    referredUserId: indicado.id,
    affiliateLinkId: link.id,
    referrerUserId: dono.id,
  });
  return { dono, indicado };
}

test('admin define 20% na primeira venda e 5% na recorrencia de um afiliado especifico', async () => {
  await settingsRepository.setValue('affiliate_commission_percent_default', 10);
  await settingsRepository.setValue('affiliate_commission_recurring_percent_default', 10);
  const agente = await adminLogado();
  const { dono, indicado } = await afiliadoComIndicacao();

  await agente.put(`/api/admin/commissions/affiliates/${dono.id}/percent`, { percent: 20 });
  await agente.put(`/api/admin/commissions/affiliates/${dono.id}/percent`, { recurringPercent: 5 });

  const pagar = () =>
    affiliateService.recordCommissionForPayment({
      clientUserId: indicado.id,
      provider: 'asaas',
      externalPaymentId: `pay_adm_${process.pid}_${Date.now()}_${Math.random()}`,
      amountPaidCents: 10000,
    });

  assert.equal((await pagar()).credited, 2000, 'venda nova a 20%');
  assert.equal((await pagar()).credited, 500, 'recorrencia a 5%');
});

test('salvar UM dos percentuais nao apaga o outro', async () => {
  const agente = await adminLogado();
  const { dono } = await afiliadoComIndicacao();

  await agente.put(`/api/admin/commissions/affiliates/${dono.id}/percent`, { percent: 25 });
  await agente.put(`/api/admin/commissions/affiliates/${dono.id}/percent`, { recurringPercent: 7 });
  // Agora mexe só na primeira venda de novo, como faria quem corrige um número.
  const r = await agente.put(`/api/admin/commissions/affiliates/${dono.id}/percent`, { percent: 30 });

  assert.equal(r.body.commissionPercentOverride, 30);
  assert.equal(r.body.commissionRecurringPercentOverride, 7, 'a recorrencia combinada tem que sobreviver');

  const guardado = await affiliatesRepository.getOrCreate(dono.id);
  assert.equal(Number(guardado.commission_recurring_percent_override), 7);
});

test('campo esvaziado devolve o afiliado ao padrao global (e so aquele campo)', async () => {
  const agente = await adminLogado();
  const { dono } = await afiliadoComIndicacao();

  await agente.put(`/api/admin/commissions/affiliates/${dono.id}/percent`, { percent: 25 });
  await agente.put(`/api/admin/commissions/affiliates/${dono.id}/percent`, { recurringPercent: 7 });
  const r = await agente.put(`/api/admin/commissions/affiliates/${dono.id}/percent`, { percent: null });

  assert.equal(r.body.commissionPercentOverride, null, 'volta pro padrao');
  assert.equal(r.body.commissionRecurringPercentOverride, 7);
});

test('a lista do admin manda os padroes globais junto, pra tela dizer o que o campo vazio significa', async () => {
  await settingsRepository.setValue('affiliate_commission_percent_default', 12);
  await settingsRepository.setValue('affiliate_commission_recurring_percent_default', 4);
  const agente = await adminLogado();
  await afiliadoComIndicacao();

  const r = await agente.get('/api/admin/commissions/affiliates');
  assert.equal(r.body.defaults.percentDefault, 12);
  assert.equal(r.body.defaults.recurringPercentDefault, 4);
});

test('percentual fora de 0-100 e recusado nos dois campos', async () => {
  const agente = await adminLogado();
  const { dono } = await afiliadoComIndicacao();

  assert.equal((await agente.put(`/api/admin/commissions/affiliates/${dono.id}/percent`, { percent: 140 })).status, 400);
  assert.equal(
    (await agente.put(`/api/admin/commissions/affiliates/${dono.id}/percent`, { recurringPercent: -5 })).status,
    400
  );
});

test('as configuracoes globais guardam os dois percentuais separados', async () => {
  const agente = await adminLogado();

  const r = await agente.put('/api/admin/commissions/settings', {
    percentDefault: 18,
    recurringPercentDefault: 6,
    minWithdrawCents: 5000,
    maxMonths: 12,
  });
  assert.equal(r.body.percentDefault, 18);
  assert.equal(r.body.recurringPercentDefault, 6);

  const lido = await affiliateService.getSettings();
  assert.equal(Number(lido.percentDefault), 18);
  assert.equal(Number(lido.recurringPercentDefault), 6);
});
