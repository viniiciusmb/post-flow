// Fundo do corte: imagem enviada, preto, branco ou o próprio vídeo desfocado.
//
// Estes testes conferem a STRING do filtro que vai pro ffmpeg. Os quatro
// filtros também foram executados com ffmpeg de verdade na VPS, contra a imagem
// que o cliente enviou, e as cores medidas no resultado confirmaram cada um:
//
//   template  video no topo, arte embaixo   (114,81,79 na base)
//   black     video no topo, preto embaixo  (3,0,4)
//   white     video no topo, branco embaixo (255,253,255)
//   blur      video no topo, borrado embaixo
//
// O que os testes travam aqui é a regra que já quebrou uma vez em produção: o
// vídeo tem que PREENCHER a caixa dimensionada, não "caber dentro" dela.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildBackgroundFilter } = require('../../src/services/videoEditingService');

const QUADRO = { w: 1080, h: 1920, subtitlesFilter: null };

function filtroDe(style, { heightPercent = 66, offsetPercent = 0 } = {}) {
  return buildBackgroundFilter({ ...QUADRO, style, heightPercent, offsetPercent }).filterComplex;
}

test('o vídeo PREENCHE a caixa, nunca cabe dentro dela', () => {
  // Este é o bug que gerou a faixa branca no primeiro corte real: com
  // "decrease", um vídeo 16:9 numa caixa de 1080x1267 virava 1080x762 e
  // sobravam 505px de vazio entre o vídeo e a arte.
  for (const style of ['template', 'black', 'white', 'blur']) {
    const f = filtroDe(style);
    assert.match(f, /scale=1080:1267:force_original_aspect_ratio=increase/, `${style} não preenche a caixa`);
    assert.match(f, /crop=1080:1267/, `${style} não corta o excedente`);
    assert.ok(!f.includes('scale=1080:1267:force_original_aspect_ratio=decrease'), `${style} voltou a "caber dentro"`);
  }
});

test('66% de altura vira 1267px, e não outra conta', () => {
  // 1920 * 0.66 = 1267,2 -> 1267. Se a conta mudar, o vídeo deixa de bater com
  // o que o cliente viu no editor.
  assert.match(filtroDe('black', { heightPercent: 66 }), /1080:1267/);
  assert.match(filtroDe('black', { heightPercent: 50 }), /1080:960/);
  assert.match(filtroDe('black', { heightPercent: 25 }), /1080:480/);
});

test('a posição é medida sobre a sobra, então 50% sempre centraliza', () => {
  // Com 66% de altura sobram 653px; metade disso é 327.
  assert.match(filtroDe('black', { offsetPercent: 0 }), /overlay=\(W-w\)\/2:0/);
  assert.match(filtroDe('black', { offsetPercent: 50 }), /overlay=\(W-w\)\/2:327/);
  assert.match(filtroDe('black', { offsetPercent: 100 }), /overlay=\(W-w\)\/2:653/);

  // E centraliza independentemente da altura escolhida.
  assert.match(filtroDe('black', { heightPercent: 25, offsetPercent: 50 }), /overlay=\(W-w\)\/2:720/);
});

test('cada fundo gera a fonte certa', () => {
  // A imagem vem como segunda entrada do ffmpeg.
  assert.match(filtroDe('template'), /\[1:v\]scale=1080:1920/);

  // Cor lisa sai de um filtro de origem: uma imagem de cor sólida seria um
  // arquivo a mais pra criar, guardar e limpar.
  assert.match(filtroDe('black'), /color=c=black:s=1080x1920/);
  assert.match(filtroDe('white'), /color=c=white:s=1080x1920/);
  assert.ok(!filtroDe('black').includes('[1:v]'), 'fundo liso não pode exigir uma segunda entrada');

  // O desfocado usa o próprio vídeo, então precisa de split - sem ele o ffmpeg
  // recusa, porque [0:v] estaria consumido duas vezes.
  const blur = filtroDe('blur');
  assert.match(blur, /\[0:v\]split=2/);
  assert.match(blur, /boxblur/);
});

test('com o vídeo ocupando a tela inteira, nenhum fundo é gerado', () => {
  // Compor um fundo que fica 100% coberto só gasta processamento.
  for (const style of ['template', 'black', 'white', 'blur']) {
    const f = filtroDe(style, { heightPercent: 100 });
    assert.ok(!f.includes('[fundo]'), `${style} gerou fundo invisível`);
    assert.ok(!f.includes('overlay'), `${style} compôs um fundo que ninguém vê`);
  }
});

test('a legenda entra depois da composição, sobre o quadro final', () => {
  // Se entrasse antes, seria posicionada em relação ao retângulo do vídeo e
  // não ao quadro - e sairia deslocada em qualquer altura menor que 100%.
  const f = buildBackgroundFilter({
    ...QUADRO,
    subtitlesFilter: "subtitles='/tmp/legenda.ass'",
    style: 'black',
    heightPercent: 66,
    offsetPercent: 0,
  }).filterComplex;

  const posOverlay = f.indexOf('overlay=');
  const posLegenda = f.indexOf('subtitles=');
  assert.ok(posLegenda > posOverlay, 'a legenda tem que vir depois do overlay');
});

test('todo filtro termina no rótulo que o render usa pra saída', () => {
  for (const style of ['template', 'black', 'white', 'blur']) {
    for (const heightPercent of [100, 66, 25]) {
      const r = buildBackgroundFilter({ ...QUADRO, style, heightPercent, offsetPercent: 50 });
      assert.equal(r.outputLabel, '[outv]');
      assert.ok(r.filterComplex.includes('[outv]'), `${style}/${heightPercent}% não produz [outv]`);
    }
  }
});
