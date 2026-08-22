// Os cortes têm que sair na ordem do vídeo: o primeiro corte é o começo.
//
// Quebrou de verdade e o fundador reclamou: um corte do fim do vídeo era
// publicado antes do começo. A causa é sutil — na PRIMEIRA vez que um vídeo é
// processado, a lista de cortes vinha do retorno de `createMany`, que estava
// na ordem em que a IA devolveu os trechos (arbitrária). Só ao RETOMAR um
// vídeo pausado é que a lista vinha do banco, ordenada por tempo. Ou seja: o
// caminho normal era o errado, e o caminho raro era o certo.
//
// Isso importa em três lugares: a numeração "Parte N", a ordem de renderização
// e a fila de publicação (que sai por id de postagem, seguindo a inserção).
//
// O que estes testes travam:
//   - a inserção é cronológica mesmo com a IA devolvendo fora de ordem;
//   - trecho que começa depois do fim do vídeo é descartado (aconteceu de
//     verdade: vídeo de 42 min com trechos começando em 8 HORAS);
//   - trecho que passa do fim é cortado no fim, não descartado.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const pool = require('../../src/db/pool');
const clipsRepository = require('../../src/repositories/clipsRepository');
const { createClient, createSourceVideo } = require('../helpers/db');

test.after(async () => {
  await pool.end();
});

test('a IA devolve fora de ordem, o banco guarda em ordem', async () => {
  const cliente = await createClient();
  const video = await createSourceVideo(cliente.id, { durationSeconds: 2537 });

  // Ordem real observada em produção: a IA devolveu os trechos do FIM antes
  // dos do começo.
  const daIa = [
    { title: 'Fim', startSeconds: 1800, endSeconds: 1860, description: null },
    { title: 'Meio', startSeconds: 900, endSeconds: 960, description: null },
    { title: 'Comeco', startSeconds: 30, endSeconds: 90, description: null },
    { title: 'Quase fim', startSeconds: 1500, endSeconds: 1560, description: null },
  ];

  const criados = await clipsRepository.createMany(video.id, daIa);

  // O retorno já vem em ordem - é ele que o pipeline usa para renderizar e
  // para numerar "Parte N".
  assert.deepEqual(
    criados.map((c) => Number(c.start_seconds)),
    [30, 900, 1500, 1800],
    'o retorno de createMany tem que estar em ordem de tempo'
  );

  // E os ids seguem a mesma ordem - a fila de publicação sai por id.
  const ids = criados.map((c) => Number(c.id));
  assert.deepEqual([...ids].sort((a, b) => a - b), ids, 'os ids têm que crescer junto com o tempo');

  // O banco concorda.
  const doBanco = await clipsRepository.listBySourceVideoId(video.id);
  assert.deepEqual(
    doBanco.map((c) => c.title),
    ['Comeco', 'Meio', 'Quase fim', 'Fim']
  );
});

test('"Parte 1" é o corte do começo do vídeo', async () => {
  const cliente = await createClient();
  const video = await createSourceVideo(cliente.id, { durationSeconds: 600 });

  const criados = await clipsRepository.createMany(video.id, [
    { title: 'Terceiro', startSeconds: 400, endSeconds: 460, description: null },
    { title: 'Primeiro', startSeconds: 10, endSeconds: 70, description: null },
    { title: 'Segundo', startSeconds: 200, endSeconds: 260, description: null },
  ]);

  // partIndex é calculado por clips.indexOf(clip) + 1 no processVideoJob.
  assert.equal(criados[0].title, 'Primeiro', 'Parte 1 tem que ser o começo do vídeo');
  assert.equal(criados[2].title, 'Terceiro');
});

// O filtro de trecho impossível vive no processVideoJob (precisa da duração
// real vinda da transcrição), então aqui testamos a regra em si, com os
// números que apareceram em produção.
function descartarInvalidos(selected, duracaoReal) {
  let r = selected.filter((c) => Number(c.startSeconds) < duracaoReal);
  r = r.map((c) => (Number(c.endSeconds) > duracaoReal ? { ...c, endSeconds: duracaoReal } : c));
  return r.filter((c) => Number(c.endSeconds) - Number(c.startSeconds) >= 5);
}

test('trecho que começa depois do fim do vídeo é descartado', () => {
  // Caso real: vídeo-fonte 1900, 2537 segundos, com trechos começando em
  // 31940s e 34250s. Renderizar isso gera corte vazio, e o TikTok recusa.
  const selected = [
    { startSeconds: 167, endSeconds: 227 },
    { startSeconds: 31940, endSeconds: 32000 },
    { startSeconds: 34250, endSeconds: 34310 },
    { startSeconds: 900, endSeconds: 960 },
  ];
  const r = descartarInvalidos(selected, 2537);
  assert.deepEqual(r.map((c) => c.startSeconds), [167, 900]);
});

test('trecho que passa do fim é cortado no fim, não jogado fora', () => {
  // O começo dele é válido e costuma ser o melhor pedaço.
  const r = descartarInvalidos([{ startSeconds: 2500, endSeconds: 2600 }], 2537);
  assert.equal(r.length, 1);
  assert.equal(r[0].endSeconds, 2537);
});

test('sobra curta demais depois do corte é descartada', () => {
  // 2535 -> 2537 são 2 segundos: não é um corte, é um piscar de olhos.
  const r = descartarInvalidos([{ startSeconds: 2535, endSeconds: 2600 }], 2537);
  assert.equal(r.length, 0);
});
