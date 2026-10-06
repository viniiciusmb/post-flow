// A transcricao enviada a IA marca o tempo em SEGUNDOS, a mesma unidade da
// resposta (startSeconds/endSeconds).
//
// Era "MM:SS", e a IA as vezes lia "12:34" como 1234 segundos. Medido em
// 06/10/2026 com a transcricao real de um video de 2803 s: o prompt antigo
// devolveu trechos em 23003 s e 17005 s (descartados) e os que sobraram
// estavam em posicoes lidas errado; o novo devolveu todos dentro do video.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { formatTranscriptForPrompt } = require('../../src/services/claudeClipSelectionService');

test('a marcacao de tempo da transcricao e em segundos, nunca minuto:segundo', () => {
  const words = [
    { word: 'oi', start: 0, end: 1 },
    { word: 'tudo', start: 754.4, end: 755 },
  ];
  const texto = formatTranscriptForPrompt(words);
  assert.match(texto, /^\[0s\] oi/m);
  assert.match(texto, /^\[754s\] tudo/m);
  assert.doesNotMatch(texto, /\d+:\d{2}/);
});
