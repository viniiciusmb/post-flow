// Onde vai o titulo e a legenda nos cortes de live (liveTextoService) e os
// modelos novos de titulo (06/10/2026). O defeito de origem: o titulo no topo
// caia em cima da webcam do streamer (cortes do coringa).
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');

const liveTextoService = require('../../src/services/lives/liveTextoService');
const videoEditingService = require('../../src/services/videoEditingService');
const openaiLives = require('../../src/services/lives/openaiLives');

const PAINEIS_DO_CORINGA = {
  live_formato: {
    tipo: 'paineis',
    paineis: [
      { mostra: 'webcam do streamer', alturaPercent: 30, janelaDaCamera: true },
      { mostra: 'conteudo (tela / vídeo que o streamer assiste)', alturaPercent: 70 },
    ],
  },
};

function trocar(modulo, nome, falsa) {
  const original = modulo[nome];
  modulo[nome] = falsa;
  return () => { modulo[nome] = original; };
}

// Quadro cinza falso 54x96: lisa (0) onde ha "faixa preta", agitada no resto.
function quadroFalso(lisas) {
  const px = Buffer.alloc(54 * 96);
  for (let y = 0; y < 96; y++) {
    const pct = (y / 96) * 100;
    const lisa = lisas.some(([a, b]) => pct >= a && pct < b);
    for (let x = 0; x < 54; x++) px[y * 54 + x] = lisa ? 0 : (x * 37 + y * 11) % 255;
  }
  return px;
}

test('faixa proibida: so a webcam - "video que o streamer assiste" e conteudo', () => {
  assert.deepEqual(liveTextoService.faixasProibidas(PAINEIS_DO_CORINGA), [{ topo: 0, base: 30 }]);
  // Sem a marca janelaDaCamera, o texto livre tambem identifica a camera.
  const semMarca = { live_formato: { tipo: 'paineis', paineis: [{ mostra: 'conteudo', alturaPercent: 60 }, { mostra: 'webcam do streamer', alturaPercent: 40 }] } };
  assert.deepEqual(liveTextoService.faixasProibidas(semMarca), [{ topo: 60, base: 100 }]);
  // Modo "destacar a camera" embaixo.
  assert.deepEqual(liveTextoService.faixasProibidas({ live_webcam: { heightPercent: 35, position: 'bottom' } }), [{ topo: 65, base: 100 }]);
  assert.deepEqual(liveTextoService.faixasProibidas({ live_formato: { tipo: 'quadro_inteiro', paineis: [] } }), []);
});

test('titulo e legenda nunca caem na webcam, o titulo fica acima da legenda e eles nao se cruzam', () => {
  const atividade = new Array(96).fill(0.5);
  const linhas = liveTextoService.custoPorLinha({ atividade, proibidas: [{ topo: 0, base: 30 }], ia: null });
  const e = liveTextoService.escolherPosicoes({ linhas, alturaTitulo: 10, alturaLegenda: 8 });
  assert.ok(e.titulo >= 30, `titulo em ${e.titulo}% caiu na webcam`);
  assert.ok(e.titulo + 10 <= e.legenda, 'titulo precisa ficar acima da legenda sem encostar');
  assert.ok(e.legenda + 8 <= 84, 'legenda nao pode descer pra baixo da interface do TikTok');
});

test('prefere a faixa vazia (barra preta) a cobrir o video', () => {
  const atividade = Array.from({ length: 96 }, (_, y) => ((y / 96) * 100 >= 31 && (y / 96) * 100 < 42 ? 0 : 1));
  const linhas = liveTextoService.custoPorLinha({ atividade, proibidas: [{ topo: 0, base: 30 }], ia: null });
  const e = liveTextoService.escolherPosicoes({ linhas, alturaTitulo: 9, alturaLegenda: 8 });
  assert.ok(e.titulo >= 31 && e.titulo + 9 <= 43, `titulo em ${e.titulo}% devia estar na faixa preta 31-42`);
});

test('rosto marcado pela IA e evitado (onde ha imagem de verdade)', () => {
  const atividade = new Array(96).fill(0.3);
  const ia = { rostos: [{ topo: 35, base: 55 }], acao_principal: [], areas_livres: [] };
  const linhas = liveTextoService.custoPorLinha({ atividade, proibidas: [], ia });
  const e = liveTextoService.escolherPosicoes({ linhas, alturaTitulo: 10, alturaLegenda: 8 });
  const cruza = (topo, alt) => topo < 57 && topo + alt > 33;
  assert.ok(!cruza(e.titulo, 10), `titulo em ${e.titulo}% cobre o rosto`);
  assert.ok(!cruza(e.legenda, 8), `legenda em ${e.legenda}% cobre o rosto`);
});

test('rosto que a IA "ve" numa faixa lisa (barra preta) e ignorado', () => {
  const atividade = Array.from({ length: 96 }, (_, y) => ((y / 96) * 100 >= 30 && (y / 96) * 100 < 44 ? 0 : 1));
  const ia = { rostos: [{ topo: 31, base: 40 }], acao_principal: [{ topo: 30, base: 44 }], areas_livres: [] };
  const linhas = liveTextoService.custoPorLinha({ atividade, proibidas: [{ topo: 0, base: 29 }], ia });
  const e = liveTextoService.escolherPosicoes({ linhas, alturaTitulo: 11, alturaLegenda: 8 });
  assert.ok(e.titulo >= 30 && e.titulo + 11 <= 45, `titulo em ${e.titulo}% devia ir pra faixa preta 30-44`);
});

test('converte a escolha nos campos que o render usa (centro do titulo e base da legenda)', () => {
  const alturas = { alturaTitulo: 10, alturaLegenda: 8, tamanhoTitulo: 76 };
  const r = liveTextoService.paraOsCamposDoEstilo({ tituloTopo: 40, legendaTopo: 70, alturas });
  // O render poe o CENTRO do titulo em margem + 0,6*fonte (centroDoTitulo).
  const centro = videoEditingService.centroDoTitulo(videoEditingService.margemVertical(r.title_height_percent, 8), 76);
  assert.ok(Math.abs(centro / 1920 * 100 - 45) < 1.5, `centro do titulo em ${(centro / 19.2).toFixed(1)}%, esperado ~45%`);
  assert.equal(r.caption_height_percent, 22); // base da legenda em 78% -> 22% da borda de baixo
});

test('posicionar: usa a IA, cobra o custo e diminui o titulo quando ele nao cabe sem encostar', async () => {
  const custos = [];
  const desfazer = [
    // So a faixa 31-38% esta livre: o titulo de 3 linhas no tamanho cheio nao cabe.
    trocar(videoEditingService, 'quadroDoLayoutDeLive', async ({ saidaJpg, saidaCinza }) => {
      fs.writeFileSync(saidaJpg, 'jpg');
      fs.writeFileSync(saidaCinza, quadroFalso([[31, 39]]));
      return { w: 54, h: 96 };
    }),
    trocar(openaiLives, 'pedirJson', async () => ({
      dados: { rostos: [{ topo: 5, base: 25 }, { topo: 40, base: 70 }], acao_principal: [], areas_livres: [{ topo: 31, base: 39 }], titulo_centro: 35, legenda_centro: 76, motivo: 'teste' },
      custoUsd: 0.001,
    })),
  ];
  try {
    const r = await liveTextoService.posicionar({
      videoPath: `/tmp/teste-posicao-${process.pid}.mp4`,
      inicio: 0,
      fim: 30,
      settings: PAINEIS_DO_CORINGA,
      estilo: { title_style: 'destaque_amarelo', caption_style: 'classic' },
      titulo: 'Boto cor-de-rosa apareceu no aniversário do jogador famoso',
      custo: async (kind, resp) => custos.push([kind, resp.custoUsd]),
    });
    assert.deepEqual(custos, [['posicao_texto', 0.001]]);
    assert.equal(r.decisao.fonte, 'ia');
    assert.ok(r.title_scale_percent < 100, 'devia ter diminuido o titulo pra caber na faixa livre');
    assert.ok(r.decisao.tituloTopo >= 30, 'titulo nao pode subir pra webcam');
  } finally {
    desfazer.forEach((f) => f());
  }
});

test('posicionar: sem a IA, decide so pela imagem; sem layout de live, devolve null', async () => {
  const desfazer = [
    trocar(videoEditingService, 'quadroDoLayoutDeLive', async ({ saidaJpg, saidaCinza, settings }) => {
      if (!settings.live_formato && !settings.live_webcam) return null;
      fs.writeFileSync(saidaJpg, 'jpg');
      fs.writeFileSync(saidaCinza, quadroFalso([[32, 45]]));
      return { w: 54, h: 96 };
    }),
    trocar(openaiLives, 'pedirJson', async () => { throw new Error('fora do ar'); }),
  ];
  try {
    const base = { videoPath: `/tmp/teste-posicao2-${process.pid}.mp4`, inicio: 0, fim: 30, estilo: { title_style: 'simples', caption_style: 'classic' }, titulo: 'Titulo curto', custo: async () => {} };
    const r = await liveTextoService.posicionar({ ...base, settings: PAINEIS_DO_CORINGA });
    assert.equal(r.decisao.fonte, 'imagem');
    assert.ok(r.decisao.tituloTopo >= 30);
    assert.equal(await liveTextoService.posicionar({ ...base, settings: {} }), null);
  } finally {
    desfazer.forEach((f) => f());
  }
});

// ------------------------------------------------------------ modelos novos

function ass(titleStyle, extra = {}) {
  return videoEditingService.buildAssSubtitles(
    [{ word: 'oi', start: 0, end: 1 }], 'classic', titleStyle,
    'Comprei um carro de 2 milhões ontem', 4, null, null, 10,
    { titleHeightPercent: 30, titleBoxColor: '#1E90FF', titleFont: 'Anton', ...extra }
  );
}

test('modelos novos existem no render e na lista que o servidor aceita', () => {
  for (const m of ['simples', 'sombra_dura', 'amarelo_fino', 'preto_borda_branca', 'espacado', 'brilho_rosa', 'brilho_azul', 'destaque_amarelo', 'destaque_verde', 'faixa_preta', 'faixa_branca', 'faixa_colorida']) {
    assert.ok(videoEditingService.TITLE_STYLES[m], `falta o modelo ${m}`);
  }
  const migration = fs.readFileSync(require('path').join(__dirname, '..', '..', 'migrations', '101_titulos_novos_e_posicao_do_texto.sql'), 'utf8');
  for (const m of Object.keys(videoEditingService.TITLE_STYLES)) assert.ok(migration.includes(`'${m}'`), `${m} fora do CHECK do banco`);
});

test('destaque pinta o numero; faixa desenha a barra da largura do quadro na cor escolhida', () => {
  assert.match(ass('destaque_amarelo'), /\{\\1c&H00D7FF&\}2\{\\1c&HFFFFFF&\}/);
  const faixa = ass('faixa_colorida');
  assert.match(faixa, /\\p1.*\\1c&HFF901E&.*m 0 0 l 1080 0/);
  // Barra embaixo do texto (camada 0) e texto por cima (camada 1).
  assert.match(faixa, /Dialogue: 0,.*\\p1/);
  assert.match(faixa, /Dialogue: 1,.*Title/);
});

test('brilho usa contorno colorido com blur; simples nao borra a letra', () => {
  assert.match(ass('brilho_rosa'), /\\blur7/);
  assert.match(ass('brilho_rosa'), /Style: Title,Anton,76,&H00FFFFFF,&H000000FF,&H00B469FF/);
  assert.doesNotMatch(ass('simples'), /\\blur/);
});

test('escala do titulo diminui a fonte (o liveTextoService usa quando o espaco e pequeno)', () => {
  assert.match(ass('classic'), /Style: Title,Anton,72,/);
  assert.match(ass('classic', { titleScalePercent: 72 }), /Style: Title,Anton,52,/);
  assert.match(ass('classic', { titleScalePercent: 10 }), /Style: Title,Anton,43,/); // teto minimo de 60%
});
