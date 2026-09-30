// Como a live vira candidatos, e candidatos viram cortes.
//
// Versao 2 (depois do primeiro teste real, 28/09/2026, em que os momentos
// sairam fracos - o nano sozinho, lendo so texto, deu nota 7 pra quase todo
// trecho de 30s):
//
//   1. triagem (gpt-5-nano, barato, a cada ~2 min): le os ultimos 5 min de
//      transcricao JA COM os sinais do publico de cada bloco e aponta no
//      maximo 2 candidatos;
//   2. picos de sinal (sem IA): onde o chat explodiu, riu, alguem clipou ou
//      alguem gritou - cada pico vira um candidato;
//   3. juiz (gpt-5-mini, a cada ~5 min e no fim da live): le cada candidato
//      com o texto ao redor e os sinais, e da a nota FINAL com criterio duro,
//      o trecho, titulo e gancho. Avaliado uma vez por canal;
//   4. distribuicao: cada usuario que acompanha o canal recebe os aprovados
//      que passam no NIVEL DE QUALIDADE dele (nota minima e teto por hora).
'use strict';

const livesRepository = require('../../repositories/livesRepository');
const openaiLives = require('./openaiLives');
const liveSignalsService = require('./liveSignalsService');
const livesUserSettings = require('./livesUserSettings');
const tiposDeMomento = require('./tiposDeMomento');
const logger = require('../../lib/logger');

const PASSO_TRIAGEM_S = 120;
const JANELA_TRIAGEM_S = 300;
const INTERVALO_JUIZ_MS = 5 * 60_000;
const DURACAO_MIN = 15;
const DURACAO_MAX = 90;
// A triagem so descarta o obvio; o corte de verdade e do juiz.
const NOTA_MINIMA_TRIAGEM = 6;
// Abaixo disto o juiz reprova pra todo mundo (nem o nivel 1 aceita).
const NOTA_MINIMA_APROVADO = 5;
const CANDIDATOS_POR_JULGAMENTO = 12;

// Tetos da nota final a partir das notas por partes - garantidos aqui, nao so
// pedidos: no teste de 29/09 o juiz deu 9 a cortes sem desfecho.
function aplicarTetos(a) {
  let nota = Math.max(0, Math.min(10, Math.round(Number(a.nota))));
  if (a.entende_sozinho === false) nota = Math.min(nota, 5);
  if (Number(a.desfecho_claro) < 6) nota = Math.min(nota, 6);
  if (Number(a.gancho_forte) < 6) nota = Math.min(nota, 7);
  return nota;
}

function mmss(segundos) {
  const s = Math.max(0, Math.round(segundos));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`;
}

// Uma linha por bloco: tempo em SEGUNDOS da gravacao (o eixo da resposta),
// sinais do publico naquele trecho, pistas da propria fala (dinheiro com
// numero, compra, palavrao - o que viraliza pelo CONTEUDO mesmo sem o chat
// reagir) e o texto.
function montarTranscricao(blocos, linha = null) {
  return blocos
    .map((b) => {
      const ini = Number(b.start_offset);
      const fim = Number(b.end_offset);
      const texto = b.status === 'silencio' ? '(silencio)' : b.status === 'erro' ? '(nao transcrito)' : b.text || '';
      const sinais = linha ? liveSignalsService.resumoDoIntervalo(linha, ini, fim) : null;
      const pistas = b.status === 'feito' ? tiposDeMomento.pistasDaFala(b.text) : [];
      return `[${ini.toFixed(0)}s-${fim.toFixed(0)}s | ${mmss(ini)}]${sinais ? ` {publico: ${sinais}}` : ''}${pistas.length ? ` {fala: ${pistas.join(', ')}}` : ''} ${texto}`;
    })
    .join('\n');
}

// Puxa o intervalo pra dentro dos limites: dentro da janela e entre 15 e 90s
// (o ajuste fino do render pede 20: "minDuracao").
function ajustarIntervalo(inicio, fim, { min, max, minDuracao = DURACAO_MIN }) {
  let a = Math.max(min, Number(inicio));
  let b = Math.min(max, Number(fim));
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return null;
  if (b - a > DURACAO_MAX) b = a + DURACAO_MAX;
  if (b - a < minDuracao) {
    const falta = minDuracao - (b - a);
    a = Math.max(min, a - falta / 2);
    b = Math.min(max, a + minDuracao);
    if (b - a < minDuracao) return null;
  }
  return { inicio: Math.round(a * 10) / 10, fim: Math.round(b * 10) / 10 };
}

function sobreposicao(a, b) {
  const inter = Math.max(0, Math.min(a.fim, b.fim) - Math.max(a.inicio, b.inicio));
  return inter / Math.min(a.fim - a.inicio, b.fim - b.inicio);
}

// ------------------------------------------------------------------ triagem

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

// O catalogo do que viraliza em corte de live, compartilhado pela triagem e
// pelo juiz (pedido de 29/09/2026). Uma lista so: se cada prompt tivesse a
// dele, a triagem deixaria de apontar o que o juiz aprovaria.
const O_QUE_VIRALIZA = `ENGRACADO:
- piada ou zoeira com desfecho (a graca chega dentro do corte);
- duplo sentido / frase que soou errado, e a reacao de quem percebeu;
- mancada: falou besteira, errou feio, se entregou, passou vergonha, caiu, quebrou algo;
- momento desconfortavel/constrangedor: silencio sem graca, pergunta indiscreta, alguem fica sem resposta, climao;
- xingamento engracado, explosao de raiva exagerada, surto.
SERIO (viraliza pelo CONTEUDO, mesmo sem o chat reagir):
- dinheiro com NUMERO: "faco X por dia/mes/ano", "faturei X", "ganho X", "perdi X", quanto custou algo, salario, conta de quanto alguem ganha;
- ostentacao/conquista: "ganhei tal coisa", "comprei tal carro/casa/relogio", presente caro, conquista grande;
- polemica: opiniao forte e chocante dita sem rodeio, revelacao, fofoca, exposed, "cancelavel";
- briga/treta: discussao, confronto, alguem batendo de frente, resposta afiada, indireta pesada;
- ofensa: xingamento pesado dirigido a alguem, humilhacao, ataque.
TAMBEM: reacao genuina e intensa (rir descontrolado, susto, choque), acontecimento inesperado ao vivo (alguem entrando, doacao maluca), jogada incrivel ou falha absurda.
NAO e momento: opiniao morna, analise, explicacao, tutorial, leitura de chat, pedido de inscricao, discurso longo, conversa que so faz sentido com contexto. "Sobre um tema polemico" nao basta - tem que ter a FRASE forte.`;

const SISTEMA_TRIAGEM = `Voce faz a PRIMEIRA peneira de uma live (Twitch ou Kick), procurando momentos que virariam corte viral no TikTok.
Cada linha e um bloco de ~30s: [inicio-fim em segundos] {publico: como o chat/espectadores reagiram} texto falado.
Alguns blocos trazem {fala: ...}: pista automatica de que ali se falou de dinheiro com numero, de algo ganho/comprado ou houve palavrao. E so pista - leia o texto e decida.
Dois caminhos pra ser momento: o PUBLICO reagiu (chat acima do normal, risadas, espectadores criando clipes) OU a propria FALA e forte (lista abaixo). Conversa comum sem nenhum dos dois nao e momento.

${O_QUE_VIRALIZA}

Aponte NO MAXIMO 3 candidatos, so se houver algo de verdade, e diga no "motivo" qual tipo e (ex.: "dinheiro: diz que fatura 80 mil por mes").
Nota de 0 a 10 com rigor: 5 = mediano, 7 = bom, 9 = raro. Na duvida, lista vazia.`;

async function triarSessao(sessao) {
  const cobertura = await livesRepository.transcriptCoverage(sessao.id);
  const jaTriado = Number(sessao.triaged_until);
  const encerrada = sessao.status !== 'gravando';
  if (cobertura - jaTriado < (encerrada ? 1 : PASSO_TRIAGEM_S)) return 0;

  const inicioJanela = Math.max(0, cobertura - JANELA_TRIAGEM_S);
  const blocos = await livesRepository.transcriptsBetween(sessao.id, inicioJanela, cobertura);
  // Janela sem fala nenhuma: marca como vista sem gastar chamada. Com fala,
  // so marca DEPOIS que a IA respondeu - falha da API nao pode pular trecho.
  if (!blocos.some((b) => b.status === 'feito' && (b.text || '').trim())) {
    await livesRepository.setTriagedUntil(sessao.id, cobertura);
    return 0;
  }
  const linha = await liveSignalsService.linhaDaSessao(sessao.id, cobertura);

  const resposta = await openaiLives.pedirJson({
    nome: 'triagem_live',
    sistema: SISTEMA_TRIAGEM,
    usuario: `Canal: ${sessao.login}. Titulo da live: ${sessao.title || '(sem titulo)'}. Categoria: ${sessao.game_name || '-'}.\n\n${montarTranscricao(blocos, linha)}`,
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
  for (const c of (resposta.dados.candidatos || []).slice(0, 3)) {
    const nota = Math.max(0, Math.min(10, Math.round(Number(c.nota))));
    if (nota < NOTA_MINIMA_TRIAGEM) continue;
    const intervalo = ajustarIntervalo(c.inicio_s, c.fim_s, { min: inicioJanela, max: cobertura });
    if (!intervalo) continue;
    // A janela anda de 2 em 2 min: o mesmo momento aparece em varias
    // triagens seguidas.
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

// ------------------------------------------------------------------ picos de sinal

// Cada pico do publico (ate onde ja ha transcricao, pro juiz ter o texto)
// vira candidato. Pico que cai em cima de um candidato da triagem so
// acrescenta os sinais a ele, em vez de criar outro.
async function candidatosDeSinal(sessao) {
  const cobertura = await livesRepository.transcriptCoverage(sessao.id);
  if (cobertura < 30) return 0;
  const linha = await liveSignalsService.linhaDaSessao(sessao.id, cobertura);
  const existentes = await livesRepository.candidatesForSession(sessao.id);
  let novos = 0;
  for (const p of liveSignalsService.picos(linha, cobertura)) {
    if (p.fim - p.inicio < DURACAO_MIN) continue;
    const igual = existentes.find((c) => sobreposicao({ inicio: Number(c.start_offset), fim: Number(c.end_offset) }, p) > 0.5);
    if (igual) {
      if (!igual.signals) await livesRepository.setCandidateSignals(igual.id, { forca: p.forca, descricao: p.descricao });
      continue;
    }
    const criado = await livesRepository.insertCandidate({
      sessionId: sessao.id,
      source: 'sinal',
      inicio: p.inicio,
      fim: p.fim,
      motivo: p.descricao.slice(0, 300),
      nota: null,
    });
    await livesRepository.setCandidateSignals(criado.id, { forca: p.forca, descricao: p.descricao });
    existentes.push(criado);
    novos += 1;
  }
  return novos;
}

// ------------------------------------------------------------------ juiz

const SCHEMA_JUIZ = {
  type: 'object',
  additionalProperties: false,
  required: ['avaliacoes'],
  properties: {
    avaliacoes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'tipo', 'gancho_forte', 'desfecho_claro', 'emocao', 'entende_sozinho', 'nota', 'inicio_s', 'fim_s', 'titulo', 'gancho', 'porque'],
        properties: {
          id: { type: 'integer' },
          // O tipo decide se o momento precisa de reacao do publico nos
          // niveis altos (dinheiro/ostentacao/polemica nao precisam).
          tipo: { type: 'string', enum: [...tiposDeMomento.TIPOS] },
          // Avaliado ANTES da nota (0-10 cada): obrigar a pensar por partes e
          // o que deixa a nota final calibrada, e o servidor usa pra aplicar
          // tetos (ver aplicarTetos).
          gancho_forte: { type: 'integer' },
          desfecho_claro: { type: 'integer' },
          emocao: { type: 'integer' },
          entende_sozinho: { type: 'boolean' },
          nota: { type: 'integer' },
          inicio_s: { type: 'number' },
          fim_s: { type: 'number' },
          titulo: { type: 'string' },
          gancho: { type: 'string' },
          porque: { type: 'string' },
        },
      },
    },
  },
};

const SISTEMA_JUIZ = `Voce e o editor-chefe de um canal de cortes de live com milhoes de views no TikTok. Voce decide o que vira corte.
Para cada candidato voce recebe o trecho da transcricao (blocos de ~30s, tempo em segundos) e como o PUBLICO reagiu ({publico: ...}: ritmo do chat, risadas, espectadores criando clipes, grito).

Alguns blocos trazem {fala: ...}: pista automatica (dinheiro com numero, algo ganho/comprado, palavrao). E so pista - o texto decide.

O que viraliza em corte de live:
${O_QUE_VIRALIZA}

Classifique cada candidato em "tipo": piada, duplo_sentido, mancada, constrangedor, xingamento (engracados); dinheiro, ostentacao, polemica, briga, ofensa (serios); reacao, inesperado, jogada; ou outro.
O publico pesa muito nos engracados e nas reacoes: chat explodindo, muita risada ou espectadores clipando sobem a nota, e piada/reacao sem nenhuma reacao do publico raramente passa de 6.
Dinheiro, ostentacao e polemica sao a excecao: viralizam pela frase. Um numero concreto e chamativo ("faturo 80 mil por mes", "paguei 2 milhoes nessa casa") ou uma opiniao chocante dita com todas as letras pode tirar 8+ mesmo com o chat parado - desde que a frase esteja dentro do corte e se entenda sozinha. Numero vago ("ganho bem", "uns trocados") nao conta.

Nota de 0 a 10, calibrada:
10 = obvio que viraliza (raro, no maximo 1 a cada varias horas); 9 = excelente; 8 = muito bom; 7 = bom, vale postar; 6 = fraco; 5 = so pra encher; 0-4 = nao e corte.
Seja duro: numa live comum a maioria dos candidatos fica entre 3 e 6.

Antes da nota, avalie por partes (0 a 10): gancho_forte (os 3 primeiros segundos prendem quem esta rolando o feed?), desfecho_claro (tem conclusao - a piada, a resposta, a revelacao, a reacao?), emocao (intensidade real da reacao), e entende_sozinho (quem NUNCA viu essa live entende o corte?).
Sem desfecho claro nao e corte bom: a pessoa assiste e fica "e ai?".

Para cada candidato devolva: as notas por partes; a nota final; inicio_s e fim_s (segundos da gravacao) comecando no GANCHO - quem assiste precisa entender em 3 segundos - e terminando logo depois do desfecho/reacao, 15 a 90s; titulo curto (ate 60 caracteres) e gancho (ate 100) no idioma falado, sem hashtag - quando o momento e de dinheiro/ostentacao, o NUMERO ou o item vai no titulo ("Fatura 80 mil por mes jogando", "Comprou uma Lamborghini a vista"); e "porque" em uma frase.
Avalie TODOS os candidatos recebidos, usando o id exatamente como veio.`;

async function julgarSessao(sessao, { agora = Date.now() } = {}) {
  const encerrada = sessao.status !== 'gravando';
  const ultima = sessao.last_selection_at ? new Date(sessao.last_selection_at).getTime() : 0;
  if (!encerrada && agora - ultima < INTERVALO_JUIZ_MS) return 0;

  const cobertura = await livesRepository.transcriptCoverage(sessao.id);
  const pendentes = (await livesRepository.pendingCandidates(sessao.id, 40))
    // So julga o que ja tem texto em volta (senao o juiz decide no escuro).
    .filter((c) => encerrada || Number(c.end_offset) + 20 <= cobertura)
    // Sinal forte primeiro, depois nota da triagem.
    .sort((a, b) => (Number(b.signals?.forca || 0) - Number(a.signals?.forca || 0)) || ((b.score || 0) - (a.score || 0)))
    .slice(0, CANDIDATOS_POR_JULGAMENTO);
  await livesRepository.markSelection(sessao.id);
  if (!pendentes.length) return 0;

  const linha = await liveSignalsService.linhaDaSessao(sessao.id, Math.max(cobertura, Number(sessao.recorded_seconds)));
  const partes = [];
  for (const c of pendentes) {
    const ini = Number(c.start_offset);
    const fim = Number(c.end_offset);
    const contexto = await livesRepository.transcriptsBetween(sessao.id, Math.max(0, ini - 45), fim + 20);
    const origem = c.source === 'sinal' ? 'pico de reacao do publico' : `triagem (nota ${c.score})`;
    partes.push(
      `### Candidato id=${c.id} | ${ini.toFixed(0)}s-${fim.toFixed(0)}s | origem: ${origem}\n` +
        `Publico no trecho: ${liveSignalsService.resumoDoIntervalo(linha, ini, fim)}\n` +
        `${c.reason ? `Motivo apontado: ${c.reason}\n` : ''}${montarTranscricao(contexto, linha)}`
    );
  }

  // Referencia: os melhores ja aprovados nesta live. Nota absoluta deriva
  // (tudo vira 8 ou 9); comparando com o que ja passou, o 9 volta a ser raro.
  const jaAprovados = (await livesRepository.approvedCandidates(sessao.id)).slice(0, 6);
  const referencia = jaAprovados.length
    ? `\n\nJa aprovados nesta live (compare: so de 9+ a algo do nivel dos melhores daqui):\n${jaAprovados.map((c) => `- nota ${c.final_score}: "${c.title}"`).join('\n')}`
    : '';

  const resposta = await openaiLives.pedirJson({
    nome: 'juiz_live',
    sistema: SISTEMA_JUIZ,
    usuario: `Canal: ${sessao.login}. Titulo da live: ${sessao.title || '(sem titulo)'}. Categoria: ${sessao.game_name || '-'}.${referencia}\n\n${partes.join('\n\n')}`,
    schema: SCHEMA_JUIZ,
    modelo: openaiLives.MODELO_JUIZ,
    // 'medium': o juiz decide o que vira corte; pensar mais aqui custa
    // centavos por hora e e onde a qualidade se decide.
    raciocinio: 'medium',
  });
  await livesRepository.recordCost({
    channelId: sessao.live_channel_id,
    sessionId: sessao.id,
    kind: 'juiz',
    inputTokens: resposta.inputTokens,
    outputTokens: resposta.outputTokens,
    custoUsd: resposta.custoUsd,
  });

  const porId = new Map(pendentes.map((c) => [Number(c.id), c]));
  const gravado = Number(sessao.recorded_seconds) || Infinity;
  const vistos = new Set();
  let aprovados = 0;
  for (const a of resposta.dados.avaliacoes || []) {
    const cand = porId.get(Number(a.id));
    if (!cand || vistos.has(cand.id)) continue; // id inventado ou repetido
    vistos.add(cand.id);
    const nota = aplicarTetos(a);
    const intervalo = ajustarIntervalo(a.inicio_s, a.fim_s, {
      min: Math.max(0, Number(cand.start_offset) - 30),
      max: Math.min(gravado, Number(cand.end_offset) + 30),
    });
    const aprovado = nota >= NOTA_MINIMA_APROVADO && intervalo;
    await livesRepository.judgeCandidate(cand.id, {
      status: aprovado ? 'escolhido' : 'descartado',
      nota,
      inicio: intervalo?.inicio ?? null,
      fim: intervalo?.fim ?? null,
      tipo: tiposDeMomento.TIPOS.includes(a.tipo) ? a.tipo : null,
      titulo: String(a.titulo || '').slice(0, 80),
      gancho: String(a.gancho || '').slice(0, 150),
      porque: `[${a.tipo || '?'} · gancho ${a.gancho_forte} · desfecho ${a.desfecho_claro} · emocao ${a.emocao}${a.entende_sozinho === false ? ' · precisa de contexto' : ''}] ${String(a.porque || '')}`.slice(0, 300),
    });
    if (aprovado) aprovados += 1;
  }
  // O que o juiz nao devolveu (resposta cortada) fica pendente pra proxima.
  if (encerrada) await livesRepository.discardStaleCandidates(sessao.id, { tudo: true });
  logger.info(`Lives: juiz avaliou ${vistos.size} candidato(s) da sessao ${sessao.id} (${sessao.login}), ${aprovados} aprovado(s).`);
  return aprovados;
}

// ------------------------------------------------------------------ distribuicao

// Cada usuario recebe os aprovados que passam no nivel de qualidade dele,
// respeitando o teto por hora do nivel (proporcional ao tempo gravado; a
// primeira hora conta inteira).
// Onde o momento esta entre as reacoes do PUBLICO daquela live (0 a 1): a
// fracao das janelas de 10s com reacao menor que a dele. Relativo a propria
// live, entao funciona igual em live de 500 e de 50 mil pessoas.
function percentilDeReacao(linha, inicio, fim) {
  const forcas = linha.janelas.map((j) => j.forca);
  if (!forcas.length || Math.max(...forcas) <= 0) return null; // live sem sinal (sem chat)
  const doMomento = Math.max(0, ...linha.janelas.filter((j) => j.inicio < fim && j.inicio + 10 > inicio).map((j) => j.forca));
  return forcas.filter((f) => f < doMomento).length / forcas.length;
}

async function distribuirSessao(sessao) {
  const aprovados = await livesRepository.approvedCandidates(sessao.id);
  if (!aprovados.length) return 0;
  const horas = Math.max(1, Number(sessao.recorded_seconds) / 3600);
  const linha = await liveSignalsService.linhaDaSessao(sessao.id, Math.max(1, Number(sessao.recorded_seconds)));
  const percentis = new Map(aprovados.map((c) => [c.id, percentilDeReacao(linha, Number(c.final_start), Number(c.final_end))]));
  let criados = 0;
  for (const seguidor of await livesRepository.followersWithQuality(sessao.live_channel_id)) {
    const nivel = livesUserSettings.nivel(seguidor.qualidade);
    const teto = Math.floor(nivel.porHora * horas);
    let jaTem = await livesRepository.countUserClipsFromJudge(sessao.id, seguidor.user_id);
    // O mesmo momento pode chegar por dois caminhos (triagem e pico do
    // publico) e virar dois candidatos quase iguais - visto no rejulgamento
    // do thimagroo: "50 mil numa noite" e "Cinquenta mil numa noite". Momento
    // que ja virou corte pra esta pessoa nao vira outro.
    const trechosDados = (await livesRepository.userClipRanges(sessao.id, seguidor.user_id)).map((r) => ({
      inicio: Number(r.start_offset),
      fim: Number(r.end_offset),
    }));
    for (const c of aprovados) {
      if (jaTem >= teto) break;
      const trecho = { inicio: Number(c.final_start), fim: Number(c.final_end) };
      if (trechosDados.some((t) => sobreposicao(t, trecho) > 0.4)) continue;
      if (Number(c.final_score) < nivel.notaMinima) continue;
      // Niveis altos exigem tambem que o PUBLICO tenha reagido forte (no teste
      // de 29/09, no nivel maximo, sairam cortes nota 9 com reacao morna).
      // Menos dinheiro/ostentacao/polemica: viralizam pela frase, e o chat
      // costuma ficar parado ouvindo o numero. A nota minima do nivel vale
      // igual pra eles.
      const percentil = percentis.get(c.id);
      if (!tiposDeMomento.ehDeConteudo(c.moment_type) && percentil !== null && percentil < nivel.reacaoMinima) continue;
      const corte = await livesRepository.insertClipOnce({
        sessionId: sessao.id,
        channelId: sessao.live_channel_id,
        userId: seguidor.user_id,
        candidateId: c.id,
        source: c.source === 'sinal' ? 'sinal' : 'triagem',
        inicio: Number(c.final_start),
        fim: Number(c.final_end),
        titulo: c.title,
        gancho: c.hook,
        nota: Number(c.final_score),
      });
      if (corte) {
        jaTem += 1;
        criados += 1;
        trechosDados.push(trecho);
      }
    }
  }
  return criados;
}

module.exports = {
  aplicarTetos,
  percentilDeReacao,
  triarSessao,
  candidatosDeSinal,
  julgarSessao,
  distribuirSessao,
  montarTranscricao,
  ajustarIntervalo,
  sobreposicao,
  PASSO_TRIAGEM_S,
  JANELA_TRIAGEM_S,
  NOTA_MINIMA_TRIAGEM,
  NOTA_MINIMA_APROVADO,
};
