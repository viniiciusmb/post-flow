// Compra de crédito avulso.
//
// A tela manda os minutos escolhidos numa barra, mas a rota é HTTP: dá pra
// mandar qualquer coisa nela. Como esse número multiplica DIRETO o valor
// cobrado no cartão e os minutos creditados, um valor esquisito passando reto
// vira ou cobrança errada ou crédito de graça. Os casos abaixo são exatamente
// os que a barra nunca produziria - e por isso são os que importam.
//
// O outro teste que importa aqui é o de preço: comprar adiantado tem que custar
// o MESMO que estourar a cota. Se um dia alguém mexer numa das duas taxas sem
// mexer na outra, o teste quebra antes de virar cobrança errada em produção.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  minutosPedidos,
  centsPorMinutoAvulso,
  CREDITO_MIN_MINUTOS,
  CREDITO_PASSO_MINUTOS,
  CREDITO_MAX_MINUTOS,
} = require('../../src/web/controllers/api/clientBillingApiController');
const creditsService = require('../../src/services/creditsService');

test('o crédito avulso custa exatamente a taxa de excedente pela nossa internet', () => {
  assert.equal(centsPorMinutoAvulso(), creditsService.OVERAGE_RATE_CENTS_PER_MIN.normal);
});

test('os valores da barra dão os preços combinados', () => {
  const preco = (min) => min * centsPorMinutoAvulso();
  assert.equal(preco(25), 625); // R$ 6,25 - o menor da barra
  assert.equal(preco(50), 1250); // R$ 12,50
  assert.equal(preco(100), 2500); // R$ 25,00
});

test('o valor que a barra produz passa igual', () => {
  assert.equal(minutosPedidos(CREDITO_MIN_MINUTOS), CREDITO_MIN_MINUTOS);
  assert.equal(minutosPedidos(100), 100);
  assert.equal(minutosPedidos(CREDITO_MAX_MINUTOS), CREDITO_MAX_MINUTOS);
});

test('zero e negativo viram o mínimo, nunca crédito de graça nem valor negativo', () => {
  assert.equal(minutosPedidos(0), CREDITO_MIN_MINUTOS);
  assert.equal(minutosPedidos(-500), CREDITO_MIN_MINUTOS);
});

test('número absurdo para no teto, em vez de virar uma fatura gigante', () => {
  assert.equal(minutosPedidos(999999), CREDITO_MAX_MINUTOS);
  // Infinito não é número tratável: cai no mínimo. Nos dois casos o erro cai
  // pro lado seguro (cobrar de menos), nunca pro de cobrar demais.
  assert.equal(minutosPedidos(Infinity), CREDITO_MIN_MINUTOS);
});

test('valor fora dos degraus é encaixado no passo da barra', () => {
  // 37 não existe na barra: vira 25. Sem isso, o cliente veria "50 min" na tela
  // e receberia 37 - ou pagaria por um valor que a tela nunca mostrou.
  assert.equal(minutosPedidos(37), 25);
  assert.equal(minutosPedidos(63), 75);
  assert.equal(minutosPedidos(112.4), 100);
  assert.equal(minutosPedidos(1) % CREDITO_PASSO_MINUTOS, 0);
});

test('texto, vazio e ausente caem no mínimo da barra', () => {
  for (const entrada of ['abc', '', null, undefined, NaN, {}]) {
    assert.equal(minutosPedidos(entrada), CREDITO_MIN_MINUTOS);
  }
});

test('número em texto funciona (o JSON do navegador pode mandar assim)', () => {
  assert.equal(minutosPedidos('150'), 150);
});
