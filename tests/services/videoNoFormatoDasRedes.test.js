// Arquivo que sai pras redes vai com o índice no começo e sem "edit list".
//
// No primeiro envio automático pro Instagram (13/10/2026) a Outstand devolveu
// dois avisos: "instagram requires the moov atom at the front of the file
// (faststart)" e "instagram rejects videos containing edit lists". A
// publicação passou, mas o Instagram diz que recusa - e os cortes eram
// gravados com o índice no fim, o padrão do ffmpeg.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-rede-'));
const log = path.join(pasta, 'ffmpeg.log');
const sinalDeFalha = path.join(pasta, 'falhar');
// ffmpeg falso: anota os argumentos e cria o arquivo de saída (o último
// argumento) - ou falha, quando o teste pede.
fs.writeFileSync(
  path.join(pasta, 'ffmpeg'),
  `#!/bin/sh\necho "$@" >> "${log}"\n[ -f "${sinalDeFalha}" ] && exit 1\nfor a in "$@"; do ultimo="$a"; done\nprintf 'mp4 reembalado' > "$ultimo"\n`,
  { mode: 0o755 }
);
process.env.FFMPEG_PATH = path.join(pasta, 'ffmpeg');

const videoParaRedeService = require('../../src/services/videoParaRedeService');

test.after(() => {
  fs.rmSync(pasta, { recursive: true, force: true });
  delete process.env.FFMPEG_PATH;
});

function corte() {
  const arquivo = path.join(pasta, `clip-${Date.now()}-${Math.random()}.mp4`);
  fs.writeFileSync(arquivo, 'video original');
  return arquivo;
}

test('o corte é reembalado com o índice no começo e sem edit list, sem recodificar', async () => {
  fs.rmSync(log, { force: true });
  const original = corte();
  const r = await videoParaRedeService.prepararParaRede(original, 50 * 1024 * 1024, 30);
  assert.equal(r.temporario, true);
  assert.notEqual(r.caminho, original, 'o original não é tocado');
  assert.equal(fs.readFileSync(original, 'utf8'), 'video original');
  const args = fs.readFileSync(log, 'utf8');
  assert.match(args, /-movflags \+faststart/);
  assert.match(args, /-use_editlist 0/);
  assert.match(args, /-c copy/, 'reembalar é copiar, não recodificar');
});

test('se a reembalagem falhar, vai o arquivo original', async () => {
  fs.writeFileSync(sinalDeFalha, '');
  try {
    const original = corte();
    const r = await videoParaRedeService.prepararParaRede(original, 50 * 1024 * 1024, 30);
    assert.deepEqual(r, { caminho: original, temporario: false });
  } finally {
    fs.rmSync(sinalDeFalha, { force: true });
  }
});

test('a publicação nas redes usa o arquivo preparado, e o render já grava no formato certo', () => {
  const ler = (f) => fs.readFileSync(path.join(__dirname, '../../src/services', f), 'utf8');
  assert.match(ler('socialPostingService.js'), /videoParaRedeService\.prepararParaRede\(/);
  const render = ler('videoEditingService.js');
  assert.match(render, /'-movflags', '\+faststart',\s*\n\s*'-use_editlist', '0',\s*\n\s*outputPath,/);
});
