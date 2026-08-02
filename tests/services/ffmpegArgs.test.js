// Montagem dos argumentos do ffmpeg.
//
// No ffmpeg a POSIÇÃO de um argumento muda o significado dele: `-t` antes de
// um `-i` limita aquela ENTRADA; depois da última entrada, limita a SAÍDA.
//
// Isso já causou um bug real em produção. Enquanto só existia uma entrada, o
// `-t` ficava logo depois do `-i` do vídeo e funcionava como opção de saída
// por acidente de posição. Quando o template de fundo entrou como segunda
// entrada, o mesmo `-t` passou a limitar a IMAGEM, e a saída ficou sem limite:
// cada "corte" era renderizado com o VÍDEO INTEIRO por baixo do template.
// O resultado foram cortes de 150 a 200 MB (maiores que o vídeo original) e
// renderização que nunca terminava.
//
// Estes testes leem os argumentos gerados sem precisar de ffmpeg instalado.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

// Captura os argumentos interceptando o spawn, e devolve sem executar nada.
function argumentosDe(settings) {
  const cp = require('child_process');
  const spawnOriginal = cp.spawn;
  let capturados = null;

  cp.spawn = (cmd, args) => {
    capturados = args;
    // Um filho de mentira que "fecha" na hora, pra renderClip resolver.
    const { EventEmitter } = require('events');
    const filho = new EventEmitter();
    filho.stderr = new EventEmitter();
    filho.stdout = new EventEmitter();
    filho.kill = () => {};
    setImmediate(() => filho.emit('close', 0));
    return filho;
  };

  // Recarrega o serviço com o spawn trocado.
  delete require.cache[require.resolve('../../src/services/videoEditingService')];
  const service = require('../../src/services/videoEditingService');

  const saida = path.join(os.tmpdir(), `saida-${Date.now()}.mp4`);
  return service
    .renderClip({
      videoPath: '/tmp/entrada.mp4',
      startSeconds: 10,
      endSeconds: 50, // duração de 40s
      words: [],
      title: 'Título',
      outputPath: saida,
      settings,
      partIndex: 1,
      partTotal: 1,
    })
    .then(
      () => capturados,
      () => capturados
    )
    .finally(() => {
      cp.spawn = spawnOriginal;
      fs.rmSync(saida, { force: true });
      delete require.cache[require.resolve('../../src/services/videoEditingService')];
    });
}

const SEM_LEGENDA = { caption_style: 'none', show_title: false };

test('sem template, a duração limita a saída', async () => {
  const args = await argumentosDe({ ...SEM_LEGENDA });
  const posT = args.indexOf('-t');
  const ultimaEntrada = args.lastIndexOf('-i');

  assert.ok(posT > ultimaEntrada, '-t precisa vir depois de todas as entradas pra limitar a saída');
  assert.strictEqual(args[posT + 1], '40', 'a duração tem que ser a do corte, não a do vídeo');
});

test('COM template, a duração continua limitando a saída (e não a imagem)', async () => {
  // Este é o teste que pega a regressão. Com o template há duas entradas, e um
  // `-t` mal posicionado limita a imagem em vez do vídeo: o corte sai com o
  // vídeo inteiro.
  const template = path.join(os.tmpdir(), `tpl-${Date.now()}.png`);
  fs.writeFileSync(template, 'imagem de mentira');
  try {
    const args = await argumentosDe({
      ...SEM_LEGENDA,
      crop_style_mode: 'manual',
      crop_zoom_percent: 100,
      background_template_path: template,
      background_video_height_percent: 66,
      background_video_offset_percent: 0,
    });

    const posT = args.indexOf('-t');
    const ultimaEntrada = args.lastIndexOf('-i');

    assert.ok(
      posT > ultimaEntrada,
      'com template, -t ANTES da última entrada limita a imagem e deixa a saída sem limite: ' +
        'o corte sai com o vídeo inteiro (150+ MB)'
    );
    assert.strictEqual(args[posT + 1], '40');
    // O template precisa mesmo estar entrando como segunda entrada.
    assert.ok(args.includes(template), 'o template deveria ser a segunda entrada');
    // args ficam ['-loop','1','-i',template], entao o -loop esta 3 posicoes antes.
    assert.strictEqual(args[args.indexOf(template) - 3], '-loop', 'imagem parada precisa de -loop 1');
  } finally {
    fs.rmSync(template, { force: true });
  }
});

test('template que sumiu do disco não derruba o corte', async () => {
  // A retenção pode ter apagado, ou o cliente removeu. Melhor renderizar sem
  // template do que falhar o corte inteiro por causa de uma imagem faltando.
  const args = await argumentosDe({
    ...SEM_LEGENDA,
    crop_style_mode: 'manual',
    crop_zoom_percent: 100,
    background_template_path: '/caminho/que/nao/existe.png',
    background_video_height_percent: 66,
    background_video_offset_percent: 0,
  });

  assert.ok(!args.includes('/caminho/que/nao/existe.png'), 'não pode passar arquivo inexistente pro ffmpeg');
  const posT = args.indexOf('-t');
  assert.ok(posT > args.lastIndexOf('-i'));
});
