// No modo "cortar o vídeo inteiro em partes", cada parte precisa do SEU
// título, no idioma falado no vídeo.
//
// Antes todas herdavam o título do vídeo do YouTube: em 23/08/2026 um vídeo
// falado em português virou 8 cortes com o MESMO título, em inglês, queimado
// na tela — a única diferença entre eles era o "Parte N".
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const claudeClipSelectionService = require('../../src/services/claudeClipSelectionService');
const { titularAsPartes } = require('../../src/worker/videoJobs/processVideoJob');
const pool = require('../../src/db/pool');
const { createClient, createSourceVideo } = require('../helpers/db');

test.after(async () => {
  await pool.end();
});

const original = claudeClipSelectionService.titleParts;
test.afterEach(() => {
  claudeClipSelectionService.titleParts = original;
});

function fingirIA(resposta) {
  claudeClipSelectionService.titleParts = async () => ({
    parts: resposta,
    inputTokens: 100,
    outputTokens: 50,
    costUsd: 0.001,
  });
}

const TRANSCRICAO = {
  words: [{ word: 'oi', start: 0, end: 1 }],
  language: 'pt',
};

function partes(n) {
  return Array.from({ length: n }, (_, i) => ({
    title: "WE INVADED EMILLY VICK'S MANSION!", // o título do YouTube, igual em todas
    description: null,
    startSeconds: i * 180,
    endSeconds: (i + 1) * 180,
  }));
}

async function videoDeTeste() {
  const cliente = await createClient();
  return createSourceVideo(cliente.id, { title: "WE INVADED EMILLY VICK'S MANSION!" });
}

test('cada parte recebe o título que a IA escreveu pra ela', async () => {
  const video = await videoDeTeste();
  fingirIA([
    { index: 1, title: 'Invadimos a mansão', description: 'olha isso #mansao' },
    { index: 2, title: 'A piscina secreta', description: 'inacreditável #piscina' },
    { index: 3, title: 'O quarto escondido', description: 'ninguém esperava #quarto' },
  ]);

  const r = await titularAsPartes(partes(3), TRANSCRICAO, video);

  assert.deepEqual(r.map((p) => p.title), ['Invadimos a mansão', 'A piscina secreta', 'O quarto escondido']);
  assert.equal(new Set(r.map((p) => p.title)).size, 3, 'os títulos saíram repetidos');
  assert.deepEqual(r.map((p) => p.description), ['olha isso #mansao', 'inacreditável #piscina', 'ninguém esperava #quarto']);
});

test('o corte de cada parte continua no lugar - titular não mexe no tempo', async () => {
  const video = await videoDeTeste();
  fingirIA([
    { index: 1, title: 'a', description: 'x' },
    { index: 2, title: 'b', description: 'y' },
  ]);

  const entrada = partes(2);
  const r = await titularAsPartes(entrada, TRANSCRICAO, video);
  assert.deepEqual(
    r.map((p) => [p.startSeconds, p.endSeconds]),
    entrada.map((p) => [p.startSeconds, p.endSeconds])
  );
});

test('a IA respondendo fora de ordem não embaralha as partes', async () => {
  // Casamos por "index", não por posição na resposta: a ordem do array que a
  // IA devolve não é garantida, e trocar o título da Parte 1 com o da Parte 3
  // é o tipo de erro que ninguém percebe até assistir aos cortes.
  const video = await videoDeTeste();
  fingirIA([
    { index: 3, title: 'terceira', description: 'c' },
    { index: 1, title: 'primeira', description: 'a' },
    { index: 2, title: 'segunda', description: 'b' },
  ]);

  const r = await titularAsPartes(partes(3), TRANSCRICAO, video);
  assert.deepEqual(r.map((p) => p.title), ['primeira', 'segunda', 'terceira']);
});

test('IA que falha não derruba o vídeo - só perde o título bonito', async () => {
  // Título é acabamento. Perder os 8 cortes de um vídeo caro por causa de uma
  // chamada de texto que não respondeu seria bem pior.
  const video = await videoDeTeste();
  claudeClipSelectionService.titleParts = async () => {
    throw new Error('Claude fora do ar');
  };

  const r = await titularAsPartes(partes(3), TRANSCRICAO, video);
  assert.equal(r.length, 3);
  for (const p of r) assert.equal(p.title, "WE INVADED EMILLY VICK'S MANSION!");
});

test('parte sem título na resposta cai no título do vídeo, e não em vazio', async () => {
  // Corte com título vazio renderiza uma faixa de cor com nada escrito.
  const video = await videoDeTeste();
  fingirIA([
    { index: 1, title: 'tem título', description: 'a' },
    { index: 2, title: '   ', description: 'b' },
    // a parte 3 nem veio
  ]);

  const r = await titularAsPartes(partes(3), TRANSCRICAO, video);
  assert.equal(r[0].title, 'tem título');
  assert.equal(r[1].title, "WE INVADED EMILLY VICK'S MANSION!");
  assert.equal(r[2].title, "WE INVADED EMILLY VICK'S MANSION!");
});

test('o custo da chamada é registrado no vídeo', async () => {
  // Toda chamada de IA aqui aparece no custo por vídeo do painel do admin.
  const video = await videoDeTeste();
  fingirIA([{ index: 1, title: 'a', description: 'x' }]);
  await titularAsPartes(partes(1), TRANSCRICAO, video);

  const { rows } = await pool.query(
    'SELECT claude_input_tokens, claude_output_tokens, claude_cost_usd FROM source_videos WHERE id = $1',
    [video.id]
  );
  assert.ok(Number(rows[0].claude_input_tokens) > 0, 'os tokens da titulação não foram contabilizados');
  assert.ok(Number(rows[0].claude_cost_usd) > 0);
});
