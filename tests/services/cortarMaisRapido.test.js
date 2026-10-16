// O corte era o gargalo da VPS (16/10/2026). Duas mudanças, medidas na VPS com
// cortes reais de clientes antes de entrar, e conferidas quadro a quadro:
//   - preset 'veryfast' em vez de 'medium': metade da CPU, mesma qualidade,
//     arquivo igual ou menor;
//   - fundo desfocado borrado em 1/4 do tamanho e ampliado: 7x menos CPU, o
//     mesmo borrão.
// Este teste trava as duas, pra ninguém voltar ao jeito lento sem perceber.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const videoEditingService = require('../../src/services/videoEditingService');

test('o corte usa o preset rápido, com a mesma qualidade (CRF 20)', () => {
  assert.equal(videoEditingService.RENDER.preset, 'veryfast');
  assert.equal(videoEditingService.RENDER.crf, 20);
});

test('o fundo desfocado do YouTube é borrado pequeno e ampliado', () => {
  const { filterComplex } = videoEditingService.buildBackgroundFilter({ w: 1080, h: 1920, style: 'blur', heightPercent: 66, offsetPercent: 50 });
  assert.match(filterComplex, /scale=270:480:force_original_aspect_ratio=increase,crop=270:480,boxblur=5:4,scale=1080:1920/);
  assert.doesNotMatch(filterComplex, /boxblur=18/, 'borrar em 1080x1920 gastava um núcleo inteiro só no fundo');
});

test('o "quadro inteiro" das lives também', () => {
  const r = videoEditingService.buildFilter({
    w: 1080,
    h: 1920,
    subtitlesFilter: null,
    fundo: { style: 'formato_ia', formato: { tipo: 'quadro_inteiro', paineis: [] } },
  });
  assert.match(r.filterComplex, /crop=270:480,boxblur=5:4,scale=1080:1920/);
  assert.doesNotMatch(r.filterComplex, /boxblur=18/);
});
