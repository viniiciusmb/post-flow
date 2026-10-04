// Economias das lives (04/10/2026): Flex (metade do preco) com volta ao modo
// normal quando a OpenAI nao tem capacidade, e custo calculado pelo que a
// resposta da OpenAI informa (tokens, cache, flex), nao por estimativa.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const pool = require('../../src/db/pool');
const openaiLives = require('../../src/services/lives/openaiLives');
const { textoCostFromUsage, miniTranscribeCostFromUsage } = require('../../src/lib/apiCost');
const { similaridade } = require('../../src/lib/similaridadeDeTexto');

test.after(async () => {
  await pool.end();
});

function trocarFetch(fn) {
  const original = globalThis.fetch;
  globalThis.fetch = fn;
  return () => { globalThis.fetch = original; };
}

function resposta(status, corpo) {
  return { ok: status >= 200 && status < 300, status, json: async () => corpo };
}

const SCHEMA = { type: 'object', additionalProperties: false, required: ['ok'], properties: { ok: { type: 'boolean' } } };

test('custo de texto: entrada em cache sai a 10%, flex pela metade', () => {
  const base = { precoEntrada: 0.25, precoSaida: 2.0 };
  // 1M de entrada (nada em cache) + 1M de saida = 0,25 + 2,00
  assert.equal(textoCostFromUsage({ ...base, entrada: 1e6, saida: 1e6 }), 2.25);
  // metade da entrada em cache: 0,125 + 0,0125 + 2,00
  assert.ok(Math.abs(textoCostFromUsage({ ...base, entrada: 1e6, emCache: 5e5, saida: 1e6 }) - 2.1375) < 1e-9);
  assert.equal(textoCostFromUsage({ ...base, entrada: 1e6, saida: 1e6, flex: true }), 1.125);
});

test('custo da transcricao corrida vem dos TOKENS da resposta (o real), nao da estimativa por minuto', () => {
  // Resposta real medida na VPS em 04/10/2026 (bloco de 30s em 1,0x).
  const usage = { type: 'tokens', total_tokens: 353, input_tokens: 300, input_token_details: { text_tokens: 0, audio_tokens: 300 }, output_tokens: 53 };
  const real = miniTranscribeCostFromUsage(usage, 30);
  assert.ok(Math.abs(real - (300 * 1.25 + 53 * 5) / 1e6) < 1e-12);
  assert.ok(real < (30 / 60) * 0.003, 'o real e menos da metade da estimativa antiga');
  // Sem usage, cai na estimativa.
  assert.equal(miniTranscribeCostFromUsage(null, 60), 0.003);
});

test('pedirJson vai pelo flex e o custo sai pela metade quando a OpenAI confirma o flex', async () => {
  const pedidos = [];
  const desfazer = trocarFetch(async (_url, opts) => {
    pedidos.push(JSON.parse(opts.body));
    return resposta(200, {
      service_tier: 'flex',
      choices: [{ message: { content: '{"ok":true}' } }],
      usage: { prompt_tokens: 1e6, completion_tokens: 0, prompt_tokens_details: { cached_tokens: 0 } },
    });
  });
  try {
    const r = await openaiLives.pedirJson({ nome: 't', sistema: 's', usuario: 'u', schema: SCHEMA, modelo: 'gpt-5-mini' });
    assert.equal(pedidos[0].service_tier, 'flex');
    assert.equal(r.tier, 'flex');
    assert.equal(r.custoUsd, 0.125);
  } finally {
    desfazer();
  }
});

test('flex sem capacidade (429): a mesma pergunta vai no modo normal na hora, e o custo e o normal', async () => {
  const tiers = [];
  const desfazer = trocarFetch(async (_url, opts) => {
    const corpo = JSON.parse(opts.body);
    tiers.push(corpo.service_tier || 'default');
    if (corpo.service_tier === 'flex') return resposta(429, { error: { message: 'Resource Unavailable' } });
    return resposta(200, { service_tier: 'default', choices: [{ message: { content: '{"ok":true}' } }], usage: { prompt_tokens: 1e6, completion_tokens: 0 } });
  });
  try {
    const r = await openaiLives.pedirJson({ nome: 't', sistema: 's', usuario: 'u', schema: SCHEMA, modelo: 'gpt-5-mini' });
    assert.deepEqual(tiers, ['flex', 'default']);
    assert.equal(r.tier, 'default');
    assert.equal(r.custoUsd, 0.25);
  } finally {
    desfazer();
  }
});

test('erro de verdade (400) no flex NAO e repetido no modo normal', async () => {
  let chamadas = 0;
  const desfazer = trocarFetch(async () => {
    chamadas += 1;
    return resposta(400, { error: { message: 'schema invalido' } });
  });
  try {
    await assert.rejects(() => openaiLives.pedirJson({ nome: 't', sistema: 's', usuario: 'u', schema: SCHEMA }), /400/);
    assert.equal(chamadas, 1);
  } finally {
    desfazer();
  }
});

test('transcricao do bloco registra o custo pelos tokens que a OpenAI devolveu', async () => {
  const arq = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tr-')), 'b.ogg');
  fs.writeFileSync(arq, 'x');
  const desfazer = trocarFetch(async () => resposta(200, { text: 'fala', usage: { type: 'tokens', input_tokens: 400, output_tokens: 40 } }));
  try {
    const r = await openaiLives.transcreverBloco(arq, { segundos: 24 });
    assert.ok(Math.abs(r.custoUsd - (400 * 1.25 + 40 * 5) / 1e6) < 1e-12);
  } finally {
    desfazer();
  }
});

test('similaridade de texto ignora acento, pontuacao e maiuscula', () => {
  assert.equal(similaridade('Tá bom, mano!', 'ta bom mano'), 1);
  assert.equal(similaridade('que jogada absurda mano', 'que jogada absurda'), 0.75);
  assert.equal(similaridade('', ''), 1);
});
