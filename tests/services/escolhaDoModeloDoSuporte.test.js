// Qual modelo a Flora usa em cada mensagem (06/10/2026).
//
// Pedido do fundador: economizar - pergunta simples nao vai pro modelo caro, e
// so sobe quando o cliente diz que nao resolveu.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { escolherModelo } = require('../../src/services/suporte/escolhaDoModelo');

const nivel = (texto, nivelAnterior = null) => escolherModelo({ texto, nivelAnterior }).nivel;

test('as perguntas rapidas da tela: duvida vai pro Haiku, problema vai pro Sonnet', () => {
  assert.equal(nivel('Quando meus minutos renovam?'), 0);
  assert.equal(nivel('Como deixar o sistema 100% automático?'), 0);
  assert.equal(nivel('Me mostre como usar o sistema'), 0);
  assert.equal(nivel('Meu vídeo não foi processado'), 1);
  assert.equal(nivel('Meus créditos sumiram'), 1);
  assert.equal(nivel('Por que meus cortes não estão sendo postados?'), 1);
});

test('"nao resolveu" sobe um degrau por vez, ate o Opus', () => {
  assert.equal(nivel('ainda não funcionou', 0), 1);
  assert.equal(nivel('ainda não funcionou', 1), 2);
  assert.equal(nivel('continua dando erro', 2), 2, 'nao passa do topo');
});

test('no meio de uma investigacao o nivel nao desce', () => {
  assert.equal(nivel('sim, pode enviar', 1), 1);
  assert.equal(nivel('ok obrigado', 2), 2);
});

test('"pode processar de novo" e o cliente concordando, nao reclamando', () => {
  assert.equal(nivel('pode processar de novo', 0), 0);
  assert.equal(nivel('deu erro de novo', 1), 2);
});

test('conversa nova recomeca do zero', () => {
  assert.equal(nivel('oi, tudo bem?', null), 0);
});
