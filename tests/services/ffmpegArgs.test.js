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
      background_style: 'template',
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
    // Confere pelo CONTEÚDO e não pela posição: contar posições faz o teste
    // quebrar sempre que uma opção nova entra na mesma entrada (foi o que
    // aconteceu quando -framerate passou a ser obrigatório).
    const antesDaImagem = args.slice(0, args.indexOf(template));
    assert.ok(antesDaImagem.includes('-loop'), 'imagem parada precisa de -loop 1');
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

// A imagem da faixa PRECISA de taxa de quadros.
//
// Sem `-framerate`, a imagem em loop não tem taxa própria e o vstack duplica
// quadro sem parar tentando casar com o vídeo. Medido em produção: 9216
// quadros para 0,19 segundo de saída, a 0,0009x da velocidade normal — o corte
// simplesmente nunca terminava, sem erro nenhum, só um ffmpeg rodando para
// sempre. Com a taxa definida, 360 quadros para 12s em 36 segundos.
//
// Este teste existe porque o sintoma (renderização eterna) é indistinguível de
// "vídeo grande, demora mesmo".
test('a imagem da faixa entra com taxa de quadros definida', async () => {
  const imagem = path.join(os.tmpdir(), `faixa-${Date.now()}.png`);
  fs.writeFileSync(imagem, 'imagem de mentira');
  try {
    const args = await argumentosDe({
      ...SEM_LEGENDA,
      crop_style_mode: 'manual',
      crop_zoom_percent: 100,
      background_style: 'template',
      background_template_path: imagem,
      background_video_height_percent: 65,
      background_video_offset_percent: 50,
    });

    const posImagem = args.indexOf(imagem);
    assert.ok(posImagem > 0, 'a imagem tem que entrar como segunda entrada');

    const antesDaImagem = args.slice(0, posImagem);
    assert.ok(
      antesDaImagem.includes('-framerate'),
      `sem -framerate o corte nunca termina. Argumentos: ${args.join(' ')}`
    );
    // Vem antes do -i da imagem: depois dele viraria opção de saída e não
    // teria efeito nenhum sobre a entrada.
    assert.ok(
      antesDaImagem.lastIndexOf('-framerate') < antesDaImagem.lastIndexOf('-i'),
      'a taxa precisa vir antes do -i da imagem'
    );
  } finally {
    fs.rmSync(imagem, { force: true });
  }
});
