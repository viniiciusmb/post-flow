// A comissão passou a ter DOIS percentuais: um para a assinatura nova
// ("primeira") e outro para as mensalidades seguintes do mesmo indicado
// ("recorrencia"). Cada erro aqui paga a mais (dinheiro do dono) ou a menos
// (dinheiro do afiliado), e nos dois casos ninguém percebe olhando a tela -
// os números continuam parecendo plausíveis.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const affiliateService = require('../../src/services/affiliateService');
const affiliateLinksRepository = require('../../src/repositories/affiliateLinksRepository');
const affiliatesRepository = require('../../src/repositories/affiliatesRepository');
const referralsRepository = require('../../src/repositories/referralsRepository');
const commissionEntriesRepository = require('../../src/repositories/commissionEntriesRepository');
const settingsRepository = require('../../src/repositories/settingsRepository');
const pool = require('../../src/db/pool');
const { createClient, closePool } = require('../helpers/db');

test.after(() => closePool());

let n = 0;
function idUnico(prefixo) {
  n += 1;
  return `${prefixo}_${process.pid}_${n}_${Date.now()}`;
}

async function montarIndicacao(referenteId) {
  const link = await affiliateLinksRepository.getOrCreateDefault(referenteId);
  const indicado = await createClient();
  await referralsRepository.create({
    referredUserId: indicado.id,
    affiliateLinkId: link.id,
    referrerUserId: referenteId,
  });
  return indicado;
}

function pagar(clientUserId, amountPaidCents) {
  return affiliateService.recordCommissionForPayment({
    clientUserId,
    provider: 'asaas',
    externalPaymentId: idUnico('pay'),
    amountPaidCents,
  });
}

async function padroes({ primeira, recorrencia, maxMonths = 12 }) {
  await settingsRepository.setValue('affiliate_commission_percent_default', primeira);
  await settingsRepository.setValue('affiliate_commission_recurring_percent_default', recorrencia);
  await settingsRepository.setValue('affiliate_commission_max_months', maxMonths);
}

test('a primeira mensalidade paga usa o percentual de venda nova; as seguintes usam o de recorrencia', async () => {
  await padroes({ primeira: 20, recorrencia: 5 });
  const referente = await createClient();
  const indicado = await montarIndicacao(referente.id);

  const venda = await pagar(indicado.id, 10000);
  const mes2 = await pagar(indicado.id, 10000);
  const mes3 = await pagar(indicado.id, 10000);

  assert.equal(venda.kind, 'primeira');
  assert.equal(venda.credited, 2000, '20% de R$100 na venda nova');
  assert.equal(mes2.kind, 'recorrencia');
  assert.equal(mes2.credited, 500, '5% de R$100 na recorrencia');
  assert.equal(mes3.credited, 500);

  const afiliado = await affiliatesRepository.getOrCreate(referente.id);
  assert.equal(afiliado.balance_available_cents, 3000, 'saldo = 2000 + 500 + 500');
});

test('override individual vale por tipo: 20% na primeira e 5% na recorrencia so pra esse afiliado', async () => {
  await padroes({ primeira: 10, recorrencia: 10 });
  const referente = await createClient();
  await affiliatesRepository.setPercentOverride(referente.id, 20);
  await affiliatesRepository.setRecurringPercentOverride(referente.id, 5);
  const indicado = await montarIndicacao(referente.id);

  assert.equal((await pagar(indicado.id, 10000)).credited, 2000);
  assert.equal((await pagar(indicado.id, 10000)).credited, 500);
});

test('override so da primeira venda NAO arrasta a recorrencia junto - ela continua no padrao global', async () => {
  // É a combinação que mais engana quem configura: mexer num campo e achar que
  // mexeu nos dois. A tela mostra o padrão no campo vazio justamente por isso.
  await padroes({ primeira: 10, recorrencia: 3 });
  const referente = await createClient();
  await affiliatesRepository.setPercentOverride(referente.id, 40);
  const indicado = await montarIndicacao(referente.id);

  assert.equal((await pagar(indicado.id, 10000)).credited, 4000, '40% individual na venda nova');
  assert.equal((await pagar(indicado.id, 10000)).credited, 300, '3% do PADRAO global na recorrencia');
});

test('sem percentual de recorrencia configurado em lugar nenhum, ele cai no da primeira venda (nunca em zero)', async () => {
  // Numa base onde o admin já tinha 15% configurado e a linha da recorrência
  // ainda não existe, cair numa constante daria um corte silencioso no que o
  // afiliado recebe.
  await pool.query(`DELETE FROM settings WHERE key = 'affiliate_commission_recurring_percent_default'`);
  await settingsRepository.setValue('affiliate_commission_percent_default', 15);
  const settings = await affiliateService.getSettings();
  assert.equal(Number(settings.recurringPercentDefault), 15);
});

test('o tipo do lancamento fica congelado no banco (nao e recalculado depois)', async () => {
  await padroes({ primeira: 30, recorrencia: 7 });
  const referente = await createClient();
  const indicado = await montarIndicacao(referente.id);
  await pagar(indicado.id, 20000);
  await pagar(indicado.id, 20000);

  const { rows } = await pool.query(
    'SELECT kind, commission_percent, commission_cents FROM commission_entries WHERE referred_user_id = $1 ORDER BY created_at, id',
    [indicado.id]
  );
  assert.deepEqual(rows.map((r) => r.kind), ['primeira', 'recorrencia']);
  assert.equal(rows[0].commission_cents, 6000);
  assert.equal(rows[1].commission_cents, 1400);
});

test('dois pagamentos do MESMO indicado ao mesmo tempo nunca geram duas primeiras vendas', async () => {
  // Sem o advisory lock por indicado, os dois leem "nenhuma comissao ainda" e
  // os dois nascem como venda nova - pagando o percentual de entrada duas
  // vezes pelo mesmo cliente.
  await padroes({ primeira: 50, recorrencia: 1 });
  const referente = await createClient();
  const indicado = await montarIndicacao(referente.id);

  await Promise.all([pagar(indicado.id, 10000), pagar(indicado.id, 10000)]);

  const { rows } = await pool.query(
    `SELECT count(*)::int AS n FROM commission_entries WHERE referred_user_id = $1 AND kind = 'primeira'`,
    [indicado.id]
  );
  assert.equal(rows[0].n, 1, 'exatamente uma primeira venda');
});

test('resumo do periodo separa venda nova de recorrencia sem misturar os dois', async () => {
  await padroes({ primeira: 10, recorrencia: 10 });
  const referente = await createClient();
  const a = await montarIndicacao(referente.id);
  const b = await montarIndicacao(referente.id);
  await pagar(a.id, 10000); // primeira
  await pagar(a.id, 10000); // recorrencia
  await pagar(a.id, 10000); // recorrencia
  await pagar(b.id, 20000); // primeira

  const resumo = await commissionEntriesRepository.summaryByAffiliate(referente.id, {});
  assert.equal(resumo.primeira.n, 2);
  assert.equal(resumo.primeira.commissionCents, 1000 + 2000);
  assert.equal(resumo.recorrencia.n, 2);
  assert.equal(resumo.recorrencia.commissionCents, 2000);
});
