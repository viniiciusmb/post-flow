// Extrato de pagamentos.
//
// O extrato existe porque nenhuma fonte sozinha responde a pergunta do
// cliente ("o que foi cobrado, quando, e em qual cartão"):
//   - a Stripe sabe o cartão e o valor, mas não sabe se aquilo foi crédito
//     avulso, excedente ou mensalidade;
//   - o nosso banco sabe o que foi comprado, mas não sabe qual cartão pagou
//     (dado de cartão não é copiado pra cá de propósito).
// montarExtrato é o cruzamento das duas. Rotular errado aqui é mostrar pro
// cliente que ele pagou uma coisa quando pagou outra.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { montarExtrato } = require('../../src/web/controllers/api/clientBillingApiController');

const CARTAO = { brand: 'visa', last4: '3279' };

function charge(over = {}) {
  return {
    id: 'ch_1',
    createdAt: '2026-08-14T19:08:59.000Z',
    amountCents: 625,
    amountRefundedCents: 0,
    paid: true,
    status: 'succeeded',
    invoiceId: null,
    paymentIntentId: null,
    receiptUrl: 'https://pay.stripe.com/receipts/x',
    card: CARTAO,
    ...over,
  };
}

test('crédito avulso é reconhecido pelo payment_intent e traz os minutos', () => {
  const [linha] = montarExtrato(
    [charge({ paymentIntentId: 'pi_abc' })],
    [{ stripe_payment_intent_id: 'pi_abc', minutes: 25 }],
    []
  );
  assert.equal(linha.kind, 'avulso');
  assert.equal(linha.minutes, 25);
  assert.equal(linha.amountCents, 625);
  assert.deepEqual(linha.card, CARTAO);
});

test('excedente é reconhecido pela fatura, somando os minutos de todos os vídeos', () => {
  const [linha] = montarExtrato(
    [charge({ invoiceId: 'in_xyz', amountCents: 1500 })],
    [],
    [{ stripe_invoice_id: 'in_xyz', minutes: 60, amount_cents: 1500, videos: 3 }]
  );
  assert.equal(linha.kind, 'excedente');
  assert.equal(linha.minutes, 60);
});

test('fatura que não é de excedente só pode ser mensalidade', () => {
  const [linha] = montarExtrato([charge({ invoiceId: 'in_assinatura', amountCents: 9990 })], [], []);
  assert.equal(linha.kind, 'plano');
  assert.equal(linha.minutes, null);
});

test('cobrança sem fatura e sem compra nossa não é chutada como plano', () => {
  // Se um dia entrar uma cobrança feita fora do sistema (o admin cobrando algo
  // pelo painel da Stripe, por exemplo), ela aparece como "Cobrança" em vez de
  // mentir dizendo que foi mensalidade.
  const [linha] = montarExtrato([charge({ paymentIntentId: 'pi_desconhecido' })], [], []);
  assert.equal(linha.kind, 'outro');
});

test('cobrança recusada aparece como falhou, não como paga', () => {
  const [linha] = montarExtrato([charge({ paid: false, status: 'failed' })], [], []);
  assert.equal(linha.status, 'falhou');
});

test('reembolso total aparece como reembolsado', () => {
  const [linha] = montarExtrato([charge({ amountRefundedCents: 625 })], [], []);
  assert.equal(linha.status, 'reembolsado');
  assert.equal(linha.refundedCents, 625);
});

test('reembolso PARCIAL continua pago, mas mostra quanto voltou', () => {
  // O extrato tem que bater com a fatura do cartão do cliente: dizer só o
  // valor original, escondendo a devolução, faria os dois divergirem.
  const [linha] = montarExtrato([charge({ amountCents: 1000, amountRefundedCents: 300 })], [], []);
  assert.equal(linha.status, 'pago');
  assert.equal(linha.amountCents, 1000);
  assert.equal(linha.refundedCents, 300);
});

test('compra nossa sem payment_intent (checkout abandonado) não rouba o rótulo de outra cobrança', () => {
  // Compra que nunca foi paga fica sem payment_intent no banco. Se ela entrasse
  // no cruzamento com chave undefined, casaria com qualquer charge que também
  // não tem payment_intent - e uma mensalidade viraria "crédito avulso".
  const [linha] = montarExtrato(
    [charge({ invoiceId: 'in_mensalidade', paymentIntentId: null, amountCents: 9990 })],
    [{ stripe_payment_intent_id: null, minutes: 300 }],
    []
  );
  assert.equal(linha.kind, 'plano');
  assert.equal(linha.minutes, null);
});

test('o extrato preserva a ordem que a Stripe devolve (mais recente primeiro)', () => {
  const linhas = montarExtrato(
    [
      charge({ id: 'ch_novo', createdAt: '2026-08-14T00:00:00.000Z' }),
      charge({ id: 'ch_velho', createdAt: '2026-08-01T00:00:00.000Z' }),
    ],
    [],
    []
  );
  assert.deepEqual(linhas.map((l) => l.id), ['ch_novo', 'ch_velho']);
});
