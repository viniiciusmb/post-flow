// Quantidade de pacotes avulsos.
//
// A tela manda um número escolhido num seletor de + e -, mas a rota é HTTP: dá
// pra mandar qualquer coisa nela. Como esse número multiplica DIRETO o valor
// cobrado no cartão e os minutos creditados, um valor esquisito passando reto
// vira ou cobrança errada ou crédito de graça. Os casos abaixo são exatamente
// os que o navegador nunca mandaria - e por isso são os que importam.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  pacotesPedidos,
  MAX_PACOTES_POR_COMPRA,
} = require('../../src/web/controllers/api/clientBillingApiController');

test('o número normal do seletor passa igual', () => {
  assert.equal(pacotesPedidos(1), 1);
  assert.equal(pacotesPedidos(4), 4);
  assert.equal(pacotesPedidos(MAX_PACOTES_POR_COMPRA), MAX_PACOTES_POR_COMPRA);
});

test('zero e negativo viram 1, nunca crédito de graça nem valor negativo', () => {
  assert.equal(pacotesPedidos(0), 1);
  assert.equal(pacotesPedidos(-5), 1);
  assert.equal(pacotesPedidos(-0.5), 1);
});

test('número absurdo para no teto, em vez de virar uma fatura gigante', () => {
  assert.equal(pacotesPedidos(999999), MAX_PACOTES_POR_COMPRA);
  // Infinito não é número tratável: cai no padrão de 1 pacote. Nos dois casos o
  // erro cai pro lado seguro (cobrar de menos), nunca pro de cobrar demais.
  assert.equal(pacotesPedidos(Infinity), 1);
});

test('fração é truncada: não existe meio pacote', () => {
  assert.equal(pacotesPedidos(2.9), 2);
  assert.equal(pacotesPedidos(1.0001), 1);
});

test('texto, vazio e ausente caem no padrão de 1 pacote', () => {
  assert.equal(pacotesPedidos('abc'), 1);
  assert.equal(pacotesPedidos(''), 1);
  assert.equal(pacotesPedidos(null), 1);
  assert.equal(pacotesPedidos(undefined), 1);
  assert.equal(pacotesPedidos(NaN), 1);
  assert.equal(pacotesPedidos({}), 1);
});

test('número em texto funciona (o JSON do navegador pode mandar assim)', () => {
  assert.equal(pacotesPedidos('3'), 3);
});
