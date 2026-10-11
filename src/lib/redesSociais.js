// O que cada rede publicada pela Outstand aceita (11/10/2026).
//
// Fonte única dos limites: a fila (que recusa o corte antes de mandar), o feed
// (que avisa antes de enviar) e a tela usam esta tabela. Os números vêm da
// documentação de cada rede na Outstand; onde o fundador escolheu um limite
// menor que o da rede, está anotado.
//
// Ficaram de fora: X, Google Business e Vimeo (exigem credenciais próprias de
// desenvolvedor, BYOK) e Reddit (não aceita vídeo pela Outstand).
'use strict';

const MB = 1024 * 1024;

const REDES = Object.freeze({
  instagram: {
    nome: 'Instagram',
    // Decisão do fundador (08/10 e 11/10/2026): o Instagram aceita Reels de
    // até 15 min, mas o produto publica só até 90 s.
    duracaoMin: 3,
    duracaoMax: 90,
    legendaMax: 2200,
  },
  facebook: { nome: 'Facebook', duracaoMin: 3, duracaoMax: 90, legendaMax: 2200 },
  threads: { nome: 'Threads', duracaoMin: 1, duracaoMax: 300, legendaMax: 500 },
  linkedin: { nome: 'LinkedIn', duracaoMin: 3, duracaoMax: 1800, legendaMax: 3000, bytesMax: 500 * MB },
  pinterest: { nome: 'Pinterest', duracaoMin: 4, duracaoMax: 900, legendaMax: 800, tituloMax: 100, exigePasta: true },
  // O Bluesky aceita no máximo 50 MB por arquivo; corte maior é recomprimido
  // antes do envio (ver videoParaRedeService). Texto: 300 caracteres.
  bluesky: { nome: 'Bluesky', duracaoMin: 1, duracaoMax: 180, legendaMax: 300, bytesMax: 48 * MB },
  // YouTube pela Outstand: o limite de envios é COMPARTILHADO (5 por dia pra
  // todo o Post Flow nas primeiras 20 h do dia do Pacífico, 100 pra todos os
  // clientes da Outstand). Quando não há vaga, o corte espera a próxima em vez
  // de virar erro (ver socialPostingService). Até 3 min sai como Short.
  youtube: { nome: 'YouTube', duracaoMin: 1, duracaoMax: 900, legendaMax: 5000, tituloMax: 100, shortAte: 180 },
});

const LISTA = Object.keys(REDES);

function info(rede) {
  return REDES[rede] || null;
}

// Mensagem de quando o corte não cabe na rede. A do Instagram é a frase que o
// fundador pediu, palavra por palavra.
function motivoDaDuracao(rede, segundos) {
  const r = REDES[rede];
  if (!r) return null;
  const s = Math.round(Number(segundos));
  if (rede === 'instagram' && s > r.duracaoMax) {
    return 'O Instagram só aceita vídeos com menos de 90 segundos, esse vídeo não será publicado no Instagram.';
  }
  if (s > r.duracaoMax + 0.5) {
    return `O ${r.nome} só aceita vídeos de até ${formatarDuracao(r.duracaoMax)}. Este tem ${formatarDuracao(s)} e não será publicado no ${r.nome}.`;
  }
  if (s < r.duracaoMin) {
    return `O ${r.nome} só aceita vídeos a partir de ${r.duracaoMin} segundos. Este tem ${s} s e não será publicado no ${r.nome}.`;
  }
  return null;
}

function formatarDuracao(s) {
  if (s < 120) return `${s} segundos`;
  const min = Math.floor(s / 60);
  const resto = s % 60;
  return resto ? `${min} min ${resto} s` : `${min} minutos`;
}

// Corta o texto no limite da rede sem partir um emoji ou acento combinado no
// meio (o Bluesky conta "graphemes", não bytes).
function cortarTexto(texto, max) {
  const t = String(texto || '');
  if (!max) return t;
  const partes = Array.from(new Intl.Segmenter('pt', { granularity: 'grapheme' }).segment(t), (s) => s.segment);
  if (partes.length <= max) return t;
  return partes.slice(0, Math.max(0, max - 1)).join('').trimEnd() + '…';
}

module.exports = { REDES, LISTA, info, motivoDaDuracao, cortarTexto };
