// Saldo de comissao do afiliado: mesmo risco do motor de credito (cobrar/pagar
// duas vezes, deixar saldo negativo). reserveForWithdrawal usa o mesmo padrao
// CTE + FOR UPDATE de clientCreditsRepository.reserve - este arquivo prova que
// ele se comporta igual sob concorrencia.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const repo = require('../../src/repositories/affiliatesRepository');
const pool = require('../../src/db/pool');
const { createClient, closePool } = require('../helpers/db');

test.after(() => closePool());

async function credit(userId, cents) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await repo.credit(client, userId, cents);
    await client.query('COMMIT');
  } finally {
    client.release();
  }
}

test('credit soma no saldo disponivel e no total historico', async () => {
  const afiliado = await createClient();
  await repo.getOrCreate(afiliado.id);
  await credit(afiliado.id, 1000);
  await credit(afiliado.id, 500);

  const linha = await repo.getOrCreate(afiliado.id);
  assert.equal(linha.balance_available_cents, 1500);
  assert.equal(linha.total_earned_cents, 1500);
});

test('reserveForWithdrawal recusa (sem debitar nada) quando o saldo nao basta', async () => {
  const afiliado = await createClient();
  await credit(afiliado.id, 100);

  const resultado = await repo.reserveForWithdrawal(afiliado.id, 200);
  assert.equal(resultado, null);

  const linha = await repo.getOrCreate(afiliado.id);
  assert.equal(linha.balance_available_cents, 100, 'saldo tem que continuar intacto numa recusa');
  assert.equal(linha.balance_reserved_cents, 0);
});

test('reserveForWithdrawal nunca reserva mais que o saldo disponivel, mesmo com 10 pedidos ao mesmo tempo', async () => {
  // Mesmo teste de concorrencia do clientCreditsRepository: 10 pedidos de
  // saque de 300 centavos contra um saldo de 1000. So 3 podem passar (900);
  // se o UPDATE atomico quebrar, mais de 3 passam e o saldo fica negativo.
  const afiliado = await createClient();
  await credit(afiliado.id, 1000);

  const tentativas = await Promise.all(
    Array.from({ length: 10 }, () => repo.reserveForWithdrawal(afiliado.id, 300))
  );

  const aprovadas = tentativas.filter(Boolean).length;
  assert.equal(aprovadas, 3, `so 3 de 10 deveriam passar, passaram ${aprovadas}`);

  const linha = await repo.getOrCreate(afiliado.id);
  assert.equal(linha.balance_available_cents, 100);
  assert.equal(linha.balance_reserved_cents, 900);
  assert.ok(linha.balance_available_cents >= 0, 'saldo disponivel nunca pode ficar negativo');
});

test('releaseReserved devolve o valor pro saldo disponivel (saque recusado)', async () => {
  const afiliado = await createClient();
  await credit(afiliado.id, 1000);
  await repo.reserveForWithdrawal(afiliado.id, 400);

  await repo.releaseReserved(afiliado.id, 400);

  const linha = await repo.getOrCreate(afiliado.id);
  assert.equal(linha.balance_available_cents, 1000);
  assert.equal(linha.balance_reserved_cents, 0);
});

test('confirmWithdrawn so zera o reservado - o dinheiro ja saiu, nao volta pro disponivel', async () => {
  const afiliado = await createClient();
  await credit(afiliado.id, 1000);
  await repo.reserveForWithdrawal(afiliado.id, 400);

  await repo.confirmWithdrawn(afiliado.id, 400);

  const linha = await repo.getOrCreate(afiliado.id);
  assert.equal(linha.balance_available_cents, 600, 'os 400 sacados nao podem voltar');
  assert.equal(linha.balance_reserved_cents, 0);
  assert.equal(linha.total_earned_cents, 1000, 'total historico nunca diminui');
});
