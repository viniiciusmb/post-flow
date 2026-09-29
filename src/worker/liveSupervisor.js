// Supervisor do modulo de lives. Roda no processo proprio (liveIndex.js,
// container live-worker), separado do video-worker de proposito: uma live
// pesada nao pode atrasar os cortes e as postagens dos clientes do YouTube.
//
// Nao usa a fila (pg-boss): uma gravacao e um processo de HORAS, e o que o
// supervisor faz e manter processos vivos e laços curtos rodando. Cada laço
// tem trava contra rodar por cima de si mesmo e nunca derruba o processo.
'use strict';

const path = require('path');
const livesRepository = require('../repositories/livesRepository');
const livesSettings = require('../services/lives/livesSettings');
const twitchApi = require('../services/lives/twitchApi');
const liveCaptureService = require('../services/lives/liveCaptureService');
const liveSegmentsService = require('../services/lives/liveSegmentsService');
const liveTranscriptionService = require('../services/lives/liveTranscriptionService');
const liveAnalysisService = require('../services/lives/liveAnalysisService');
const liveRenderService = require('../services/lives/liveRenderService');
const liveCleanupService = require('../services/lives/liveCleanupService');
const liveChatService = require('../services/lives/liveChatService');
const liveViewerClipsService = require('../services/lives/liveViewerClipsService');
const logger = require('../lib/logger');

// Ate este tanto de blocos transcritos por volta do laço: da conta de uma
// live em tempo real (1 bloco a cada 30s por canal) com folga pra recuperar
// atraso, sem monopolizar o processo.
const BLOCOS_POR_VOLTA = 6;

// Encerra a sessao no banco com o ultimo inventario dos pedacos gravados.
async function encerrarSessao(sessao, { motivo, pedidoParar, fimNatural, ultimasLinhas }) {
  await liveChatService.parar(Number(sessao.id));
  try {
    await liveSegmentsService.sincronizar(sessao);
  } catch (err) {
    logger.error(`Lives: inventario final da sessao ${sessao.id} falhou:`, err.message);
  }
  const status = pedidoParar || fimNatural ? 'encerrada' : 'interrompida';
  const fim = await livesRepository.endSession(sessao.id, { status, motivo });
  if (fim) logger.info(`Lives: sessao ${sessao.id} ${status} (${motivo}).`);
  if (status === 'interrompida') logger.warn(`Lives: sessao ${sessao.id} caiu. Ultimas linhas:\n${ultimasLinhas}`);
}

async function comecarGravacao(canal, stream, cfg) {
  const sessao = await livesRepository.createSession({
    channelId: canal.id,
    streamId: stream.streamId,
    titulo: stream.titulo,
    jogo: stream.jogo,
    dirPath: 'pendente',
  });
  if (!sessao) return; // outra volta ja abriu a sessao desse canal
  const dir = path.join(liveCleanupService.pastaDasGravacoes(), String(canal.id), String(sessao.id));
  await livesRepository.setSessionDir(sessao.id, dir);
  const completa = { ...sessao, dir_path: dir, login: canal.login };
  try {
    liveCaptureService.iniciar({
      sessionId: Number(sessao.id),
      login: canal.login,
      dir,
      qualidade: cfg.qualidade,
      onFim: (info) => encerrarSessao(completa, info),
    });
    // O chat e sinal de apoio: se nao conectar, a gravacao segue igual.
    liveChatService.acompanhar({ sessionId: Number(sessao.id), login: canal.login });
  } catch (err) {
    await livesRepository.endSession(sessao.id, { status: 'erro', motivo: err.message });
    throw err;
  }
}

// A cada minuto: quem esta ao vivo, quem comeca e quem para de gravar.
async function monitorar() {
  const ligado = await livesSettings.estaLigado();
  if (!ligado) {
    if (liveCaptureService.quantasGravando()) {
      logger.info('Lives: modulo desligado - parando todas as gravacoes.');
      await liveCaptureService.pararTodas('modulo desligado');
    }
    return;
  }
  const cfg = await livesSettings.obterConfig();
  const canais = await livesRepository.listWatchedChannels();
  const recording = await livesRepository.listRecordingSessions();

  // Sessao "gravando" no banco sem processo neste worker (canal que perdeu
  // todos os seguidores, ou restos de uma volta anterior): fecha.
  const vigiados = new Set(canais.map((c) => Number(c.id)));
  for (const s of recording) {
    if (vigiados.has(Number(s.live_channel_id))) continue;
    if (liveCaptureService.gravando(Number(s.id))) {
      await liveCaptureService.parar(Number(s.id), 'ninguem acompanha mais o canal');
    } else {
      await livesRepository.endSession(s.id, { status: 'interrompida', motivo: 'processo sumiu' });
    }
  }
  if (!canais.length) return;

  const discoPercent = liveCleanupService.usoDoDiscoPercent();
  if (discoPercent >= cfg.discoMaxPercent) {
    if (liveCaptureService.quantasGravando()) {
      logger.warn(`Lives: disco em ${discoPercent.toFixed(0)}% (limite ${cfg.discoMaxPercent}%) - parando as gravacoes.`);
      await liveCaptureService.pararTodas(`disco acima de ${cfg.discoMaxPercent}%`);
    }
  }

  const aoVivo = await twitchApi.buscarAoVivo(canais.map((c) => c.login));
  for (const canal of canais) {
    try {
      await cuidarDoCanal(canal, aoVivo.get(canal.login), cfg, discoPercent);
    } catch (err) {
      // Um canal com problema nao pode impedir os outros de serem olhados.
      logger.error(`Lives: canal ${canal.login} falhou nesta volta:`, err.message);
    }
  }
}

async function cuidarDoCanal(canal, stream, cfg, discoPercent) {
  await livesRepository.updateChannelStatus(canal.id, {
    isLive: Boolean(stream),
    titulo: stream?.titulo,
    jogo: stream?.jogo,
    espectadores: stream?.espectadores,
  });
  const sessao = await livesRepository.recordingSessionForChannel(canal.id);
  const horasHoje = (await livesRepository.recordedSecondsToday(canal.id)) / 3600;

  if (sessao) {
    if (!liveCaptureService.gravando(Number(sessao.id))) {
      // Banco diz "gravando" mas nao ha processo: morreu sem avisar.
      await livesRepository.endSession(sessao.id, { status: 'interrompida', motivo: 'processo sumiu' });
    } else if (!stream) {
      await liveCaptureService.parar(Number(sessao.id), 'live terminou');
    } else if (horasHoje >= cfg.horasPorCanalDia) {
      await liveCaptureService.parar(Number(sessao.id), `limite de ${cfg.horasPorCanalDia}h por dia`);
    }
    return;
  }

  if (!stream) return;
  if (discoPercent >= cfg.discoMaxPercent) return;
  if (horasHoje >= cfg.horasPorCanalDia) return;
  if (liveCaptureService.quantasGravando() >= cfg.maxCanais) {
    logger.info(`Lives: ${canal.login} esta ao vivo, mas ja ha ${cfg.maxCanais} canal(is) gravando (limite).`);
    return;
  }
  await comecarGravacao(canal, stream, cfg);
}

async function sincronizarSegmentos() {
  for (const s of await livesRepository.listRecordingSessions()) {
    if (s.dir_path === 'pendente') continue;
    await liveSegmentsService.sincronizar(s);
  }
}

async function transcrever() {
  if (!(await livesSettings.estaLigado())) return;
  for (let i = 0; i < BLOCOS_POR_VOLTA; i += 1) {
    if (!(await liveTranscriptionService.processarProximo())) break;
  }
}

// Etapas em ordem, cada uma com a sessao relida (a anterior acabou de mexer
// nela). Uma etapa que falha nao impede as seguintes: o juiz pode julgar o que
// a triagem ja tinha achado mesmo se a triagem desta volta falhou.
async function analisar() {
  if (!(await livesSettings.estaLigado())) return;
  for (const s of await livesRepository.listSessionsForAnalysis()) {
    const etapas = [
      ['triagem', (x) => liveAnalysisService.triarSessao(x)],
      ['picos de sinal', (x) => liveAnalysisService.candidatosDeSinal(x)],
      ['juiz', (x) => liveAnalysisService.julgarSessao(x)],
      ['distribuicao', (x) => liveAnalysisService.distribuirSessao(x)],
    ];
    for (const [nome, etapa] of etapas) {
      try {
        const sessao = { ...(await livesRepository.findSession(s.id)), login: s.login };
        await etapa(sessao);
      } catch (err) {
        logger.error(`Lives: ${nome} da sessao ${s.id} falhou:`, err.message);
      }
    }
  }
}

// Clipes criados pelos espectadores, de todas as sessoes ainda em analise.
async function coletarClipes() {
  if (!(await livesSettings.estaLigado())) return;
  for (const s of await livesRepository.listSessionsForAnalysis()) {
    try {
      await liveViewerClipsService.coletar(s, s.platform_user_id);
    } catch (err) {
      logger.warn(`Lives: clipes dos espectadores de ${s.login} falharam: ${err.message}`);
    }
  }
}

async function renderizar() {
  if (!(await livesSettings.estaLigado())) return;
  // Um corte por volta: o render e a unica parte pesada, e com 2 nucleos
  // dois renders de live ao mesmo tempo roubariam CPU do fluxo do YouTube.
  await liveRenderService.renderizarProximo();
}

async function limpar() {
  const cfg = await livesSettings.obterConfig();
  await liveCleanupService.apagarPedacosAntigos(cfg.retencaoHoras);
}

// Laço com trava: se a volta anterior ainda nao terminou (render longo,
// OpenAI lenta), a proxima e pulada em vez de empilhar.
function laco(nome, fn, intervaloMs) {
  let rodando = false;
  const volta = async () => {
    if (rodando) return;
    rodando = true;
    try {
      await fn();
    } catch (err) {
      logger.error(`Lives: laço "${nome}" falhou:`, err.message);
    } finally {
      rodando = false;
    }
  };
  const t = setInterval(volta, intervaloMs);
  setImmediate(volta);
  return t;
}

const timers = [];

async function iniciar() {
  const orfas = await livesRepository.interruptOrphanSessions('worker reiniciado');
  if (orfas.length) logger.info(`Lives: ${orfas.length} sessao(oes) de antes do reinicio marcada(s) como interrompida(s).`);
  const reenfileirados = await livesRepository.requeueInterruptedRenders();
  if (reenfileirados) logger.info(`Lives: ${reenfileirados} corte(s) que estavam renderizando voltaram pra fila.`);

  timers.push(laco('monitorar', monitorar, 60_000));
  timers.push(laco('segmentos', sincronizarSegmentos, 5_000));
  timers.push(laco('transcrever', transcrever, 5_000));
  timers.push(laco('analisar', analisar, 30_000));
  timers.push(laco('clipes', coletarClipes, 2 * 60_000));
  timers.push(laco('renderizar', renderizar, 5_000));
  timers.push(laco('limpar', limpar, 10 * 60_000));
}

async function parar() {
  for (const t of timers.splice(0)) clearInterval(t);
  await liveCaptureService.pararTodas('worker desligando');
  await liveChatService.pararTodos();
}

module.exports = { iniciar, parar, monitorar, analisar, coletarClipes, encerrarSessao };
