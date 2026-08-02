// Motor de credito: a parte do sistema onde um bug custa dinheiro de verdade
// (cobrar duas vezes, deixar processar de graca, ou deixar o saldo negativo).
'use strict';

const test = require('node:test');
const assert = require('node:assert');

const repo = require('../../src/repositories/clientCreditsRepository');
const { createClient, giveCredits, readCredits, closePool } = require('../helpers/db');

test.after(() => closePool());

test('reserve debita da cota primeiro e so entao do avulso', async () => {
  const cliente = await createClient();
  await giveCredits(cliente.id, { quotaNormal: 10, extraNormal: 5 });

  const resultado = await repo.reserve(cliente.id, 'normal', 12);

  assert.ok(resultado, 'deveria ter reservado: 10 de cota + 5 de avulso cobrem 12 minutos');
  assert.strictEqual(Number(resultado.minutesFromQuota), 10, 'consome a cota inteira primeiro');
  assert.strictEqual(Number(resultado.minutesFromExtra), 2, 'o resto sai do avulso');

  const saldo = await readCredits(cliente.id);
  assert.strictEqual(Number(saldo.used_normal), 10);
  assert.strictEqual(Number(saldo.extra_normal), 3, 'sobraram 3 minutos de avulso');
});

test('reserve recusa (e nao debita nada) quando o saldo nao basta', async () => {
  const cliente = await createClient();
  await giveCredits(cliente.id, { quotaNormal: 5, extraNormal: 2 });

  const resultado = await repo.reserve(cliente.id, 'normal', 10);

  assert.strictEqual(resultado, null, 'sem saldo suficiente, nao reserva');
  const saldo = await readCredits(cliente.id);
  assert.strictEqual(Number(saldo.used_normal), 0, 'nada pode ter sido debitado numa recusa');
  assert.strictEqual(Number(saldo.extra_normal), 2, 'o avulso tem que continuar intacto');
});

test('reserve nunca deixa o saldo negativo, mesmo com 10 chamadas ao mesmo tempo', async () => {
  // Este e o teste de concorrencia: 10 pedidos de 3 minutos contra um saldo de
  // 10 minutos. So 3 podem passar (9 minutos); o decimo minuto nao da pra
  // ninguem. Se o UPDATE atomico do reserve() quebrar um dia, aqui mais de 3
  // passam e o saldo fica negativo.
  const cliente = await createClient();
  await giveCredits(cliente.id, { quotaNormal: 10 });

  const tentativas = await Promise.all(
    Array.from({ length: 10 }, () => repo.reserve(cliente.id, 'normal', 3))
  );

  const aprovadas = tentativas.filter(Boolean).length;
  assert.strictEqual(aprovadas, 3, `so 3 de 10 deveriam passar, passaram ${aprovadas}`);

  const saldo = await readCredits(cliente.id);
  assert.strictEqual(Number(saldo.used_normal), 9);
  assert.ok(Number(saldo.extra_normal) >= 0, 'o avulso nunca pode ficar negativo');
  assert.ok(
    Number(saldo.used_normal) <= Number(saldo.quota_normal),
    'nunca pode usar mais do que a cota disponivel'
  );
});

test('release devolve exatamente o que foi tirado de cada parte do bolso', async () => {
  const cliente = await createClient();
  await giveCredits(cliente.id, { quotaNormal: 10, extraNormal: 5 });

  const reservado = await repo.reserve(cliente.id, 'normal', 12);
  await repo.release(cliente.id, 'normal', reservado);

  const saldo = await readCredits(cliente.id);
  assert.strictEqual(Number(saldo.used_normal), 0, 'a cota tem que voltar ao que era');
  assert.strictEqual(Number(saldo.extra_normal), 5, 'o avulso tem que voltar ao que era');
});

test('os bolsos normal e bonus sao independentes', async () => {
  const cliente = await createClient();
  await giveCredits(cliente.id, { quotaNormal: 10, quotaBonus: 20 });

  await repo.reserve(cliente.id, 'bonus', 15);

  const saldo = await readCredits(cliente.id);
  assert.strictEqual(Number(saldo.used_bonus), 15);
  assert.strictEqual(Number(saldo.used_normal), 0, 'gastar bonus nao pode tocar no bolso normal');
});

test('addExtra soma avulso sem mexer na cota nem no que ja foi usado', async () => {
  const cliente = await createClient();
  await giveCredits(cliente.id, { quotaNormal: 10, extraNormal: 1 });
  await repo.reserve(cliente.id, 'normal', 4);

  await repo.addExtra(cliente.id, 'normal', 30);

  const saldo = await readCredits(cliente.id);
  assert.strictEqual(Number(saldo.extra_normal), 31);
  assert.strictEqual(Number(saldo.used_normal), 4, 'comprar avulso nao pode zerar o que ja foi gasto');
  assert.strictEqual(Number(saldo.quota_normal), 10);
});

test('bolso invalido explode em vez de escrever numa coluna errada', async () => {
  const cliente = await createClient();
  await giveCredits(cliente.id, { quotaNormal: 10 });
  // columnsFor() monta nome de coluna por interpolacao de string - se um valor
  // desconhecido passasse por ali, viraria SQL invalido (ou pior).
  await assert.rejects(() => repo.reserve(cliente.id, 'inventado', 1), /Bolso de credito invalido/);
});
