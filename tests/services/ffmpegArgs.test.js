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
function argumentosDe(settings, extras = {}) {
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
      ...extras,
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

// ---------- taxa de quadros quando entra imagem parada ----------
//
// Bug real de produção, 22/08/2026. Um corte de 106s com "frame do vídeo" na
// faixa gerou 31.247 quadros para 1,3 SEGUNDO de saída (dup_frames=31.176,
// speed=0,0034x): renderizar levaria 8h30, sem erro nenhum no log — só um
// ffmpeg rodando pra sempre. O vídeo era 23,976 fps (24000/1001) e a imagem,
// 30. O vstack casa os dois lados por TIMESTAMP, e quando as taxas não batem
// ele emite um quadro para cada instante da união das duas.
//
// A correção é alinhar as pontas antes de empilhar. Medido na VPS depois:
// mesmo trecho de 3s renderizou em 5,8s com os 90 quadros certos.
//
// O que estes testes travam:
//   - filtro com imagem alinha as duas pontas;
//   - a saída fica com taxa fixa (rede de segurança);
//   - corte SEM imagem não é forçado a 30 (senão um 60 fps perde metade).

function filtroDe(args) {
  const i = args.indexOf('-filter_complex');
  return i === -1 ? args[args.indexOf('-vf') + 1] || '' : args[i + 1];
}

test('faixa de imagem: as duas pontas entram no vstack com a mesma taxa', async () => {
  const capa = path.join(os.tmpdir(), `capa-${Date.now()}.jpg`);
  fs.writeFileSync(capa, 'imagem de mentira');
  try {
    const args = await argumentosDe({
      ...SEM_LEGENDA,
      crop_style_mode: 'manual',
      background_style: 'thumbnail',
      background_video_height_percent: 66,
      background_band_position: 'top',
    }, { thumbnailImagePath: capa });

    const filtro = filtroDe(args);
    assert.ok(filtro.includes('vstack'), 'a faixa deveria ser montada com vstack');

    const antesDoVstack = filtro.slice(0, filtro.indexOf('vstack'));
    const alinhamentos = antesDoVstack.match(/fps=30/g) || [];
    assert.strictEqual(
      alinhamentos.length,
      2,
      'as DUAS pontas (imagem e vídeo) precisam ser alinhadas antes do vstack — ' +
        'alinhar só uma deixa os timestamps sem casar e o ffmpeg duplica quadro sem parar'
    );

    const posR = args.indexOf('-r');
    assert.ok(posR > args.lastIndexOf('-i'), 'a taxa fixa é opção de SAÍDA, tem que vir depois das entradas');
    assert.strictEqual(args[posR + 1], '30');
  } finally {
    fs.rmSync(capa, { force: true });
  }
});

test('fundo de cor lisa declara a própria taxa', async () => {
  // O filtro `color` gera a 25 fps quando ninguém diz o contrário — que também
  // não bate com um vídeo 23,976 e cairia na mesma armadilha.
  const args = await argumentosDe({
    ...SEM_LEGENDA,
    crop_style_mode: 'manual',
    background_style: 'black',
    background_video_height_percent: 60,
    background_video_offset_percent: 0,
  });

  const filtro = filtroDe(args);
  assert.ok(/color=[^[]*r=30/.test(filtro), `o fundo de cor precisa declarar a taxa: ${filtro}`);
});

test('fundo desfocado NÃO é forçado a 30 — os dois lados já saem do mesmo vídeo', async () => {
  // Aqui as duas metades vêm do mesmo `split`, então os timestamps já batem.
  // Forçar 30 só jogaria fora metade dos quadros de um vídeo 60 fps.
  const args = await argumentosDe({
    ...SEM_LEGENDA,
    crop_style_mode: 'manual',
    background_style: 'blur',
    background_video_height_percent: 60,
    background_video_offset_percent: 0,
  });

  assert.ok(filtroDe(args).includes('split'), 'o fundo desfocado deveria usar split');
  assert.ok(!filtroDe(args).includes('fps=30'), 'não há imagem parada aqui: alinhar seria perda de quadro à toa');
  assert.strictEqual(args.indexOf('-r'), -1, 'sem imagem, a taxa do original tem que ser preservada');
});

test('corte comum, sem fundo nenhum, mantém a taxa do vídeo original', async () => {
  const args = await argumentosDe({ ...SEM_LEGENDA });
  assert.strictEqual(args.indexOf('-r'), -1);
  assert.ok(!filtroDe(args).includes('fps='));
});
