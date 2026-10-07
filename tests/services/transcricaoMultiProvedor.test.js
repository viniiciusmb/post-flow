// Transcricao em tres provedores (07/10/2026): DeepInfra -> Groq -> OpenAI.
//
// O que estes testes travam:
//   - o audio e cortado nas PAUSAS em pedacos de ate 28s antes de ir pra
//     DeepInfra (mandando inteiro, ela cortava sozinha em 30s fixos e perdia
//     frases inteiras - 15 num video de 97 min), e cada palavra volta pro lugar
//     certo do video;
//   - o idioma do primeiro pedaco vale pros outros, e sai sempre em codigo ISO;
//   - provedor que falha passa a vez pro proximo, mas PAUSA nunca passa;
//   - frase inventada pelo Whisper em trecho de musica nao vira legenda;
//   - o gasto e anotado na conta certa (ai_gastos), que e de onde a tela de
//     Custos tira o saldo.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const pool = require('../../src/db/pool');
const config = require('../../src/config');
const { PausedError } = require('../../src/lib/errors');
const transcricao = require('../../src/services/transcricaoService');
const openaiTranscriptionService = require('../../src/services/openaiTranscriptionService');
const openaiLives = require('../../src/services/lives/openaiLives');

const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'teste-multi-'));
// ffmpeg falso: na analise de silencio, imprime pausas em 20s e 45s; nos
// cortes, cria o arquivo de destino. ffprobe falso: 70 segundos.
fs.writeFileSync(
  path.join(pasta, 'ffmpeg'),
  `#!/bin/sh
case "$*" in
  *silencedetect*) printf 'silence_start: 19.8\\nsilence_end: 20.2 | silence_duration: 0.4\\nsilence_start: 44.7\\nsilence_end: 45.3 | silence_duration: 0.6\\n' >&2 ;;
  *) for a in "$@"; do ultimo="$a"; done; printf 'x' > "$ultimo" ;;
esac
`,
  { mode: 0o755 }
);
fs.writeFileSync(path.join(pasta, 'ffprobe'), '#!/bin/sh\necho 70\n', { mode: 0o755 });
const audio = path.join(pasta, 'audio.mp3');
fs.writeFileSync(audio, 'audio');

const original = {
  fetch: global.fetch,
  chaves: { d: config.deepinfra.apiKey, g: config.groq.apiKey, o: config.openai.apiKey },
  openai: openaiTranscriptionService.transcribeAudio,
  bloco: openaiLives.transcreverBloco,
};

function resposta(status, corpo) {
  return { ok: status < 400, status, json: async () => corpo };
}

test.beforeEach(() => {
  process.env.FFMPEG_PATH = path.join(pasta, 'ffmpeg');
  process.env.FFPROBE_PATH = path.join(pasta, 'ffprobe');
  config.deepinfra.apiKey = 'di-teste';
  config.groq.apiKey = 'gq-teste';
  config.openai.apiKey = 'oa-teste';
});

test.afterEach(() => {
  global.fetch = original.fetch;
  openaiTranscriptionService.transcribeAudio = original.openai;
  openaiLives.transcreverBloco = original.bloco;
});

test.after(async () => {
  config.deepinfra.apiKey = original.chaves.d;
  config.groq.apiKey = original.chaves.g;
  config.openai.apiKey = original.chaves.o;
  delete process.env.FFMPEG_PATH;
  delete process.env.FFPROBE_PATH;
  fs.rmSync(pasta, { recursive: true, force: true });
});

async function gastosDe(provedor, uso) {
  // O gasto e anotado sem segurar a transcricao - espera ele chegar.
  for (let i = 0; i < 50; i++) {
    const { rows } = await pool.query('SELECT usd::float8 AS usd, audio_segundos::float8 AS seg FROM ai_gastos WHERE provedor = $1 AND uso = $2', [provedor, uso]);
    if (rows.length) return rows;
    await new Promise((r) => setTimeout(r, 20));
  }
  return [];
}

test('corta nas pausas: o meio da ULTIMA pausa que cabe em 28s, nunca passa de 28s', () => {
  const silencios = [
    { inicio: 10, fim: 11 },
    { inicio: 19.8, fim: 20.2 },
    { inicio: 44.7, fim: 45.3 },
  ];
  const pedacos = transcricao.planejarPedacos(70, silencios);
  assert.deepEqual(pedacos, [[0, 20], [20, 45], [45, 70]]);
  // Sem pausa nenhuma (musica, fala corrida): corta no limite.
  const corrido = transcricao.planejarPedacos(70, []);
  assert.deepEqual(corrido, [[0, 28], [28, 56], [56, 70]]);
  // Cobre o video inteiro, sem buraco nem sobreposicao.
  for (const lista of [pedacos, corrido]) {
    assert.equal(lista[0][0], 0);
    assert.equal(lista[lista.length - 1][1], 70);
    for (let i = 1; i < lista.length; i++) assert.equal(lista[i][0], lista[i - 1][1]);
    for (const [a, b] of lista) assert.ok(b - a <= transcricao.MAX_PEDACO_S);
  }
  // Audio curto vai inteiro.
  assert.deepEqual(transcricao.planejarPedacos(20, []), [[0, 20]]);
});

test('le as pausas do ffmpeg, inclusive a que vai ate o fim do audio', () => {
  const saida = 'silence_start: 3.5\nsilence_end: 4.0 | silence_duration: 0.5\nsilence_start: 58.1\n';
  assert.deepEqual(transcricao.interpretarSilencios(saida, 60), [
    { inicio: 3.5, fim: 4 },
    { inicio: 58.1, fim: 60 },
  ]);
});

test('DeepInfra: cada pedaco vai separado, as palavras voltam pro lugar certo e o idioma do primeiro vale pros outros', async () => {
  const chamadas = [];
  global.fetch = async (url, { body }) => {
    assert.match(String(url), /deepinfra/);
    chamadas.push({ idioma: body.get('language'), formato: body.get('response_format') });
    const n = chamadas.length;
    return resposta(200, {
      text: `trecho ${n}`,
      language: 'pt',
      words: [{ word: `p${n}`, start: 1, end: 2 }],
      segments: [{ start: 1, end: 2, text: `trecho ${n}` }],
    });
  };
  const r = await transcricao.transcribeAudio(audio, { uso: 'teste_deepinfra' });
  assert.equal(r.provedor, 'deepinfra');
  assert.equal(chamadas.length, 3, 'pausas em 20s e 45s: 3 pedacos');
  assert.equal(chamadas[0].idioma, null, 'o primeiro detecta o idioma');
  assert.deepEqual(chamadas.slice(1).map((c) => c.idioma), ['pt', 'pt'], 'os outros recebem o idioma do primeiro');
  assert.ok(chamadas.every((c) => c.formato === 'verbose_json'), 'pede o tempo de cada palavra');
  // Palavra do 2o pedaco (que comeca em 20s) e do 3o (45s) deslocadas.
  const inicios = r.words.map((w) => w.start).sort((a, b) => a - b);
  assert.deepEqual(inicios, [1, 21, 46]);
  assert.equal(r.language, 'pt');
  assert.equal(r.durationSeconds, 70);
  // US$ 0,0002 por minuto de audio enviado.
  assert.ok(Math.abs(r.costUsd - (70 / 60) * 0.0002) < 1e-12);
  const gastos = await gastosDe('deepinfra', 'teste_deepinfra');
  assert.equal(gastos.length, 1);
  assert.ok(Math.abs(gastos[0].usd - r.costUsd) < 1e-7, "o livro guarda 8 casas decimais");
});

test('frase inventada pelo Whisper num pedaco de musica nao vira legenda', async () => {
  let n = 0;
  global.fetch = async () => {
    n++;
    const texto = n === 2 ? 'Legendas pela comunidade Amara.org' : `fala ${n}`;
    return resposta(200, { text: texto, language: 'pt', words: [{ word: texto, start: 0, end: 1 }], segments: [] });
  };
  const r = await transcricao.transcribeAudio(audio);
  assert.doesNotMatch(r.text, /amara/i);
  assert.ok(r.words.every((w) => !/amara/i.test(w.word)));
  assert.equal(transcricao.ehAlucinacao('Obrigado por assistir!'), true);
  assert.equal(transcricao.ehAlucinacao('obrigado por assistir esse video ate o fim, galera'), false);
});

test('DeepInfra sem saldo: a Groq assume o arquivo inteiro, e o idioma sai em codigo ISO', async () => {
  const urls = [];
  global.fetch = async (url) => {
    urls.push(String(url));
    if (String(url).includes('deepinfra')) {
      return resposta(402, { detail: { error: 'You need positive balance to do inference.' } });
    }
    return resposta(200, { text: 'ola', language: 'Portuguese', duration: 70, words: [{ word: 'ola', start: 0, end: 1 }], segments: [] });
  };
  const r = await transcricao.transcribeAudio(audio);
  assert.equal(r.provedor, 'groq');
  assert.equal(r.language, 'pt');
  // 402 nao adianta repetir: um pedido so na DeepInfra, depois a Groq.
  assert.equal(urls.filter((u) => u.includes('deepinfra')).length, 1);
  assert.equal(urls.filter((u) => u.includes('groq')).length, 1);
});

test('DeepInfra e Groq fora: a OpenAI e o ultimo recurso', async () => {
  global.fetch = async (url) => resposta(String(url).includes('groq') ? 429 : 503, {});
  openaiTranscriptionService.transcribeAudio = async () => ({
    text: 'ok', language: 'portuguese', words: [], segments: [], durationSeconds: 70, costUsd: 0.007,
  });
  const r = await transcricao.transcribeAudio(audio);
  assert.equal(r.provedor, 'openai');
  assert.equal(r.language, 'pt');
});

test('provedor sem chave sai da fila; sem nenhuma chave, o erro diz o que falta', async () => {
  config.deepinfra.apiKey = '';
  config.groq.apiKey = '';
  let chamouOpenai = false;
  openaiTranscriptionService.transcribeAudio = async () => {
    chamouOpenai = true;
    return { text: 'x', language: 'pt', words: [], segments: [], durationSeconds: 1, costUsd: 0 };
  };
  global.fetch = async () => {
    throw new Error('nao devia chamar a rede');
  };
  await transcricao.transcribeAudio(audio);
  assert.equal(chamouOpenai, true);
  config.openai.apiKey = '';
  await assert.rejects(() => transcricao.transcribeAudio(audio), /DEEPINFRA_API_KEY/);
});

test('pausa do cliente corta a chamada em andamento e NAO cai pro proximo provedor', async () => {
  let chamouOutro = false;
  global.fetch = (url, { signal }) => {
    if (!String(url).includes('deepinfra')) {
      chamouOutro = true;
      return Promise.resolve(resposta(200, { text: 'x' }));
    }
    // A DeepInfra "trava": so termina quando a chamada e abortada.
    return new Promise((_, reject) => {
      signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    });
  };
  const inicio = Date.now();
  await assert.rejects(() => transcricao.transcribeAudio(audio, { checkCancelled: async () => true }), PausedError);
  assert.equal(chamouOutro, false, 'nenhum outro provedor foi chamado depois da pausa');
  assert.ok(Date.now() - inicio < 6000, 'a pausa vale em segundos, nao no fim da transcricao');
});

test('bloco de live: DeepInfra sem tempo de palavra, frase inventada vira vazio, e a OpenAI so entra se os dois falharem', async () => {
  const formatos = [];
  global.fetch = async (url, { body }) => {
    formatos.push(body.get('response_format'));
    return resposta(200, { text: 'Legendas pela comunidade Amara.org' });
  };
  const r = await transcricao.transcreverBlocoDeLive(audio, { segundos: 24, uso: 'teste_lives' });
  assert.equal(r.provedor, 'deepinfra');
  assert.equal(r.texto, '');
  assert.deepEqual(formatos, ['json']);
  assert.ok(Math.abs(r.custoUsd - (24 / 60) * 0.0002) < 1e-12);

  global.fetch = async () => resposta(500, {});
  let chamouOpenai = false;
  openaiLives.transcreverBloco = async () => {
    chamouOpenai = true;
    return { texto: 'e ai galera', custoUsd: 0.0005 };
  };
  const r2 = await transcricao.transcreverBlocoDeLive(audio, { segundos: 24 });
  assert.equal(chamouOpenai, true);
  assert.equal(r2.provedor, 'openai');
  assert.equal(r2.texto, 'e ai galera');
});
