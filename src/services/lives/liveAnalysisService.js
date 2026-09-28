// Triagem e selecao dos momentos da live - as duas etapas de IA baratas.
//
//   triagem: a cada ~2 min de live transcrita, o modelo le os ULTIMOS 5 min
//            (com volume e silencio de cada bloco) e aponta candidatos.
//   selecao: a cada ~10 min, e uma ultima vez quando a live acaba, o mesmo
//            modelo revisa os candidatos pendentes com mais contexto e escolhe
//            os melhores - no maximo "cortesPorHora" por hora gravada - ja com
//            o corte exato, titulo e gancho.
//
// Primeira medicao (28/09/2026): o modelo e GENEROSO na triagem (deu 8/10 pra
// uma apresentacao banal). Por isso o corte de verdade acontece na selecao,
// com instrucao mais dura, e a triagem so filtra o obvio (nota < 6 nem entra).
'use strict';

const livesRepository = require('../../repositories/livesRepository');
const openaiLives = require('./openaiLives');
const logger = require('../../lib/logger');

const PASSO_TRIAGEM_S = 120;
const JANELA_TRIAGEM_S = 300;
const INTERVALO_SELECAO_MS = 10 * 60_000;
const DURACAO_MIN = 15;
const DURACAO_MAX = 90;
const NOTA_MINIMA_TRIAGEM = 6;
const NOTA_MINIMA_SELECAO = 7;

function mmss(segundos) {
  const s = Math.max(0, Math.round(segundos));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`;
}

// Texto que o modelo le: uma linha por bloco, com o tempo em SEGUNDOS da
// gravacao (e o eixo em que a resposta tem que vir) e os sinais de audio.
// Volume alto e o sinal barato de "aconteceu algo" (grito, risada, susto) que
// funciona mesmo em live pequena sem chat.
function montarTranscricao(blocos) {
  return blocos
    .map((b) => {
      const ini = Number(b.start_offset);
      const fim = Number(b.end_offset);
      const sinais = [];
      if (b.loudness_lufs !== null && b.loudness_lufs !== undefined) sinais.push(`volume ${Number(b.loudness_lufs).toFixed(0)} LUFS`);
      if (b.peak_db !== null && b.peak_db !== undefined) sinais.push(`pico ${Number(b.peak_db).toFixed(0)} dB`);
      const texto = b.status === 'silencio' ? '(silencio)' : b.status === 'erro' ? '(nao transcrito)' : b.text || '';
      return `[${ini.toFixed(0)}s-${fim.toFixed(0)}s | ${mmss(ini)}] (${sinais.join(', ') || 'sem medida'}) ${texto}`;
    })
    .join('\n');
}

// Puxa o intervalo pra dentro dos limites: dentro da janela analisada e entre
// 15 e 90 segundos. Corte de 5s ou de 5 minutos nao serve pra nada, e a IA as
// vezes devolve os dois.
function ajustarIntervalo(inicio, fim, { min, max }) {
  let a = Math.max(min, Number(inicio));
  let b = Math.min(max, Number(fim));
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return null;
  if (b - a > DURACAO_MAX) b = a + DURACAO_MAX;
  if (b - a < DURACAO_MIN) {
    const falta = DURACAO_MIN - (b - a);
    a = Math.max(min, a - falta / 2);
    b = Math.min(max, a + DURACAO_MIN);
    if (b - a < DURACAO_MIN) return null;
  }
  return { inicio: Math.round(a * 10) / 10, fim: Math.round(b * 10) / 10 };
}

function sobreposicao(a, b) {
  const inter = Math.max(0, Math.min(a.fim, b.fim) - Math.max(a.inicio, b.inicio));
  return inter / Math.min(a.fim - a.inicio, b.fim - b.inicio);
}

const SCHEMA_TRIAGEM = {
  type: 'object',
  additionalProperties: false,
  required: ['candidatos'],
  properties: {
    candidatos: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['inicio_s', 'fim_s', 'motivo', 'nota'],
        properties: {
          inicio_s: { type: 'number' },
          fim_s: { type: 'number' },
          motivo: { type: 'string' },
          nota: { type: 'integer' },
        },
      },
    },
  },
};

const SISTEMA_TRIAGEM = `Voce analisa a transcricao de uma live (Twitch) em tempo real para achar trechos que viram bons cortes curtos para TikTok/Reels/Shorts.
Cada linha e um bloco de ~30s: [inicio-fim em segundos da gravacao] (volume e pico do audio) texto.
Um bom candidato: reacao forte (grito, risada, susto, raiva), jogada ou acontecimento surpreendente, opiniao polemica, historia engracada com desfecho, fala marcante que se entende sem contexto.
Volume ou pico bem acima do resto costuma indicar que algo aconteceu.
NAO sao candidatos: conversa morna, leitura de chat sem graca, pedidos de inscricao/doacao, silencio, trechos que so fazem sentido com o que veio antes.
Tempos em SEGUNDOS da gravacao, dentro do trecho mostrado. Duracao de 15 a 90 segundos.
Nota de 0 a 10, sendo rigoroso: 5 = mediano, 8+ = excelente. Se nada presta, devolva a lista vazia.`;

async function triarSessao(sessao) {
  const cobertura = await livesRepository.transcriptCoverage(sessao.id);
  const jaTriado = Number(sessao.triaged_until);
  const encerrada = sessao.status !== 'gravando';
  // Espera acumular 2 min de texto novo; com a live encerrada, tria o resto
  // mesmo que seja pouco (senao o fim da live nunca seria olhado).
  if (cobertura - jaTriado < (encerrada ? 1 : PASSO_TRIAGEM_S)) return 0;

  const inicioJanela = Math.max(0, cobertura - JANELA_TRIAGEM_S);
  const blocos = await livesRepository.transcriptsBetween(sessao.id, inicioJanela, cobertura);
  // Janela sem fala nenhuma (so silencio): marca como vista sem gastar
  // chamada. Com fala, so marca DEPOIS que a IA respondeu - uma falha da API
  // nao pode fazer esses 2 minutos da live nunca serem olhados.
  if (!blocos.some((b) => b.status === 'feito' && (b.text || '').trim())) {
    await livesRepository.setTriagedUntil(sessao.id, cobertura);
    return 0;
  }

  const resposta = await openaiLives.pedirJson({
    nome: 'triagem_live',
    sistema: SISTEMA_TRIAGEM,
    usuario: `Canal: ${sessao.login}. Titulo da live: ${sessao.title || '(sem titulo)'}. Jogo/categoria: ${sessao.game_name || '-'}.\n\n${montarTranscricao(blocos)}`,
    schema: SCHEMA_TRIAGEM,
  });
  await livesRepository.setTriagedUntil(sessao.id, cobertura);
  await livesRepository.recordCost({
    channelId: sessao.live_channel_id,
    sessionId: sessao.id,
    kind: 'triagem',
    inputTokens: resposta.inputTokens,
    outputTokens: resposta.outputTokens,
    custoUsd: resposta.custoUsd,
  });

  const existentes = (await livesRepository.candidatesForSession(sessao.id)).map((c) => ({
    inicio: Number(c.start_offset),
    fim: Number(c.end_offset),
  }));
  let novos = 0;
  for (const c of resposta.dados.candidatos || []) {
    const nota = Math.max(0, Math.min(10, Math.round(Number(c.nota))));
    if (nota < NOTA_MINIMA_TRIAGEM) continue;
    const intervalo = ajustarIntervalo(c.inicio_s, c.fim_s, { min: inicioJanela, max: cobertura });
    if (!intervalo) continue;
    // A janela de 5 min anda de 2 em 2 min, entao o mesmo momento aparece em
    // ate tres triagens seguidas. Mais da metade em cima de um que ja existe =
    // e o mesmo momento.
    if (existentes.some((e) => sobreposicao(e, intervalo) > 0.5)) continue;
    await livesRepository.insertCandidate({
      sessionId: sessao.id,
      source: 'triagem',
      inicio: intervalo.inicio,
      fim: intervalo.fim,
      motivo: String(c.motivo || '').slice(0, 300),
      nota,
    });
    existentes.push(intervalo);
    novos += 1;
  }
  return novos;
}

const SCHEMA_SELECAO = {
  type: 'object',
  additionalProperties: false,
  required: ['escolhidos'],
  properties: {
    escolhidos: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'inicio_s', 'fim_s', 'titulo', 'gancho', 'nota'],
        properties: {
          id: { type: 'integer' },
          inicio_s: { type: 'number' },
          fim_s: { type: 'number' },
          titulo: { type: 'string' },
          gancho: { type: 'string' },
          nota: { type: 'integer' },
        },
      },
    },
  },
};

function sistemaSelecao(maximo) {
  return `Voce e um editor exigente de cortes de live para TikTok/Reels/Shorts. Recebe candidatos (com o trecho da transcricao ao redor de cada um) e escolhe NO MAXIMO ${maximo}.
Escolha so o que prende nos 3 primeiros segundos e se entende sem ter visto a live. Na duvida, deixe de fora: e melhor nenhum corte do que um corte fraco.
Para cada escolhido:
- ajuste inicio_s e fim_s (segundos da gravacao) para comecar no gancho e terminar logo depois do desfecho, entre 15 e 90 segundos;
- titulo curto (ate 60 caracteres) no MESMO idioma da fala, sem hashtag, sem aspas;
- gancho: uma frase curta (ate 100 caracteres) para a legenda da postagem, no mesmo idioma;
- nota final de 0 a 10, rigorosa.
Use o id do candidato exatamente como veio.`;
}

async function selecionarSessao(sessao, { cortesPorHora, agora = Date.now() }) {
  const encerrada = sessao.status !== 'gravando';
  const ultima = sessao.last_selection_at ? new Date(sessao.last_selection_at).getTime() : 0;
  if (!encerrada && agora - ultima < INTERVALO_SELECAO_MS) return 0;

  const pendentes = await livesRepository.pendingCandidates(sessao.id, 15);
  await livesRepository.markSelection(sessao.id);
  if (!pendentes.length) {
    if (encerrada) await livesRepository.discardStaleCandidates(sessao.id, { tudo: true });
    return 0;
  }

  // Teto proporcional ao tempo gravado: 5 por hora numa live de 3h sao 15 no
  // total, nao 15 na primeira meia hora. A primeira hora conta inteira, senao
  // a primeira selecao (aos 10 min) teria teto zero.
  const horas = Math.max(1, Number(sessao.recorded_seconds) / 3600);
  const teto = Math.floor(cortesPorHora * horas);
  const vagas = teto - (await livesRepository.countChosenFromTriage(sessao.id));
  if (vagas <= 0) {
    await livesRepository.discardStaleCandidates(sessao.id, { tudo: encerrada });
    return 0;
  }

  const gravado = Number(sessao.recorded_seconds);
  const partes = [];
  for (const c of pendentes) {
    const ini = Number(c.start_offset);
    const fim = Number(c.end_offset);
    const contexto = await livesRepository.transcriptsBetween(sessao.id, Math.max(0, ini - 30), fim + 30);
    partes.push(`### Candidato id=${c.id} (${ini.toFixed(0)}s-${fim.toFixed(0)}s, nota da triagem ${c.score}): ${c.reason || ''}\n${montarTranscricao(contexto)}`);
  }

  const resposta = await openaiLives.pedirJson({
    nome: 'selecao_live',
    sistema: sistemaSelecao(vagas),
    usuario: `Canal: ${sessao.login}. Titulo da live: ${sessao.title || '(sem titulo)'}.\n\n${partes.join('\n\n')}`,
    schema: SCHEMA_SELECAO,
  });
  await livesRepository.recordCost({
    channelId: sessao.live_channel_id,
    sessionId: sessao.id,
    kind: 'selecao',
    inputTokens: resposta.inputTokens,
    outputTokens: resposta.outputTokens,
    custoUsd: resposta.custoUsd,
  });

  const porId = new Map(pendentes.map((c) => [Number(c.id), c]));
  const seguidores = await livesRepository.activeFollowerIds(sessao.live_channel_id);
  const escolhidos = [];
  const vistos = new Set();
  const ordenados = [...(resposta.dados.escolhidos || [])].sort((a, b) => b.nota - a.nota);
  for (const e of ordenados) {
    if (escolhidos.length >= vagas) break;
    const cand = porId.get(Number(e.id));
    // Id inventado ou repetido pela IA: ignora, nao cria corte do nada.
    if (!cand || vistos.has(cand.id)) continue;
    const nota = Math.max(0, Math.min(10, Math.round(Number(e.nota))));
    if (nota < NOTA_MINIMA_SELECAO) continue;
    // O ajuste fino pode andar ate 30s pra fora do candidato, nunca alem do
    // que ja esta gravado.
    const intervalo = ajustarIntervalo(e.inicio_s, e.fim_s, {
      min: Math.max(0, Number(cand.start_offset) - 30),
      max: Math.min(gravado || Infinity, Number(cand.end_offset) + 30),
    });
    if (!intervalo) continue;
    vistos.add(cand.id);
    escolhidos.push(Number(cand.id));
    for (const userId of seguidores) {
      await livesRepository.insertClip({
        sessionId: sessao.id,
        channelId: sessao.live_channel_id,
        userId,
        candidateId: cand.id,
        source: 'triagem',
        inicio: intervalo.inicio,
        fim: intervalo.fim,
        titulo: String(e.titulo || '').slice(0, 80),
        gancho: String(e.gancho || '').slice(0, 150),
        nota,
      });
    }
  }
  await livesRepository.setCandidateStatus(escolhidos, 'escolhido');
  await livesRepository.discardStaleCandidates(sessao.id, { tudo: encerrada });
  if (escolhidos.length) logger.info(`Lives: ${escolhidos.length} corte(s) escolhido(s) na sessao ${sessao.id} (${sessao.login}).`);
  return escolhidos.length;
}

module.exports = {
  triarSessao,
  selecionarSessao,
  montarTranscricao,
  ajustarIntervalo,
  sobreposicao,
  PASSO_TRIAGEM_S,
  JANELA_TRIAGEM_S,
  NOTA_MINIMA_TRIAGEM,
  NOTA_MINIMA_SELECAO,
};
