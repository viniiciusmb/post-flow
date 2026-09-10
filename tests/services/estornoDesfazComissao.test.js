// Pagamento estornado ou contestado no cartão tem que desfazer o que liberou.
//
// Sem isto o prejuízo era DOBRADO no mesmo evento: o dinheiro voltava para o
// cliente e a comissão do afiliado continuava creditada e sacável. E era o
// tipo de buraco que ninguém vê olhando a tela - os números continuam
// plausíveis, só estão errados a favor de quem recebeu.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const affiliateService = require('../../src/services/affiliateService');
const affiliateLinksRepository = require('../../src/repositories/affiliateLinksRepository');
const affiliatesRepository = require('../../src/repositories/affiliatesRepository');
const referralsRepository = require('../../src/repositories/referralsRepository');
const commissionEntriesRepository = require('../../src/repositories/commissionEntriesRepository');
const affiliateWithdrawalsRepository = require('../../src/repositories/affiliateWithdrawalsRepository');
const settingsRepository = require('../../src/repositories/settingsRepository');
const afiliadoDashboardService = require('../../src/services/afiliadoDashboardService');
const pool = require('../../src/db/pool');
const { createClient, closePool } = require('../helpers/db');

test.after(() => closePool());

let n = 0;
function idPagamento() {
  n += 1;
  return `pay_est_${process.pid}_${n}_${Date.now()}`;
}

async function cenario({ primeira = 20, recorrencia = 5 } = {}) {
  await settingsRepository.setValue('affiliate_commission_percent_default', primeira);
  await settingsRepository.setValue('affiliate_commission_recurring_percent_default', recorrencia);
  await settingsRepository.setValue('affiliate_commission_max_months', 12);
  const afiliado = await createClient();
  const link = await affiliateLinksRepository.getOrCreateDefault(afiliado.id);
  const indicado = await createClient();
  await referralsRepository.create({
    referredUserId: indicado.id,
    affiliateLinkId: link.id,
    referrerUserId: afiliado.id,
  });
  return { afiliado, indicado };
}

function pagar(clientUserId, externalPaymentId, amountPaidCents = 10000) {
  return affiliateService.recordCommissionForPayment({
    clientUserId,
    provider: 'asaas',
    externalPaymentId,
    amountPaidCents,
  });
}

async function saldo(userId) {
  const a = await affiliatesRepository.getOrCreate(userId);
  return { disponivel: a.balance_available_cents, ganho: a.total_earned_cents };
}

test('estorno tira do saldo do afiliado a comissao daquele pagamento', async () => {
  const { afiliado, indicado } = await cenario();
  const pagamento = idPagamento();
  await pagar(indicado.id, pagamento);
  assert.deepEqual(await saldo(afiliado.id), { disponivel: 2000, ganho: 2000 });

  const r = await affiliateService.reverseCommissionForPayment({ externalPaymentId: pagamento, motivo: 'estorno' });

  assert.equal(r.reversed, 2000);
  assert.deepEqual(await saldo(afiliado.id), { disponivel: 0, ganho: 0 });
});

test('so a comissao ESTORNADA sai - as outras do mesmo afiliado ficam', async () => {
  const { afiliado, indicado } = await cenario({ primeira: 20, recorrencia: 5 });
  const primeiro = idPagamento();
  await pagar(indicado.id, primeiro); // 2000
  await pagar(indicado.id, idPagamento()); // 500
  await pagar(indicado.id, idPagamento()); // 500

  await affiliateService.reverseCommissionForPayment({ externalPaymentId: primeiro, motivo: 'estorno' });

  assert.deepEqual(await saldo(afiliado.id), { disponivel: 1000, ganho: 1000 });
});

test('aviso de estorno repetido nao debita duas vezes', async () => {
  // O Asaas entrega "pelo menos uma vez" - receber o mesmo evento duas vezes é
  // o normal, não a exceção.
  const { afiliado, indicado } = await cenario();
  const pagamento = idPagamento();
  await pagar(indicado.id, pagamento);

  const primeira = await affiliateService.reverseCommissionForPayment({ externalPaymentId: pagamento, motivo: 'estorno' });
  const segunda = await affiliateService.reverseCommissionForPayment({ externalPaymentId: pagamento, motivo: 'estorno' });

  assert.equal(primeira.reversed, 2000);
  assert.equal(segunda.skipped, 'semComissaoAtiva');
  assert.deepEqual(await saldo(afiliado.id), { disponivel: 0, ganho: 0 });
});

test('dois avisos de estorno ao mesmo tempo tambem debitam uma vez so', async () => {
  const { afiliado, indicado } = await cenario();
  const pagamento = idPagamento();
  await pagar(indicado.id, pagamento);

  await Promise.all([
    affiliateService.reverseCommissionForPayment({ externalPaymentId: pagamento, motivo: 'estorno' }),
    affiliateService.reverseCommissionForPayment({ externalPaymentId: pagamento, motivo: 'estorno' }),
  ]);

  assert.deepEqual(await saldo(afiliado.id), { disponivel: 0, ganho: 0 });
});

test('se o afiliado JA SACOU, o saldo fica negativo e ele nao consegue sacar de novo', async () => {
  // A alternativa seria engolir o prejuízo - e quem sacasse rápido nunca
  // devolveria nada. Saldo negativo é dívida que as próximas comissões quitam.
  const { afiliado, indicado } = await cenario();
  const pagamento = idPagamento();
  await pagar(indicado.id, pagamento, 100000); // 20% = 20000

  await settingsRepository.setValue('affiliate_min_withdraw_cents', 1000);
  await affiliatesRepository.setPixKey(afiliado.id, { pixKey: 'x@y.com', pixKeyType: 'email' });
  const reservado = await affiliatesRepository.reserveForWithdrawal(afiliado.id, 20000);
  assert.ok(reservado, 'o saque foi reservado antes do estorno');
  await affiliateWithdrawalsRepository.create({
    affiliateUserId: afiliado.id,
    amountCents: 20000,
    pixKey: 'x@y.com',
    pixKeyType: 'email',
  });

  await affiliateService.reverseCommissionForPayment({ externalPaymentId: pagamento, motivo: 'estorno' });

  const s = await saldo(afiliado.id);
  assert.equal(s.disponivel, -20000, 'a divida fica registrada');
  assert.equal(await affiliatesRepository.reserveForWithdrawal(afiliado.id, 1), null, 'com divida, nao saca');
});

test('comissao nova quita a divida de um estorno anterior', async () => {
  const { afiliado, indicado } = await cenario({ primeira: 20, recorrencia: 5 });
  const pagamento = idPagamento();
  await pagar(indicado.id, pagamento, 100000); // +20000
  await affiliatesRepository.reserveForWithdrawal(afiliado.id, 20000); // sacou tudo
  await affiliateService.reverseCommissionForPayment({ externalPaymentId: pagamento, motivo: 'estorno' });
  assert.equal((await saldo(afiliado.id)).disponivel, -20000);

  await pagar(indicado.id, idPagamento(), 100000); // recorrencia 5% = +5000

  assert.equal((await saldo(afiliado.id)).disponivel, -15000, 'a comissao nova abate a divida');
});

test('contestacao ganha devolve a comissao', async () => {
  const { afiliado, indicado } = await cenario();
  const pagamento = idPagamento();
  await pagar(indicado.id, pagamento);
  await affiliateService.reverseCommissionForPayment({ externalPaymentId: pagamento, motivo: 'contestacao' });
  assert.deepEqual(await saldo(afiliado.id), { disponivel: 0, ganho: 0 });

  const r = await affiliateService.restoreCommissionForPayment({ externalPaymentId: pagamento });

  assert.equal(r.restored, 2000);
  assert.deepEqual(await saldo(afiliado.id), { disponivel: 2000, ganho: 2000 });
  // E restaurar duas vezes também não credita em dobro.
  await affiliateService.restoreCommissionForPayment({ externalPaymentId: pagamento });
  assert.deepEqual(await saldo(afiliado.id), { disponivel: 2000, ganho: 2000 });
});

test('estorno da PRIMEIRA venda nao faz a proxima mensalidade virar primeira venda de novo', async () => {
  // Senão estornar viraria uma forma de ganhar o percentual de entrada duas
  // vezes pelo mesmo cliente.
  const { indicado } = await cenario({ primeira: 20, recorrencia: 5 });
  const primeiro = idPagamento();
  await pagar(indicado.id, primeiro);
  await affiliateService.reverseCommissionForPayment({ externalPaymentId: primeiro, motivo: 'estorno' });

  const proximo = await pagar(indicado.id, idPagamento());

  assert.equal(proximo.kind, 'recorrencia');
  assert.equal(proximo.credited, 500);
});

test('comissao estornada some dos totais do painel mas continua no extrato, marcada', async () => {
  const { afiliado, indicado } = await cenario();
  const pagamento = idPagamento();
  await pagar(indicado.id, pagamento);
  await affiliateService.reverseCommissionForPayment({ externalPaymentId: pagamento, motivo: 'estorno' });

  const painel = await afiliadoDashboardService.montar({
    userId: afiliado.id,
    since: null,
    until: null,
    rangeKey: 'all',
  });

  assert.equal(painel.sales.commissionCents, 0, 'nao entra mais no total de vendas');
  assert.equal(painel.periodTotalCents, 0);
  assert.equal(painel.balance.totalEarnedCents, 0);
  const lancamento = painel.recentCommissions.find((c) => c.reversedAt);
  assert.ok(lancamento, 'o extrato continua mostrando o lancamento, marcado como estornado');
  assert.equal(lancamento.commissionCents, 2000, 'com o valor original, pra pessoa entender o que saiu');
});

test('a comissao de OUTRO pagamento nunca e afetada por engano', async () => {
  const a = await cenario();
  const b = await cenario();
  const pagamentoA = idPagamento();
  const pagamentoB = idPagamento();
  await pagar(a.indicado.id, pagamentoA);
  await pagar(b.indicado.id, pagamentoB);

  await affiliateService.reverseCommissionForPayment({ externalPaymentId: pagamentoA, motivo: 'estorno' });

  assert.equal((await saldo(a.afiliado.id)).disponivel, 0);
  assert.equal((await saldo(b.afiliado.id)).disponivel, 2000);
});

test('pagamento sem afiliado por tras nao quebra o estorno', async () => {
  const r = await affiliateService.reverseCommissionForPayment({
    externalPaymentId: idPagamento(),
    motivo: 'estorno',
  });
  assert.equal(r.skipped, 'semComissaoAtiva');
});
