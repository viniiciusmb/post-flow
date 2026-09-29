// Linha do tempo de SINAIS do publico, em janelas de 10s da gravacao:
// ritmo do chat, risadas, reacoes, clipes criados pelos espectadores e picos
// de volume. E o que faltou no primeiro teste real (28/09/2026): a IA so via
// texto e nao sabia onde o publico tinha reagido.
//
// Tudo e comparado com o NORMAL daquela live (mediana), nao com um numero
// fixo: 40 mensagens em 10s e barulho numa live de 50 mil pessoas e explosao
// numa de 500.
'use strict';

const livesRepository = require('../../repositories/livesRepository');

const JANELA_S = 10;
// O chat reage DEPOIS de ver o momento: digitar leva uns segundos. O momento
// fica ~5s antes da mensagem.
const ATRASO_DO_CHAT_S = 5;
// Quanto antes do pico o corte comeca (a preparacao do momento) e quanto
// depois termina (a reacao).
const ANTES_DO_PICO_S = 40;
const DEPOIS_DO_PICO_S = 10;

function mediana(valores) {
  const v = valores.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return 0;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

// Converte hora de relogio (ms) em segundos da gravacao, usando a hora em que
// cada pedaco de video fechou. Evento que cai numa pausa de anuncio (relogio
// andou, gravacao nao) vai pro ponto em que a gravacao retomou.
function relogioParaGravacao(pedacos) {
  return (ms) => {
    if (!pedacos.length) return null;
    let anterior = null;
    for (const p of pedacos) {
      if (p.fechouEm >= ms) {
        const estimado = p.fim - (p.fechouEm - ms) / 1000;
        return anterior ? Math.max(anterior.fim, estimado) : Math.max(0, estimado);
      }
      anterior = p;
    }
    const ultimo = pedacos[pedacos.length - 1];
    return ultimo.fim + (ms - ultimo.fechouEm) / 1000;
  };
}

// Monta as janelas de 10s de [0, ate) com os sinais somados em cada uma.
function montarLinhaDoTempo(fontes, ate) {
  const n = Math.max(0, Math.ceil(ate / JANELA_S));
  const janelas = Array.from({ length: n }, (_, i) => ({
    inicio: i * JANELA_S,
    msgs: 0,
    risadas: 0,
    hype: 0,
    clipes: [],
    volumeMax: null,
  }));
  const paraGravacao = relogioParaGravacao(fontes.pedacos);
  const janelaDe = (offset) => (offset === null || offset < 0 || offset >= ate ? null : janelas[Math.floor(offset / JANELA_S)]);

  for (const b of fontes.chat) {
    const j = janelaDe(paraGravacao(b.em) - ATRASO_DO_CHAT_S);
    if (!j) continue;
    j.msgs += b.msgs;
    j.risadas += b.risadas;
    j.hype += b.hype;
  }
  // Um clipe de espectador cobre os "duracao" segundos ANTES de ele clicar.
  for (const c of fontes.clipes) {
    const fim = paraGravacao(c.em);
    if (fim === null) continue;
    const inicio = fim - c.duracao;
    for (const j of janelas) {
      if (j.inicio < fim && j.inicio + JANELA_S > inicio) j.clipes.push(c);
    }
  }
  for (const bloco of fontes.volume) {
    (bloco.porSegundo || []).forEach((v, s) => {
      const j = janelaDe(bloco.inicio + s);
      if (j && Number.isFinite(v) && v > -70) j.volumeMax = j.volumeMax === null ? v : Math.max(j.volumeMax, v);
    });
  }

  const base = {
    msgs: mediana(janelas.map((j) => j.msgs)),
    risadas: mediana(janelas.map((j) => j.risadas)),
    volume: mediana(janelas.map((j) => j.volumeMax).filter((v) => v !== null)),
  };
  for (const j of janelas) {
    j.chatX = j.msgs / Math.max(1, base.msgs);
    j.risadasX = j.risadas / Math.max(1, base.risadas);
    j.volumeAcima = j.volumeMax === null || !base.volume ? 0 : j.volumeMax - base.volume;
    // Forca do sinal: clipe de espectador pesa mais (alguem parou pra clipar),
    // depois risada e chat acima do normal, e o grito por ultimo (musica alta
    // tambem gera pico de volume).
    j.forca =
      2 * new Set(j.clipes).size +
      Math.max(0, j.chatX - 1.5) +
      (j.risadas >= 3 ? Math.max(0, j.risadasX - 1.5) : 0) +
      (j.volumeAcima >= 12 ? 1 : 0);
  }
  return { janelas, base };
}

function ehPico(j) {
  return (
    j.clipes.length > 0 ||
    (j.chatX >= 2.5 && j.msgs >= 5) ||
    (j.risadas >= 4 && j.risadasX >= 3) ||
    j.volumeAcima >= 12
  );
}

// Descricao em portugues do que aconteceu num trecho - e o que o juiz le.
function descrever(janelas) {
  if (!janelas.length) return 'sem sinal do publico';
  const msgs = Math.max(...janelas.map((j) => j.msgs));
  const chatX = Math.max(...janelas.map((j) => j.chatX));
  const risadas = janelas.reduce((s, j) => s + j.risadas, 0);
  const hype = janelas.reduce((s, j) => s + j.hype, 0);
  const clipes = [...new Set(janelas.flatMap((j) => j.clipes))];
  const volume = Math.max(...janelas.map((j) => j.volumeAcima));
  const partes = [];
  if (chatX >= 1.5) partes.push(`chat ${chatX.toFixed(1)}x o normal (${msgs} msgs em 10s)`);
  if (risadas) partes.push(`${risadas} risada(s) no chat`);
  if (hype) partes.push(`${hype} reacao(oes) de surpresa/hype`);
  if (clipes.length) partes.push(`${clipes.length} clipe(s) criado(s) por espectadores (${clipes.slice(0, 3).map((c) => `"${c.titulo}"`).join(', ')})`);
  if (volume >= 8) partes.push(`pico de volume +${volume.toFixed(0)} dB acima do normal`);
  return partes.length ? partes.join('; ') : 'publico em ritmo normal';
}

// Picos da linha do tempo ate "ate", agrupados (janelas de pico a ate 20s uma
// da outra sao o mesmo momento) e transformados em intervalos de corte.
function picos(linha, ate) {
  const eventos = [];
  let atual = null;
  for (const j of linha.janelas) {
    if (!ehPico(j)) continue;
    if (atual && j.inicio - atual.fim <= 20) {
      atual.fim = j.inicio + JANELA_S;
      atual.janelas.push(j);
    } else {
      atual = { inicio: j.inicio, fim: j.inicio + JANELA_S, janelas: [j] };
      eventos.push(atual);
    }
  }
  return eventos.map((e) => {
    const maisForte = e.janelas.reduce((a, b) => (b.forca > a.forca ? b : a));
    const inicio = Math.max(0, Math.min(e.inicio, maisForte.inicio) - ANTES_DO_PICO_S);
    const fim = Math.min(ate, Math.max(e.fim, maisForte.inicio + JANELA_S) + DEPOIS_DO_PICO_S);
    return {
      inicio,
      fim: Math.min(fim, inicio + 90),
      forca: Math.round(e.janelas.reduce((s, j) => s + j.forca, 0) * 10) / 10,
      descricao: descrever(e.janelas),
    };
  });
}

// Linha do tempo pronta de uma sessao, ate "ate" segundos.
async function linhaDaSessao(sessionId, ate) {
  const fontes = await livesRepository.signalSources(sessionId);
  return montarLinhaDoTempo(fontes, ate);
}

// Resumo dos sinais num intervalo, pro texto que a IA le.
function resumoDoIntervalo(linha, inicio, fim) {
  return descrever(linha.janelas.filter((j) => j.inicio < fim && j.inicio + JANELA_S > inicio));
}

module.exports = {
  linhaDaSessao,
  montarLinhaDoTempo,
  relogioParaGravacao,
  picos,
  ehPico,
  descrever,
  resumoDoIntervalo,
  mediana,
  JANELA_S,
  ATRASO_DO_CHAT_S,
};
