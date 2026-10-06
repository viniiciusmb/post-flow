// Audio acima do limite de 25 MiB da OpenAI (01/10/2026).
//
// O audio era extraido a 64 kbps e todo video acima de ~54 min passava do
// limite: a OpenAI respondia 413 sempre, o video terminava em erro, e o cliente
// ja tinha sido cobrado no download. O caso real tinha 26.217.407 bytes - 3 KB
// acima do limite.
//
// O que estes testes travam: arquivo pequeno vai numa chamada so (nada muda
// pra quem ja funcionava); arquivo grande e dividido em partes que cabem, e a
// transcricao volta UNICA, com os tempos de cada parte deslocados pro lugar
// certo - senao a legenda da segunda metade do video sairia no comeco dela.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const servico = require('../../src/services/openaiTranscriptionService');

const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'teste-transcricao-'));
const logFfmpeg = path.join(pasta, 'ffmpeg.log');

// ffmpeg falso: anota os argumentos e cria um arquivo pequeno no destino
// (o ultimo argumento). ffprobe falso: responde a duracao do video real.
fs.writeFileSync(path.join(pasta, 'ffmpeg'), `#!/bin/sh\necho "$@" >> "${logFfmpeg}"\nfor a in "$@"; do ultimo="$a"; done\nprintf 'x' > "$ultimo"\n`, { mode: 0o755 });
fs.writeFileSync(path.join(pasta, 'ffprobe'), '#!/bin/sh\necho 3277\n', { mode: 0o755 });

const fetchOriginal = global.fetch;
let chamadas;

test.beforeEach(() => {
  process.env.FFMPEG_PATH = path.join(pasta, 'ffmpeg');
  process.env.FFPROBE_PATH = path.join(pasta, 'ffprobe');
  fs.rmSync(logFfmpeg, { force: true });
  chamadas = [];
  global.fetch = async (_url, { body }) => {
    const idioma = body.get('language');
    chamadas.push({ idioma, tamanho: body.get('file').size });
    const n = chamadas.length;
    return {
      ok: true,
      json: async () => ({
        text: `parte ${n}`,
        language: 'portuguese',
        duration: 1638.5,
        words: [{ word: `p${n}`, start: 1, end: 2 }],
        segments: [{ start: 1, end: 2, text: `parte ${n}` }],
      }),
    };
  };
});

test.after(() => {
  global.fetch = fetchOriginal;
  delete process.env.FFMPEG_PATH;
  delete process.env.FFPROBE_PATH;
  fs.rmSync(pasta, { recursive: true, force: true });
});

function audioDeTamanho(bytes) {
  const arquivo = path.join(pasta, `audio-${bytes}.mp3`);
  fs.writeFileSync(arquivo, '');
  fs.truncateSync(arquivo, bytes); // arquivo esparso: nao ocupa o disco de verdade
  return arquivo;
}

test('audio pequeno continua indo numa chamada so, sem dividir', async () => {
  const r = await servico.transcribeAudio(audioDeTamanho(5 * 1024 * 1024));
  assert.equal(chamadas.length, 1);
  assert.equal(fs.existsSync(logFfmpeg), false, 'nao chamou o ffmpeg');
  assert.equal(r.text, 'parte 1');
});

test('o arquivo real do caso (26.217.407 bytes) e dividido e nenhuma parte passa do limite', async () => {
  const tamanhoReal = 26217407;
  assert.ok(tamanhoReal > servico.LIMITE_DA_OPENAI_BYTES, 'o caso real estoura o limite');

  const r = await servico.transcribeAudio(audioDeTamanho(tamanhoReal));

  assert.equal(chamadas.length, 2);
  for (const c of chamadas) assert.ok(c.tamanho < servico.LIMITE_DA_OPENAI_BYTES);

  // Cada parte comeca onde a anterior terminou.
  const cortes = fs.readFileSync(logFfmpeg, 'utf8').trim().split('\n');
  assert.match(cortes[0], /-ss 0\.000 -t 1638\.500/);
  assert.match(cortes[1], /-ss 1638\.500 -t 1638\.500/);

  // Uma transcricao so, com os tempos da segunda parte deslocados.
  assert.deepEqual(r.words.map((w) => w.start), [1, 1639.5]);
  assert.deepEqual(r.segments.map((s) => s.end), [2, 1640.5]);
  assert.equal(r.text, 'parte 1 parte 2');
  assert.equal(r.durationSeconds, 3277);
});

test('a segunda parte recebe o idioma detectado na primeira', async () => {
  await servico.transcribeAudio(audioDeTamanho(40 * 1024 * 1024));
  assert.ok(chamadas.length >= 2, 'foi dividido');
  assert.equal(chamadas[0].idioma, null);
  for (const c of chamadas.slice(1)) assert.equal(c.idioma, 'portuguese');
});

test('as partes temporarias sao apagadas no fim', async () => {
  const antes = fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('postflow-partes-')).length;
  await servico.transcribeAudio(audioDeTamanho(30 * 1024 * 1024));
  const depois = fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('postflow-partes-')).length;
  assert.equal(depois, antes);
});

// 06/10/2026: video de 97 min, audio de 23 MB - ABAIXO do limite de tamanho -
// falhou 8 vezes com "fetch failed" (o Node desiste de esperar a resposta em
// 300 s). Tamanho sozinho nao protege: audio longo tem que ser dividido pela
// duracao tambem.
test('audio longo mas pequeno e dividido pela duracao (caso dos 97 min)', async () => {
  const probe = path.join(pasta, 'ffprobe');
  fs.writeFileSync(probe, '#!/bin/sh\necho 5808\n', { mode: 0o755 });
  try {
    await servico.transcribeAudio(audioDeTamanho(23 * 1024 * 1024));
    assert.ok(23 * 1024 * 1024 < servico.TAMANHO_SEGURO_BYTES, 'o caso real cabia no limite de tamanho');
    assert.equal(chamadas.length, Math.ceil(5808 / servico.MAX_SEGUNDOS_POR_CHAMADA));
    const cortes = fs.readFileSync(logFfmpeg, 'utf8').trim().split('\n');
    for (const c of cortes) {
      const dur = Number(c.match(/-t ([0-9.]+)/)[1]);
      assert.ok(dur <= servico.MAX_SEGUNDOS_POR_CHAMADA, `parte de ${dur}s passa do teto`);
    }
  } finally {
    fs.writeFileSync(probe, '#!/bin/sh\necho 3277\n', { mode: 0o755 });
  }
});

test('audio curto acima de 6 MB continua numa chamada so', async () => {
  const probe = path.join(pasta, 'ffprobe');
  fs.writeFileSync(probe, '#!/bin/sh\necho 1200\n', { mode: 0o755 });
  try {
    await servico.transcribeAudio(audioDeTamanho(8 * 1024 * 1024));
    assert.equal(chamadas.length, 1);
    assert.equal(fs.existsSync(logFfmpeg), false, 'nao dividiu');
  } finally {
    fs.writeFileSync(probe, '#!/bin/sh\necho 3277\n', { mode: 0o755 });
  }
});
