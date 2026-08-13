// recordCommissionForInvoice roda dentro do webhook da Stripe (invoice.paid) -
// cada bug aqui ou paga comissao errada (dinheiro saindo do bolso do dono) ou
// deixa de pagar um afiliado de verdade. Testado direto contra a funcao, sem
// mock de Stripe: o objeto de fatura que ela le e so {id, customer,
// subscription, amount_paid}, entao um objeto de mentira já prova o
// comportamento.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const affiliateService = require('../../src/services/affiliateService');
const affiliateLinksRepository = require('../../src/repositories/affiliateLinksRepository');
const affiliatesRepository = require('../../src/repositories/affiliatesRepository');
const referralsRepository = require('../../src/repositories/referralsRepository');
const commissionEntriesRepository = require('../../src/repositories/commissionEntriesRepository');
const clientSubscriptionsRepository = require('../../src/repositories/clientSubscriptionsRepository');
const settingsRepository = require('../../src/repositories/settingsRepository');
const pool = require('../../src/db/pool');
const { createClient, closePool } = require('../helpers/db');

test.after(() => closePool());

let contador = 0;
async function criarAdmin() {
  contador += 1;
  const { rows } = await pool.query(
    `INSERT INTO users (email, password_hash, role, business_name) VALUES ($1, 'hash', 'admin', 'Dono') RETURNING *`,
    [`admin-com-${contador}-${Date.now()}@teste.local`]
  );
  return rows[0];
}

// Monta um afiliado com 1 indicado ja vinculado (referral), com assinatura
// Stripe apontando pro customerId dado - exatamente o estado que existe
// quando um webhook invoice.paid chega de verdade.
async function montarIndicacao(referenteId, customerId) {
  const link = await affiliateLinksRepository.getOrCreateDefault(referenteId);
  const indicado = await createClient();
  await clientSubscriptionsRepository.setStripeCustomer(indicado.id, customerId);
  await referralsRepository.create({ referredUserId: indicado.id, affiliateLinkId: link.id, referrerUserId: referenteId });
  return indicado;
}

function fakeInvoice({ id, customer, subscription = 'sub_123', amountPaid = 10000 }) {
  return { id, customer, subscription, amount_paid: amountPaid };
}

test('comissao usa o percentual padrao quando o afiliado nao tem override', async () => {
  await settingsRepository.setValue('affiliate_commission_percent_default', 10);
  const referente = await createClient();
  const customerId = `cus_padrao_${Date.now()}`;
  await montarIndicacao(referente.id, customerId);

  const resultado = await affiliateService.recordCommissionForInvoice(
    fakeInvoice({ id: `inv_padrao_${Date.now()}`, customer: customerId, amountPaid: 10000 })
  );

  assert.equal(resultado.credited, 1000, '10% de R$100,00 = R$10,00 (1000 centavos)');
  const afiliado = await affiliatesRepository.getOrCreate(referente.id);
  assert.equal(afiliado.balance_available_cents, 1000);
});

test('override individual do afiliado tem prioridade sobre o percentual padrao', async () => {
  await settingsRepository.setValue('affiliate_commission_percent_default', 10);
  const referente = await createClient();
  await affiliatesRepository.setPercentOverride(referente.id, 25);
  const customerId = `cus_override_${Date.now()}`;
  await montarIndicacao(referente.id, customerId);

  const resultado = await affiliateService.recordCommissionForInvoice(
    fakeInvoice({ id: `inv_override_${Date.now()}`, customer: customerId, amountPaid: 10000 })
  );

  assert.equal(resultado.credited, 2500, '25% de override, nao os 10% padrao');
});

test('a mesma fatura processada duas vezes (reenvio de webhook) nunca credita duas vezes', async () => {
  const referente = await createClient();
  const customerId = `cus_idem_${Date.now()}`;
  await montarIndicacao(referente.id, customerId);
  const invoiceId = `inv_idem_${Date.now()}`;

  const primeira = await affiliateService.recordCommissionForInvoice(
    fakeInvoice({ id: invoiceId, customer: customerId, amountPaid: 5000 })
  );
  const segunda = await affiliateService.recordCommissionForInvoice(
    fakeInvoice({ id: invoiceId, customer: customerId, amountPaid: 5000 })
  );

  assert.ok(primeira.credited > 0);
  assert.equal(segunda.skipped, 'jaProcessada');

  const afiliado = await affiliatesRepository.getOrCreate(referente.id);
  assert.equal(afiliado.balance_available_cents, primeira.credited, 'so pode ter sido creditado uma vez');
});

test('teto de meses bloqueia comissao nova depois do numero configurado de faturas', async () => {
  await settingsRepository.setValue('affiliate_commission_max_months', 2);
  const referente = await createClient();
  const customerId = `cus_teto_${Date.now()}`;
  await montarIndicacao(referente.id, customerId);

  const r1 = await affiliateService.recordCommissionForInvoice(
    fakeInvoice({ id: `inv_teto_1_${Date.now()}`, customer: customerId, amountPaid: 1000 })
  );
  const r2 = await affiliateService.recordCommissionForInvoice(
    fakeInvoice({ id: `inv_teto_2_${Date.now()}`, customer: customerId, amountPaid: 1000 })
  );
  const r3 = await affiliateService.recordCommissionForInvoice(
    fakeInvoice({ id: `inv_teto_3_${Date.now()}`, customer: customerId, amountPaid: 1000 })
  );

  assert.ok(r1.credited > 0, '1a mensalidade gera comissao');
  assert.ok(r2.credited > 0, '2a mensalidade gera comissao');
  assert.equal(r3.skipped, 'tetoDeMesesAtingido', '3a mensalidade nao gera mais, teto e 2');

  await settingsRepository.setValue('affiliate_commission_max_months', 6); // devolve o padrao pros proximos testes
});

test('admin nao ganha comissao sobre os proprios links de campanha', async () => {
  const admin = await criarAdmin();
  const customerId = `cus_admin_${Date.now()}`;
  await montarIndicacao(admin.id, customerId);

  const resultado = await affiliateService.recordCommissionForInvoice(
    fakeInvoice({ id: `inv_admin_${Date.now()}`, customer: customerId, amountPaid: 10000 })
  );

  assert.equal(resultado.skipped, 'donoDoLinkEhAdmin');
});

test('fatura sem assinatura (avulso/excedente) nunca gera comissao', async () => {
  const referente = await createClient();
  const customerId = `cus_avulso_${Date.now()}`;
  await montarIndicacao(referente.id, customerId);

  const resultado = await affiliateService.recordCommissionForInvoice(
    fakeInvoice({ id: `inv_avulso_${Date.now()}`, customer: customerId, subscription: null, amountPaid: 10000 })
  );

  assert.equal(resultado.skipped, 'naoEhMensalidade');
});

test('cliente sem nenhuma indicacao nao gera comissao nem quebra o webhook', async () => {
  const semIndicacao = await createClient();
  const customerId = `cus_sem_ind_${Date.now()}`;
  await clientSubscriptionsRepository.setStripeCustomer(semIndicacao.id, customerId);

  const resultado = await affiliateService.recordCommissionForInvoice(
    fakeInvoice({ id: `inv_sem_ind_${Date.now()}`, customer: customerId, amountPaid: 10000 })
  );

  assert.equal(resultado.skipped, 'semIndicacao');
});

test('countByReferredUser conta certo (base do teto de meses)', async () => {
  const referente = await createClient();
  const customerId = `cus_contagem_${Date.now()}`;
  const indicado = await montarIndicacao(referente.id, customerId);

  await affiliateService.recordCommissionForInvoice(
    fakeInvoice({ id: `inv_contagem_1_${Date.now()}`, customer: customerId, amountPaid: 1000 })
  );

  const n = await commissionEntriesRepository.countByReferredUser(indicado.id);
  assert.equal(n, 1);
});
