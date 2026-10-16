// O ffmpeg pode repetir o mesmo erro sem parar - com uma imagem de entrada
// quebrada em loop, ~3 MB de mensagens por segundo (visto na VPS em
// 16/10/2026). As rotinas de corte guardavam TODA a saída num texto, e passar
// do limite de texto do Node ("RangeError: Invalid string length") derrubava o
// processo inteiro de vídeos. Agora só o final é guardado.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-ffmpeg-verboso-'));
// ffmpeg falso: 600 MB de erro repetido (acima do limite de ~512 milhões de
// caracteres de um texto do Node), uma última linha reconhecível, e falha.
fs.writeFileSync(
  path.join(pasta, 'ffmpeg'),
  `#!/bin/sh\nyes "[mjpeg] No JPEG data found in image" | head -c 600000000 >&2\necho "ULTIMA-LINHA-DO-ERRO" >&2\nexit 1\n`,
  { mode: 0o755 }
);
process.env.FFMPEG_PATH = path.join(pasta, 'ffmpeg');

const videoEditingService = require('../../src/services/videoEditingService');

test.after(() => {
  fs.rmSync(pasta, { recursive: true, force: true });
  delete process.env.FFMPEG_PATH;
});

test('ffmpeg que despeja 600 MB de erro falha com a mensagem do fim, sem derrubar o processo', async () => {
  await assert.rejects(
    () => videoEditingService.runFfmpeg(['-i', 'entrada.mp4', path.join(pasta, 'saida.mp4')]),
    (err) => {
      assert.match(err.message, /ULTIMA-LINHA-DO-ERRO/);
      assert.ok(err.message.length < 2000, 'a mensagem leva só o final');
      return true;
    }
  );
});

test('o mesmo vale pro corte com barra de progresso', async () => {
  await assert.rejects(
    () => videoEditingService.runFfmpegWithProgress(['-i', 'entrada.mp4', path.join(pasta, 'saida2.mp4')], 10, () => {}),
    /ULTIMA-LINHA-DO-ERRO/
  );
});
