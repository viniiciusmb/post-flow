// Modulo de cortes de lives da Twitch (fase de validacao, so admin).
//
// O que esta travado aqui:
//   1. o modulo nasce DESLIGADO e nao roda sem a Twitch configurada;
//   2. uma gravacao por canal, mesmo com duas tentativas ao mesmo tempo;
//   3. os pedacos gravados entram no banco uma vez so, e bloco de audio novo
//      ja nasce com a transcricao pendente;
//   4. bloco quase todo silencioso NAO e mandado pra OpenAI (nao custa);
//   5. a triagem so anda quando ha 2 min de texto novo, nunca pula buraco, e
//      falha da API nao faz o trecho ser pulado;
//   6. o juiz (gpt-5-mini) aprova de 5 pra cima e ignora id inventado; cada
//      usuario recebe so o que passa no NIVEL DE QUALIDADE dele, sem duplicar
//      e dentro do teto por hora do nivel;
//   6b. sinais do publico: chat, risada, clipe de espectador e pausa de
//      anuncio viram candidato no lugar certo; live sem reacao nao gera pico;
//   6c. layout da camera e recusa de retangulo absurdo;
//   7. o supervisor nao faz nada com o modulo desligado, respeita o limite de
//      canais e para de gravar quando a live acaba;
//   8. a retencao apaga os pedacos brutos antigos;
//   9. nenhum codigo do modulo escreve em tabela do fluxo do YouTube.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');

const pool = require('../../src/db/pool');
const livesRepository = require('../../src/repositories/livesRepository');
const livesSettings = require('../../src/services/lives/livesSettings');
const twitchApi = require('../../src/services/lives/twitchApi');
const openaiLives = require('../../src/services/lives/openaiLives');
const liveSegmentsService = require('../../src/services/lives/liveSegmentsService');
const liveTranscriptionService = require('../../src/services/lives/liveTranscriptionService');
const liveAnalysisService = require('../../src/services/lives/liveAnalysisService');
const liveCaptureService = require('../../src/services/lives/liveCaptureService');
const liveCleanupService = require('../../src/services/lives/liveCleanupService');
const liveSupervisor = require('../../src/worker/liveSupervisor');
const settingsRepository = require('../../src/repositories/settingsRepository');
const livesUserSettings = require('../../src/services/lives/livesUserSettings');
const liveChatService = require('../../src/services/lives/liveChatService');
const liveSignalsService = require('../../src/services/lives/liveSignalsService');
const videoEditingService = require('../../src/services/videoEditingService');
const liveRenderService = require('../../src/services/lives/liveRenderService');
const liveFormatoService = require('../../src/services/lives/liveFormatoService');
const { createClient } = require('../helpers/db');

test.after(async () => {
  await pool.end();
});

// Troca uma funcao de um modulo durante o teste e devolve como desfazer.
function trocar(modulo, nome, falsa) {
  const original = modulo[nome];
  modulo[nome] = falsa;
  return () => { modulo[nome] = original; };
}

let n = 0;
async function novoCanal(login = `canal_${Date.now().toString(36)}_${n++}`) {
  return livesRepository.upsertChannel({ login, displayName: login, platformUserId: String(n), profileImageUrl: null });
}

async function novaSessao(canal, extra = {}) {
  const s = await livesRepository.createSession({ channelId: canal.id, dirPath: fs.mkdtempSync(path.join(os.tmpdir(), 'live-')) });
  if (extra.recorded) await pool.query('UPDATE live_sessions SET recorded_seconds = $2 WHERE id = $1', [s.id, extra.recorded]);
  return { ...(await livesRepository.findSession(s.id)), login: canal.login };
}

async function blocoTranscrito(sessao, inicio, fim, texto, status = 'feito') {
  const { rows } = await pool.query(
    `INSERT INTO live_segments (session_id, kind, seq, file_path, start_offset, end_offset)
     VALUES ($1, 'audio', $2, '/nao/existe.ogg', $3, $4) RETURNING id`,
    [sessao.id, Math.round(inicio), inicio, fim]
  );
  await pool.query(
    `INSERT INTO live_transcripts (session_id, audio_segment_id, start_offset, end_offset, status, text)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [sessao.id, rows[0].id, inicio, fim, status, texto]
  );
}

// ------------------------------------------------------------------ 1

test('o modulo nasce desligado e nao liga sem a Twitch configurada', async () => {
  assert.equal(await settingsRepository.getValue('lives_enabled', null), false);
  assert.equal(await livesSettings.estaLigado(), false);
  await livesSettings.ligar(true);
  try {
    // Ligado no painel, mas sem TWITCH_CLIENT_ID/SECRET no ambiente de teste.
    assert.equal(twitchApi.configurado(), false);
    assert.equal(await livesSettings.estaLigado(), false);
  } finally {
    await livesSettings.ligar(false);
  }
});

test('limites fora da faixa sao puxados pra dentro, nao aceitos crus', () => {
  const c = livesSettings.sanitizar({ maxCanais: 50, horasPorCanalDia: 0, retencaoHoras: 'x', qualidade: '4k', discoMaxPercent: 99 });
  assert.equal(c.maxCanais, 5);
  assert.equal(c.horasPorCanalDia, 1);
  assert.equal(c.retencaoHoras, livesSettings.PADRAO.retencaoHoras);
  // Padrao 720p: a camera recortada de 480p sai borrada.
  assert.equal(c.qualidade, '720p');
  assert.equal(c.discoMaxPercent, 95);
});

test('nome do canal aceita o que a pessoa cola', () => {
  assert.equal(twitchApi.normalizarLogin('https://www.twitch.tv/Gaules?sr=a'), 'gaules');
  assert.equal(twitchApi.normalizarLogin('@Casimiro'), 'casimiro');
  assert.equal(twitchApi.normalizarLogin('twitch.tv/loud_coringa'), 'loud_coringa');
  assert.equal(twitchApi.normalizarLogin('nome com espaco'), null);
  assert.equal(twitchApi.normalizarLogin(''), null);
});

// ------------------------------------------------------------------ 2

test('uma gravacao por canal, mesmo com duas tentativas simultaneas', async () => {
  const canal = await novoCanal();
  const tentativas = await Promise.all(
    Array.from({ length: 5 }, () => livesRepository.createSession({ channelId: canal.id, dirPath: '/tmp/x' }))
  );
  assert.equal(tentativas.filter(Boolean).length, 1);
  const [aberta] = tentativas.filter(Boolean);
  await livesRepository.endSession(aberta.id, { status: 'encerrada', motivo: 'teste' });
  // Encerrada a primeira, uma nova pode comecar (live seguinte).
  assert.ok(await livesRepository.createSession({ channelId: canal.id, dirPath: '/tmp/y' }));
});

test('encerrar duas vezes nao troca o motivo que o primeiro aviso gravou', async () => {
  const canal = await novoCanal();
  const s = await livesRepository.createSession({ channelId: canal.id, dirPath: '/tmp/z' });
  assert.ok(await livesRepository.endSession(s.id, { status: 'encerrada', motivo: 'live terminou' }));
  assert.equal(await livesRepository.endSession(s.id, { status: 'interrompida', motivo: 'processo sumiu' }), null);
  const final = await livesRepository.findSession(s.id);
  assert.equal(final.status, 'encerrada');
  assert.equal(final.stop_reason, 'live terminou');
});

// ------------------------------------------------------------------ 3

test('pedacos gravados entram uma vez so, e audio novo ja nasce pendente de transcricao', async () => {
  const canal = await novoCanal();
  const sessao = await novaSessao(canal);
  const dir = sessao.dir_path;
  for (const f of ['seg_000000.ts', 'seg_000001.ts', 'aud_00000.ogg']) fs.writeFileSync(path.join(dir, f), 'x'.repeat(100));
  fs.writeFileSync(path.join(dir, 'video.csv'), 'seg_000000.ts,0.000000,10.000333\nseg_000001.ts,10.000000,20.000333\nseg_0000');
  fs.writeFileSync(path.join(dir, 'audio.csv'), 'aud_00000.ogg,0.000000,30.000500\n');

  const totais = await liveSegmentsService.sincronizar(sessao);
  await liveSegmentsService.sincronizar(sessao); // idempotente

  const { rows: segs } = await pool.query('SELECT kind, count(*)::int AS n FROM live_segments WHERE session_id = $1 GROUP BY kind ORDER BY kind', [sessao.id]);
  assert.deepEqual(segs, [{ kind: 'audio', n: 1 }, { kind: 'video', n: 2 }]);
  const { rows: tr } = await pool.query('SELECT status FROM live_transcripts WHERE session_id = $1', [sessao.id]);
  assert.deepEqual(tr.map((r) => r.status), ['pendente']);
  // A linha pela metade ("seg_0000") nao entra; o gravado vai ate o fim do 2o pedaco.
  assert.ok(Math.abs(totais.recordedSeconds - 20.000333) < 0.001);
  assert.equal(totais.bytes, 300);
});

// ------------------------------------------------------------------ 4

test('bloco quase todo silencioso nao e mandado pra OpenAI e nao custa nada', async () => {
  const canal = await novoCanal();
  const sessao = await novaSessao(canal);
  await livesRepository.insertSegments(sessao.id, 'audio', [{ seq: 0, file_path: '/x/aud.ogg', start_offset: 0, end_offset: 30, bytes: 1 }]);
  let chamouOpenai = false;
  const desfazer = [
    trocar(liveTranscriptionService, 'analisarAudio', async () => ({ silencioSegundos: 28, loudness: -60, pico: -30 })),
    trocar(openaiLives, 'transcreverBloco', async () => { chamouOpenai = true; return { texto: 'x', custoUsd: 1 }; }),
  ];
  try {
    while (await liveTranscriptionService.processarProximo()) { /* esvazia a fila */ }
  } finally {
    desfazer.forEach((d) => d());
  }
  assert.equal(chamouOpenai, false);
  const { rows } = await pool.query('SELECT status, silence_seconds FROM live_transcripts WHERE session_id = $1', [sessao.id]);
  assert.equal(rows[0].status, 'silencio');
  const { rows: custos } = await pool.query('SELECT count(*)::int AS n FROM live_costs WHERE session_id = $1', [sessao.id]);
  assert.equal(custos[0].n, 0);
});

// Medido na 1a live real: com o texto anterior no "prompt", a OpenAI copiava
// esse texto pra dentro da resposta e todo bloco repetia o fim do anterior.
test('bloco com fala e transcrito acelerado em 1,5x, sem o texto anterior como prompt, e o custo e registrado', async () => {
  const canal = await novoCanal();
  const sessao = await novaSessao(canal);
  await blocoTranscrito(sessao, 0, 30, 'e ai galera, bora comecar a partida');
  await livesRepository.insertSegments(sessao.id, 'audio', [{ seq: 99, file_path: '/x/aud2.ogg', start_offset: 30, end_offset: 60, bytes: 1 }]);
  let contextoRecebido = null;
  let arquivoEnviado = null;
  let segundosEnviados = null;
  const desfazer = [
    trocar(liveTranscriptionService, 'analisarAudio', async () => ({ silencioSegundos: 2, loudness: -18, pico: -1 })),
    trocar(liveTranscriptionService, 'acelerarAudio', async (_orig, destino) => destino),
    trocar(openaiLives, 'transcreverBloco', async (f, { contexto, segundos }) => {
      contextoRecebido = contexto;
      arquivoEnviado = f;
      segundosEnviados = segundos;
      return { texto: 'que jogada absurda', custoUsd: (segundos / 60) * 0.003 };
    }),
  ];
  try {
    while (await liveTranscriptionService.processarProximo()) { /* esvazia a fila */ }
  } finally {
    desfazer.forEach((d) => d());
  }
  assert.ok(!contextoRecebido, 'o texto do bloco anterior nao pode ir como prompt');
  // Economia de 28/09: vai o audio ACELERADO em 1,5x - 30s de live cobrados
  // como 20s.
  assert.match(arquivoEnviado, /\.rapido\.ogg$/);
  assert.equal(segundosEnviados, 20);
  const { rows } = await pool.query("SELECT text, loudness_lufs FROM live_transcripts WHERE session_id = $1 AND start_offset = 30", [sessao.id]);
  assert.equal(rows[0].text, 'que jogada absurda');
  const { rows: custo } = await pool.query("SELECT kind, audio_seconds, cost_usd FROM live_costs WHERE session_id = $1", [sessao.id]);
  assert.equal(custo.length, 1);
  assert.equal(custo[0].kind, 'transcricao');
  assert.equal(Number(custo[0].audio_seconds), 20);
  assert.ok(Math.abs(Number(custo[0].cost_usd) - 0.001) < 1e-9, 'US$ 0,001 em vez de 0,0015');
});

test('a leitura da analise de audio bate com a saida REAL do ffmpeg 5.1 do servidor', () => {
  const fixtures = path.join(__dirname, '..', 'fixtures');
  const fala = liveTranscriptionService.interpretarAnalise(fs.readFileSync(path.join(fixtures, 'ffmpeg-analise-fala.txt'), 'utf8'), 30);
  assert.equal(fala.loudness, -16.8);
  assert.equal(fala.pico, 3.8);
  assert.ok(fala.silencioSegundos < 2);
  // Volume segundo a segundo: 30 valores, e o grito do segundo 18 aparece
  // (a media do bloco inteiro esconde ele).
  assert.equal(fala.momentaneo.length, 30);
  assert.equal(fala.momentaneo[18], -6.9);
  assert.ok(fala.momentaneo.filter((v, i) => i !== 18).every((v) => v < -12));
  const silencio = liveTranscriptionService.interpretarAnalise(fs.readFileSync(path.join(fixtures, 'ffmpeg-analise-silencio.txt'), 'utf8'), 30);
  assert.equal(silencio.silencioSegundos, 30);
  assert.ok(silencio.momentaneo.every((v) => v === -70));
  // Bloco que TERMINA em silencio: conta ate o fim do bloco.
  assert.equal(liveTranscriptionService.interpretarAnalise('silence_start: 20.5\n', 30).silencioSegundos, 9.5);
});

// ------------------------------------------------------------------ 5

test('a cobertura da transcricao para no primeiro bloco pendente (nunca pula buraco)', async () => {
  const canal = await novoCanal();
  const sessao = await novaSessao(canal);
  await blocoTranscrito(sessao, 0, 30, 'a');
  await blocoTranscrito(sessao, 30, 60, null, 'silencio');
  await blocoTranscrito(sessao, 60, 90, null, 'pendente');
  await blocoTranscrito(sessao, 90, 120, 'd');
  assert.equal(await livesRepository.transcriptCoverage(sessao.id), 60);
});

test('triagem so anda com 2 min de texto novo, e ajusta/filtra o que a IA devolve', async () => {
  const canal = await novoCanal();
  const sessao = await novaSessao(canal);
  await blocoTranscrito(sessao, 0, 30, 'comecando');
  await blocoTranscrito(sessao, 30, 60, 'nada demais');
  let chamadas = 0;
  const desfazer = trocar(openaiLives, 'pedirJson', async () => {
    chamadas += 1;
    return {
      dados: {
        candidatos: [
          { inicio_s: 100, fim_s: 400, motivo: 'grito', nota: 9 }, // fora da janela e longo demais -> ajustado
          { inicio_s: 10, fim_s: 40, motivo: 'fraco', nota: 3 }, // nota baixa -> fora
          { inicio_s: 105, fim_s: 150, motivo: 'mesmo momento', nota: 8 }, // sobrepoe o 1o -> fora
        ],
      },
      inputTokens: 1000,
      outputTokens: 100,
      custoUsd: 0.0001,
    };
  });
  try {
    assert.equal(await liveAnalysisService.triarSessao(sessao), 0);
    assert.equal(chamadas, 0, 'com 60s de texto ainda nao e hora de triar');

    for (let t = 60; t < 180; t += 30) await blocoTranscrito(sessao, t, t + 30, 'o cara gritou do nada');
    const atual = await livesRepository.findSession(sessao.id);
    assert.equal(await liveAnalysisService.triarSessao({ ...atual, login: canal.login }), 1);
    assert.equal(chamadas, 1);
  } finally {
    desfazer();
  }
  const cands = await livesRepository.candidatesForSession(sessao.id);
  assert.equal(cands.length, 1);
  assert.equal(Number(cands[0].start_offset), 100);
  assert.equal(Number(cands[0].end_offset), 180, 'puxado pra dentro do que ja esta transcrito');
  assert.equal(Number((await livesRepository.findSession(sessao.id)).triaged_until), 180);
});

test('falha da OpenAI na triagem NAO marca o trecho como visto', async () => {
  const canal = await novoCanal();
  const sessao = await novaSessao(canal);
  for (let t = 0; t < 150; t += 30) await blocoTranscrito(sessao, t, t + 30, 'fala qualquer');
  const desfazer = trocar(openaiLives, 'pedirJson', async () => { throw new Error('OpenAI fora do ar'); });
  try {
    await assert.rejects(() => liveAnalysisService.triarSessao(sessao), /fora do ar/);
  } finally {
    desfazer();
  }
  assert.equal(Number((await livesRepository.findSession(sessao.id)).triaged_until), 0);
});

// ------------------------------------------------------------------ 6

test('juiz (gpt-5-mini) aprova de 5 pra cima, reprova o resto e ignora id inventado', async () => {
  const canal = await novoCanal();
  const sessao = await novaSessao(canal, { recorded: 1800 });
  for (let t = 0; t < 1200; t += 30) await blocoTranscrito(sessao, t, t + 30, 'fala');
  const c1 = await livesRepository.insertCandidate({ sessionId: sessao.id, source: 'triagem', inicio: 100, fim: 140, motivo: 'm1', nota: 8 });
  const c2 = await livesRepository.insertCandidate({ sessionId: sessao.id, source: 'sinal', inicio: 300, fim: 340, motivo: 'chat explodiu' });
  const c3 = await livesRepository.insertCandidate({ sessionId: sessao.id, source: 'triagem', inicio: 600, fim: 640, motivo: 'm3', nota: 7 });
  let modelo = null;
  const desfazer = trocar(openaiLives, 'pedirJson', async (pedido) => {
    modelo = pedido.modelo;
    return {
      dados: {
        avaliacoes: [
          { id: Number(c1.id), nota: 9, inicio_s: 95, fim_s: 138, titulo: 'Que jogada', gancho: 'olha isso', porque: 'reacao forte' },
          { id: 999999, nota: 10, inicio_s: 0, fim_s: 30, titulo: 'inventado', gancho: '', porque: '' },
          { id: Number(c2.id), nota: 6, inicio_s: 300, fim_s: 340, titulo: 'Chat riu', gancho: '', porque: 'ok' },
          { id: Number(c3.id), nota: 3, inicio_s: 600, fim_s: 640, titulo: 'fraco', gancho: '', porque: 'opiniao morna' },
        ],
      },
      inputTokens: 5000,
      outputTokens: 500,
      custoUsd: 0.002,
    };
  });
  try {
    assert.equal(await liveAnalysisService.julgarSessao(sessao), 2);
  } finally {
    desfazer();
  }
  assert.equal(modelo, 'gpt-5-mini');
  const { rows } = await pool.query('SELECT id, status, final_score, final_start, title FROM live_candidates WHERE session_id = $1 ORDER BY id', [sessao.id]);
  assert.deepEqual(rows.map((r) => [r.status, r.final_score]), [['escolhido', 9], ['escolhido', 6], ['descartado', 3]]);
  assert.equal(Number(rows[0].final_start), 95);
  const { rows: custo } = await pool.query("SELECT kind FROM live_costs WHERE session_id = $1", [sessao.id]);
  assert.deepEqual(custo.map((c) => c.kind), ['juiz']);
});

test('juiz nao roda antes de 5 minutos do anterior, mas sempre roda no fim da live', async () => {
  const canal = await novoCanal();
  const sessao = await novaSessao(canal, { recorded: 600 });
  for (let t = 0; t < 600; t += 30) await blocoTranscrito(sessao, t, t + 30, 'fala');
  await livesRepository.insertCandidate({ sessionId: sessao.id, source: 'triagem', inicio: 100, fim: 140, nota: 8 });
  let chamadas = 0;
  const desfazer = trocar(openaiLives, 'pedirJson', async () => {
    chamadas += 1;
    return { dados: { avaliacoes: [] }, inputTokens: 1, outputTokens: 1, custoUsd: 0 };
  });
  try {
    const recente = { ...sessao, last_selection_at: new Date(Date.now() - 60_000) };
    await liveAnalysisService.julgarSessao(recente);
    assert.equal(chamadas, 0);
    await liveAnalysisService.julgarSessao({ ...recente, status: 'encerrada' });
    assert.equal(chamadas, 1);
  } finally {
    desfazer();
  }
  const { rows } = await pool.query("SELECT count(*)::int AS n FROM live_candidates WHERE session_id = $1 AND status = 'pendente'", [sessao.id]);
  assert.equal(rows[0].n, 0, 'com a live encerrada, o que o juiz nao aprovou sai da fila');
});

test('cada usuario recebe so o que passa no nivel de qualidade dele, sem duplicar', async () => {
  const canal = await novoCanal();
  const exigente = await createClient();
  const tolerante = await createClient();
  await livesRepository.follow(exigente.id, canal.id);
  await livesRepository.follow(tolerante.id, canal.id);
  await livesRepository.upsertClipSettings(exigente.id, { ...livesUserSettings.PADRAO, qualidade: 5 });
  await livesRepository.upsertClipSettings(tolerante.id, { ...livesUserSettings.PADRAO, qualidade: 1 });
  const sessao = await novaSessao(canal, { recorded: 1800 });
  for (const [ini, nota] of [[100, 9], [300, 7], [500, 5], [700, 4]]) {
    const c = await livesRepository.insertCandidate({ sessionId: sessao.id, source: 'triagem', inicio: ini, fim: ini + 40, nota: 8 });
    await livesRepository.judgeCandidate(c.id, {
      status: nota >= 5 ? 'escolhido' : 'descartado', nota, inicio: ini, fim: ini + 40, titulo: `t${nota}`, gancho: '', porque: '',
    });
  }
  await liveAnalysisService.distribuirSessao(sessao);
  await liveAnalysisService.distribuirSessao(sessao); // segunda volta nao duplica
  const notas = async (u) =>
    (await pool.query('SELECT score FROM live_clips WHERE session_id = $1 AND user_id = $2 ORDER BY score DESC', [sessao.id, u.id])).rows.map((r) => r.score);
  assert.deepEqual(await notas(exigente), [9], 'nivel 5: so nota 9+');
  assert.deepEqual(await notas(tolerante), [9, 7, 5], 'nivel 1: nota 5+');
});

test('o mesmo momento por dois caminhos (triagem e pico) vira UM corte so', async () => {
  const canal = await novoCanal();
  const u = await createClient();
  await livesRepository.follow(u.id, canal.id);
  await livesRepository.upsertClipSettings(u.id, { ...livesUserSettings.PADRAO, qualidade: 1 });
  const sessao = await novaSessao(canal, { recorded: 1800 });
  for (const [fonte, ini, titulo] of [['triagem', 300, '50 mil numa noite'], ['sinal', 305, 'Cinquenta mil numa noite'], ['sinal', 900, 'outro momento']]) {
    const c = await livesRepository.insertCandidate({ sessionId: sessao.id, source: fonte, inicio: ini, fim: ini + 40, nota: 8 });
    await livesRepository.judgeCandidate(c.id, { status: 'escolhido', nota: 9, inicio: ini, fim: ini + 40, titulo, gancho: '', porque: '' });
  }
  await liveAnalysisService.distribuirSessao(sessao);
  const { rows } = await pool.query('SELECT title FROM live_clips WHERE session_id = $1 ORDER BY start_offset', [sessao.id]);
  assert.deepEqual(rows.map((r) => r.title), ['50 mil numa noite', 'outro momento']);
});

test('o teto por hora do nivel vale mesmo com muitos aprovados', async () => {
  const canal = await novoCanal();
  const u = await createClient();
  await livesRepository.follow(u.id, canal.id);
  await livesRepository.upsertClipSettings(u.id, { ...livesUserSettings.PADRAO, qualidade: 4 }); // ate 3 por hora
  const sessao = await novaSessao(canal, { recorded: 1800 });
  for (let i = 0; i < 6; i += 1) {
    const c = await livesRepository.insertCandidate({ sessionId: sessao.id, source: 'sinal', inicio: i * 100, fim: i * 100 + 40 });
    await livesRepository.judgeCandidate(c.id, { status: 'escolhido', nota: 9, inicio: i * 100, fim: i * 100 + 40, titulo: 'x', gancho: '', porque: '' });
  }
  await liveAnalysisService.distribuirSessao(sessao);
  const { rows } = await pool.query('SELECT count(*)::int AS n, min(source) AS origem FROM live_clips WHERE session_id = $1', [sessao.id]);
  assert.equal(rows[0].n, 3);
  assert.equal(rows[0].origem, 'sinal');
});

// ------------------------------------------------------------------ sinais do publico

test('chat: uma risada por mensagem, e reacao conta a parte', () => {
  assert.deepEqual(liveChatService.classificar('KKKKKKKKKKKKKK kkkkk'), { risada: true, hype: false });
  assert.deepEqual(liveChatService.classificar('KEKW'), { risada: true, hype: false });
  assert.deepEqual(liveChatService.classificar('???'), { risada: false, hype: true });
  assert.deepEqual(liveChatService.classificar('PogChamp que isso'), { risada: false, hype: true });
  assert.deepEqual(liveChatService.classificar('boa noite chat'), { risada: false, hype: false });
});

test('hora de relogio vira tempo da gravacao, inclusive depois de pausa de anuncio', () => {
  const t0 = Date.parse('2026-09-28T22:00:00Z');
  // 3 pedacos de 10s, e uma pausa de 60s (anuncio) antes do 3o.
  const pedacos = [
    { fim: 10, fechouEm: t0 + 10_000 },
    { fim: 20, fechouEm: t0 + 20_000 },
    { fim: 30, fechouEm: t0 + 90_000 },
  ];
  const para = liveSignalsService.relogioParaGravacao(pedacos);
  assert.equal(para(t0 + 15_000), 15);
  // Durante o anuncio a gravacao nao anda: evento cai onde ela retomou.
  assert.equal(para(t0 + 50_000), 20);
  assert.equal(para(t0 + 85_000), 25);
});

test('pico do chat, risadas e clipe de espectador viram candidato com o momento ANTES da reacao', () => {
  const t0 = Date.parse('2026-09-28T22:00:00Z');
  const pedacos = Array.from({ length: 60 }, (_, i) => ({ fim: (i + 1) * 10, fechouEm: t0 + (i + 1) * 10_000 }));
  // Chat normal: 5 msgs a cada 5s. Aos ~305s de relogio: explosao com risada.
  const chat = [];
  for (let s = 0; s < 600; s += 5) chat.push({ em: t0 + s * 1000, msgs: 5, risadas: 0, hype: 0 });
  chat.find((b) => b.em === t0 + 305_000).msgs = 40;
  chat.find((b) => b.em === t0 + 305_000).risadas = 25;
  const clipes = [{ titulo: 'ahahaha', views: 3, duracao: 30, em: t0 + 312_000 }];
  const linha = liveSignalsService.montarLinhaDoTempo({ pedacos, chat, clipes, volume: [] }, 600);
  const picos = liveSignalsService.picos(linha, 600);
  assert.equal(picos.length, 1);
  const [p] = picos;
  // Reacao do chat aos 300s (305 - 5s de atraso) => o corte comeca ~40s antes.
  assert.ok(p.inicio <= 260 && p.inicio >= 240, `inicio ${p.inicio}`);
  assert.ok(p.fim >= 310 && p.fim <= 330, `fim ${p.fim}`);
  assert.match(p.descricao, /risada/);
  assert.match(p.descricao, /clipe\(s\) criado\(s\) por espectadores \("ahahaha"\)/);
});

test('live sem reacao nenhuma nao gera pico (chat constante nao e momento)', () => {
  const t0 = Date.parse('2026-09-28T22:00:00Z');
  const pedacos = Array.from({ length: 60 }, (_, i) => ({ fim: (i + 1) * 10, fechouEm: t0 + (i + 1) * 10_000 }));
  const chat = Array.from({ length: 120 }, (_, i) => ({ em: t0 + i * 5000, msgs: 8, risadas: 1, hype: 0 }));
  const linha = liveSignalsService.montarLinhaDoTempo({ pedacos, chat, clipes: [], volume: [] }, 600);
  assert.deepEqual(liveSignalsService.picos(linha, 600), []);
});

// ------------------------------------------------------------------ camera

test('layout da camera: recorta a webcam pela fracao e empilha em cima do conteudo', () => {
  const r = videoEditingService.buildWebcamFilter({
    w: 1080, h: 1920, subtitlesFilter: null, cam: { x: 0.02, y: 0.7, largura: 0.18, altura: 0.3 }, heightPercent: 40, position: 'top',
  });
  assert.match(r.filterComplex, /crop=iw\*0\.1800:ih\*0\.3000:iw\*0\.0200:ih\*0\.7000/);
  assert.match(r.filterComplex, /scale=1080:768:force_original_aspect_ratio=increase,crop=1080:768/);
  assert.match(r.filterComplex, /\[camera\]\[conteudo\]vstack/);
  const embaixo = videoEditingService.buildWebcamFilter({ w: 1080, h: 1920, cam: { x: 0, y: 0, largura: 0.3, altura: 0.3 }, heightPercent: 40, position: 'bottom' });
  assert.match(embaixo.filterComplex, /\[conteudo\]\[camera\]vstack/);
});

test('o render escolhe o layout da camera quando o corte traz a webcam', () => {
  const cam = { x: 0.02, y: 0.7, largura: 0.18, altura: 0.3 };
  const r = videoEditingService.buildFilter({ w: 1080, h: 1920, subtitlesFilter: null, fundo: { style: 'webcam', cam, heightPercent: 40, position: 'top' } });
  assert.match(r.filterComplex, /\[camera\]\[conteudo\]vstack/);
  // E sem webcam, nada muda pros cortes do YouTube.
  const semCamera = videoEditingService.buildFilter({ w: 1080, h: 1920, subtitlesFilter: null, fundo: null });
  assert.ok(semCamera.simpleFilter && !/vstack/.test(semCamera.simpleFilter));
});

async function cameraCom(respostas) {
  const fila = [...respostas];
  const desfazer = [
    trocar(videoEditingService, 'runFfmpeg', async (args) => { fs.writeFileSync(args[args.length - 1], 'jpg'); }),
    trocar(openaiLives, 'pedirJson', async () => ({ dados: fila.shift(), inputTokens: 1, outputTokens: 1, custoUsd: 0 })),
  ];
  try {
    return await liveRenderService.localizarCamera(path.join(os.tmpdir(), `bruto-${Date.now()}.mp4`), 0, 40, async () => {});
  } finally {
    desfazer.forEach((d) => d());
  }
}

test('camera: aceita a webcam no canto quando os dois quadros concordam, recortando a janela exata', async () => {
  const canto = { tem_webcam: true, x: 0.02, y: 0.6, largura: 0.2, altura: 0.31, confianca: 90 };
  const cam = await cameraCom([canto, { ...canto, x: 0.025 }]);
  assert.ok(cam, 'devia aceitar');
  // Sem folga: a janela exata (media dos dois quadros). Folga pegava a borda
  // preta e o @ do canal em volta da camera.
  assert.ok(Math.abs(cam.x - 0.0225) < 1e-9 && Math.abs(cam.largura - 0.2) < 1e-9);
});

test('camera: rosto GRANDE do video assistido (erro real de 28/09) e recusado', async () => {
  // Numeros exatos que a IA devolveu no corte 7 do teste: o rosto do video de
  // "react", nao a webcam.
  const rosto = { tem_webcam: true, x: 0.2412, y: 0.0264, largura: 0.5376, altura: 0.6272, confianca: 85 };
  assert.equal(await cameraCom([rosto, rosto]), null);
});

test('camera: quadros que discordam (algo que se mexe) sao recusados', async () => {
  const a = { tem_webcam: true, x: 0.02, y: 0.6, largura: 0.2, altura: 0.3, confianca: 90 };
  const b = { tem_webcam: true, x: 0.7, y: 0.05, largura: 0.2, altura: 0.3, confianca: 90 };
  assert.equal(await cameraCom([a, b]), null);
  assert.equal(await cameraCom([a, { ...a, tem_webcam: false }]), null);
});

// ------------------------------------------------------------------ formato escolhido pela IA

const FONTE_720P = { w: 1280, h: 720 };
const painel = (extra) => ({ mostra: 'x', x: 0, y: 0, largura: 0.3, altura: 0.8, foco_x: 0.15, foco_y: 0.3, altura_na_tela: 50, ...extra });

test('formato: duas pessoas nas pontas viram dois paineis, cada um centrado no rosto, somando a tela toda', () => {
  const f = liveFormatoService.montarFormato({
    pessoas_da_live: [{}, {}],
    formato: 'paineis',
    paineis: [
      painel({ mostra: 'esquerda', x: 0.02, foco_x: 0.15 }),
      painel({ mostra: 'direita', x: 0.68, foco_x: 0.83 }),
    ],
    motivo: 'duas pessoas nas pontas',
  }, FONTE_720P);
  assert.equal(f.tipo, 'paineis');
  assert.equal(f.paineis.length, 2);
  assert.equal(f.paineis.reduce((s, p) => s + p.alturaPercent, 0), 100);
  // A pessoa da direita fica no painel dela - o recorte nao volta pro meio.
  const direita = f.paineis[1];
  assert.ok(direita.x + direita.largura / 2 > 0.7, `centro ${direita.x + direita.largura / 2}`);
  // Nenhum recorte sai do quadro.
  for (const p of f.paineis) assert.ok(p.x >= 0 && p.y >= 0 && p.x + p.largura <= 1.0001 && p.y + p.altura <= 1.0001);
});

test('formato: o recorte tem EXATAMENTE a proporcao do painel (sem distorcer a pessoa)', () => {
  for (const variosPaineis of [false, true]) {
    const r = liveFormatoService.encaixarRecorte(
      { x: 0.35, y: 0.1, largura: 0.3, altura: 0.8, focoX: 0.5, focoY: 0.3 },
      { w: 1080, h: 960 },
      FONTE_720P,
      { variosPaineis }
    );
    const proporcao = (r.largura * FONTE_720P.w) / (r.altura * FONTE_720P.h);
    assert.ok(Math.abs(proporcao - 1080 / 960) < 0.01, `proporcao ${proporcao}`);
  }
});

test('formato: sem ninguem NA live (so personagem de jogo/desenho), no maximo um painel', () => {
  const f = liveFormatoService.montarFormato({
    pessoas_da_live: [],
    formato: 'paineis',
    paineis: [painel({ x: 0 }), painel({ x: 0.35 }), painel({ x: 0.7 })],
    motivo: 'tres personagens da arte do jogo',
  }, FONTE_720P);
  assert.equal(f.paineis.length, 1);
  assert.equal(f.paineis[0].alturaPercent, 100);
});

test('formato: paineis sobre a mesma area viram um so', () => {
  const f = liveFormatoService.montarFormato({
    pessoas_da_live: [{}, {}],
    formato: 'paineis',
    paineis: [
      painel({ mostra: 'filme', x: 0, y: 0, largura: 0.8, altura: 0.9, altura_na_tela: 50 }),
      painel({ mostra: 'webcam', x: 0.8, y: 0.7, largura: 0.2, altura: 0.3, foco_x: 0.9, foco_y: 0.8, altura_na_tela: 30 }),
      painel({ mostra: 'alguem atras na webcam', x: 0.82, y: 0.72, largura: 0.15, altura: 0.25, foco_x: 0.9, foco_y: 0.8, altura_na_tela: 20 }),
    ],
    motivo: '',
  }, FONTE_720P);
  assert.deepEqual(f.paineis.map((p) => p.mostra), ['filme', 'webcam']);
  assert.equal(f.paineis.reduce((s, p) => s + p.alturaPercent, 0), 100);
});

test('formato: live de react - webcam da live que ficou fora dos paineis ganha painel (erro real de 29/09)', () => {
  // O que a IA respondeu no corte 7 do wb3nji: tomou o youtuber do video
  // assistido (grande, no meio) pelo streamer e fez um painel so pra ele.
  const webcam = { tipo: 'webcam', x: 0.02, y: 0.62, largura: 0.2, altura: 0.31, foco_x: 0.1, foco_y: 0.72 };
  const resposta = {
    pessoas_da_live: [webcam],
    formato: 'paineis',
    paineis: [painel({ mostra: 'video assistido', x: 0.25, y: 0.05, largura: 0.5, altura: 0.9, foco_x: 0.5, foco_y: 0.35, altura_na_tela: 100 })],
    motivo: '',
  };
  const f = liveFormatoService.montarFormato(liveFormatoService.garantirPessoas(resposta), FONTE_720P);
  assert.deepEqual(f.paineis.map((p) => p.mostra), ['video assistido', 'webcam do streamer']);
  // Quadro inteiro com webcam: vira conteudo + webcam (no quadro inteiro ela
  // seria um quadradinho).
  const inteiro = liveFormatoService.montarFormato(liveFormatoService.garantirPessoas({ ...resposta, formato: 'quadro_inteiro', paineis: [] }), FONTE_720P);
  assert.deepEqual(inteiro.paineis.map((p) => p.mostra), ['conteudo', 'webcam do streamer']);
});

test('formato: webcam DENTRO do painel do conteudo nao conta como mostrada, e nao e "repetida"', () => {
  const webcam = { tipo: 'webcam', x: 0.75, y: 0.7, largura: 0.2, altura: 0.25, foco_x: 0.85, foco_y: 0.8 };
  const r = liveFormatoService.garantirPessoas({
    pessoas_da_live: [webcam],
    formato: 'paineis',
    paineis: [painel({ mostra: 'tela toda', x: 0, y: 0, largura: 1, altura: 1, altura_na_tela: 100 })],
    motivo: '',
  });
  const f = liveFormatoService.montarFormato(r, FONTE_720P);
  assert.deepEqual(f.paineis.map((p) => p.mostra), ['tela toda', 'webcam do streamer']);
});

test('formato: pessoa da live esquecida pela IA ganha painel; se nao couber, quadro inteiro', () => {
  const esq = { tipo: 'vtuber', x: 0.02, y: 0.2, largura: 0.3, altura: 0.7, foco_x: 0.17, foco_y: 0.35 };
  const dir = { tipo: 'vtuber', x: 0.68, y: 0.2, largura: 0.3, altura: 0.7, foco_x: 0.83, foco_y: 0.35 };
  const soUma = { pessoas_da_live: [esq, dir], formato: 'paineis', paineis: [painel({ ...esq, mostra: 'vtuber verde', altura_na_tela: 100 })], motivo: '' };
  const f = liveFormatoService.montarFormato(liveFormatoService.garantirPessoas(soUma), FONTE_720P);
  assert.equal(f.paineis.length, 2);
  assert.ok(f.paineis[1].x + f.paineis[1].largura / 2 > 0.7, 'a da direita ganhou o painel dela');
  // Quatro pessoas e so um painel: nao cabe em 3 -> quadro inteiro.
  const quatro = [0, 0.25, 0.5, 0.75].map((x) => ({ tipo: 'na_camera', x, y: 0.2, largura: 0.2, altura: 0.6, foco_x: x + 0.1, foco_y: 0.35 }));
  const g = liveFormatoService.garantirPessoas({ pessoas_da_live: quatro, formato: 'paineis', paineis: [painel({ x: 0, largura: 0.2 })], motivo: '' });
  assert.equal(g.formato, 'quadro_inteiro');
});

test('formato: "webcam" que nao muda entre os quadros e a foto do canal, e sai do corte', async () => {
  const foto = { tipo: 'webcam', x: 0.02, y: 0.55, largura: 0.2, altura: 0.25, foco_x: 0.12, foco_y: 0.65 };
  const pessoaDeVerdade = { tipo: 'na_camera', x: 0.3, y: 0.2, largura: 0.4, altura: 0.7, foco_x: 0.5, foco_y: 0.35 };
  const resposta = {
    pessoas_da_live: [foto, pessoaDeVerdade],
    formato: 'paineis',
    paineis: [
      painel({ mostra: 'foto do canal', ...foto, altura_na_tela: 35 }),
      painel({ mostra: 'programa', ...pessoaDeVerdade, altura_na_tela: 65 }),
    ],
    motivo: '',
  };
  // Mudanca medida: a foto nao mexe (0,3), a pessoa sim (13).
  const desfazer = trocar(liveFormatoService, 'mudancaNaArea', async (_a, _b, c) => (c.x < 0.1 ? 0.3 : 13));
  try {
    const r = await liveFormatoService.descartarImagensParadas(resposta, ['a.jpg', 'b.jpg'], FONTE_720P);
    assert.deepEqual(r.pessoas_da_live, [pessoaDeVerdade]);
    assert.deepEqual(r.paineis.map((p) => p.mostra), ['programa']);
  } finally {
    desfazer();
  }
});

test('formato: painel da webcam recorta EXATAMENTE a janela da camera, com a altura no formato dela', () => {
  // Pedido de 29/09: a webcam era esticada pro painel e o recorte saia da
  // janela, pegando a borda preta, o @ do canal e os icones em volta.
  const janela = { tipo: 'webcam', x: 0.02, y: 0.62, largura: 0.2, altura: 0.31, foco_x: 0.12, foco_y: 0.75 };
  const f = liveFormatoService.montarFormato({
    pessoas_da_live: [janela],
    formato: 'paineis',
    paineis: [
      painel({ mostra: 'conteudo', x: 0.25, y: 0, largura: 0.5, altura: 1, altura_na_tela: 65 }),
      // A IA pediu a webcam com folga e 35% de altura - quem manda e a janela.
      painel({ mostra: 'webcam', x: 0, y: 0.55, largura: 0.3, altura: 0.45, altura_na_tela: 35 }),
    ],
    motivo: '',
  }, FONTE_720P);
  const [conteudo, cam] = f.paineis;
  assert.equal(cam.janelaDaCamera, true);
  // 256x223 px de camera -> 1080x942 no corte = 49% da tela.
  assert.equal(cam.alturaPercent, 49);
  assert.equal(conteudo.alturaPercent, 51);
  // O recorte e a janela (so arredondamento), nada em volta dela.
  assert.ok(cam.x >= janela.x - 0.001 && cam.x + cam.largura <= janela.x + janela.largura + 0.001);
  assert.ok(cam.y >= janela.y - 0.001 && cam.y + cam.altura <= janela.y + janela.altura + 0.001);
  assert.ok(cam.largura > 0.19 && cam.altura > 0.3, 'a cena inteira da camera');
});

test('formato: camera muito alta cabe no teto de 50% cortando pra DENTRO, nunca pra fora', () => {
  const alta = { tipo: 'webcam', x: 0.8, y: 0.1, largura: 0.15, altura: 0.8, foco_x: 0.87, foco_y: 0.3 };
  const f = liveFormatoService.montarFormato({
    pessoas_da_live: [alta],
    formato: 'paineis',
    paineis: [painel({ mostra: 'jogo', x: 0, y: 0, largura: 0.8, altura: 1, altura_na_tela: 60 }), painel({ mostra: 'webcam', ...alta, altura_na_tela: 40 })],
    motivo: '',
  }, FONTE_720P);
  const cam = f.paineis[1];
  assert.equal(cam.alturaPercent, 50);
  assert.ok(cam.x >= alta.x - 0.001 && cam.x + cam.largura <= alta.x + alta.largura + 0.001);
  assert.ok(cam.y >= alta.y - 0.001 && cam.y + cam.altura <= alta.y + alta.altura + 0.001);
});

test('formato: resposta inutilizavel cai no quadro inteiro (nunca deixa ninguem de fora)', () => {
  assert.equal(liveFormatoService.montarFormato(null, FONTE_720P).tipo, 'quadro_inteiro');
  assert.equal(liveFormatoService.montarFormato({ pessoas_da_live: [{}], formato: 'paineis', paineis: [], motivo: '' }, FONTE_720P).tipo, 'quadro_inteiro');
  const minusculo = { pessoas_da_live: [{}], formato: 'paineis', paineis: [painel({ largura: 0.01, altura: 0.01 })], motivo: '' };
  assert.equal(liveFormatoService.montarFormato(minusculo, FONTE_720P).tipo, 'quadro_inteiro');
  assert.equal(liveFormatoService.montarFormato({ pessoas_da_live: [], formato: 'quadro_inteiro', paineis: [], motivo: 'grupo' }, FONTE_720P).tipo, 'quadro_inteiro');
});

test('formato: o render empilha os paineis (alturas pares somando 1920) ou mostra o quadro inteiro', () => {
  const paineis = [
    { x: 0, y: 0, largura: 0.5, altura: 1, alturaPercent: 33 },
    { x: 0.5, y: 0, largura: 0.5, altura: 1, alturaPercent: 33 },
    { x: 0.25, y: 0, largura: 0.5, altura: 1, alturaPercent: 34 },
  ];
  const r = videoEditingService.buildFilter({ w: 1080, h: 1920, subtitlesFilter: null, fundo: { style: 'formato_ia', formato: { tipo: 'paineis', paineis } } });
  const alturas = [...r.filterComplex.matchAll(/crop=1080:(\d+),setsar=1\[painel/g)].map((m) => Number(m[1]));
  assert.equal(alturas.length, 3);
  assert.equal(alturas.reduce((a, b) => a + b, 0), 1920);
  assert.ok(alturas.every((a) => a % 2 === 0));
  assert.match(r.filterComplex, /vstack=inputs=3/);
  const inteiro = videoEditingService.buildFilter({ w: 1080, h: 1920, subtitlesFilter: null, fundo: { style: 'formato_ia', formato: { tipo: 'quadro_inteiro', paineis: [] } } });
  assert.match(inteiro.filterComplex, /scale=1080:-2/);
  assert.match(inteiro.filterComplex, /boxblur/);
});

test('titulo cartao: letra escura em caixa clara, clara em caixa escura, e a imagem existe', () => {
  assert.equal(videoEditingService.letraPelaCaixa('#FFD700'), '&H00000000', 'amarelo pede letra preta');
  assert.equal(videoEditingService.letraPelaCaixa('#FFFFFF'), '&H00000000');
  assert.equal(videoEditingService.letraPelaCaixa('#D92323'), '&H00FFFFFF', 'vermelho pede letra branca');
  assert.equal(videoEditingService.letraPelaCaixa('#101010'), '&H00FFFFFF');
  assert.ok(fs.existsSync(videoEditingService.CAMINHO_CARTAO), 'assets/imagens/cartao-titulo.png no repositorio');
  assert.ok(videoEditingService.TITLE_STYLES.cartao);
});

// ------------------------------------------------------------------ fim do corte, juiz e cartao (29/09)

test('fim do corte vai ate o FIM da frase (caso real: terminou em "que pode..." e perdeu o desfecho)', () => {
  // Frases como o Whisper devolve, no eixo do arquivo de trabalho.
  const segments = [
    { start: 20.0, end: 24.8, text: 'Nao conhece. Ta vendo ai, um amigo mesmo.' },
    { start: 25.2, end: 36.4, text: 'Tem uma outra pessoa tambem vindo, um outro homem que ja foi seu amigo, que pode pedir uma chance de novo, mas nao vai ser uma boa, ta?' },
    { start: 37.0, end: 38.2, text: 'Ta bom.' },
  ];
  // A IA pediu pra terminar em 29,4s - no meio da frase, antes do desfecho.
  const r = liveRenderService.encaixarNaFala({ inicio: 21, fim: 29.4, segments, words: [], duracao: 60 });
  assert.equal(r.fim, 36.8, 'termina no fim da frase (36,4s) + respiro');
  assert.equal(r.inicio, 19.85, 'comeca no inicio da frase');
});

test('fim do corte sem frase perto: usa a pausa entre palavras mais proxima', () => {
  const words = [
    { word: 'a', start: 10, end: 10.3 }, { word: 'b', start: 10.35, end: 10.7 },
    { word: 'c', start: 11.5, end: 11.9 }, // pausa de 0,8s antes de "c"
    { word: 'd', start: 11.95, end: 12.3 },
  ];
  const r = liveRenderService.encaixarNaFala({ inicio: 0, fim: 10.4, segments: [], words, duracao: 60 });
  assert.equal(r.fim, 11.1, 'fim na pausa depois de "b" + respiro');
});

test('fim do corte nunca passa de 90s: volta pro fim de uma frase que caiba', () => {
  const segments = [{ start: 0, end: 50, text: 'x' }, { start: 50.5, end: 85, text: 'y' }, { start: 85.5, end: 100, text: 'z' }];
  const r = liveRenderService.encaixarNaFala({ inicio: 0, fim: 95, segments, words: [], duracao: 120 });
  assert.equal(r.fim, 85.4);
});

test('juiz: sem desfecho a nota nao passa de 6; sem contexto, de 5; gancho fraco, de 7', () => {
  const { aplicarTetos } = liveAnalysisService;
  assert.equal(aplicarTetos({ nota: 9, gancho_forte: 9, desfecho_claro: 9, emocao: 9, entende_sozinho: true }), 9);
  assert.equal(aplicarTetos({ nota: 9, gancho_forte: 9, desfecho_claro: 4, emocao: 9, entende_sozinho: true }), 6);
  assert.equal(aplicarTetos({ nota: 9, gancho_forte: 9, desfecho_claro: 9, emocao: 9, entende_sozinho: false }), 5);
  assert.equal(aplicarTetos({ nota: 9, gancho_forte: 4, desfecho_claro: 9, emocao: 9, entende_sozinho: true }), 7);
});

test('nivel maximo exige reacao forte do PUBLICO, nao so nota alta', async () => {
  const canal = await novoCanal();
  const u = await createClient();
  await livesRepository.follow(u.id, canal.id);
  await livesRepository.upsertClipSettings(u.id, { ...livesUserSettings.PADRAO, qualidade: 5 });
  const sessao = await novaSessao(canal, { recorded: 600 });
  // Linha do tempo: pedacos de 10s fechando no relogio, e chat normal (5
  // msgs/5s) com UM pico forte aos ~400s de gravacao.
  const t0 = Date.now() - 600_000;
  await livesRepository.insertSegments(sessao.id, 'video', Array.from({ length: 60 }, (_, i) => ({
    seq: i, file_path: `/x/${i}.ts`, start_offset: i * 10, end_offset: (i + 1) * 10, bytes: 1,
    closed_at: new Date(t0 + (i + 1) * 10_000).toISOString(),
  })));
  const baldes = Array.from({ length: 120 }, (_, i) => ({ bucket_at: new Date(t0 + i * 5000).toISOString(), msgs: 5, risadas: 0, hype: 0 }));
  baldes[81] = { ...baldes[81], msgs: 60, risadas: 30 };
  await livesRepository.saveChatBuckets(sessao.id, baldes);
  // Dois candidatos nota 9: um NO pico, outro num trecho sem reacao.
  for (const [ini, titulo] of [[370, 'no pico'], [100, 'sem reacao']]) {
    const c = await livesRepository.insertCandidate({ sessionId: sessao.id, source: 'triagem', inicio: ini, fim: ini + 40, nota: 8 });
    await livesRepository.judgeCandidate(c.id, { status: 'escolhido', nota: 9, inicio: ini, fim: ini + 40, titulo, gancho: '', porque: '' });
  }
  await liveAnalysisService.distribuirSessao(sessao);
  const { rows } = await pool.query('SELECT title FROM live_clips WHERE session_id = $1', [sessao.id]);
  assert.deepEqual(rows.map((r) => r.title), ['no pico']);
});

test('cartao do titulo: sem sombra (bordas transparentes), no tamanho pedido', () => {
  const zlib = require('zlib');
  const { gerarPng } = require('../../src/lib/cartaoTitulo');
  const png = gerarPng(400, 200);
  assert.equal(png.readUInt32BE(16), 400);
  assert.equal(png.readUInt32BE(20), 200);
  // Descomprime e confere o canto (fora do arredondado) e o meio da borda de
  // cima: nada de "sombra" - alfa zero no canto, cartao opaco no meio.
  const idat = png.subarray(png.indexOf('IDAT') + 4, png.indexOf('IEND') - 8);
  const cru = zlib.inflateSync(idat);
  const alfa = (x, y) => cru[y * (1 + 400 * 4) + 1 + x * 4 + 3];
  assert.equal(alfa(0, 0), 0, 'canto transparente');
  assert.equal(alfa(399, 199), 0);
  assert.equal(alfa(200, 100), 255, 'miolo opaco');
});

test('retangulo de camera absurdo e recusado (cai no layout normal)', () => {
  assert.equal(videoEditingService.webcamValida({ x: 0.9, y: 0.9, largura: 0.3, altura: 0.3 }), null, 'sai do quadro');
  assert.equal(videoEditingService.webcamValida({ x: 0, y: 0, largura: 0.01, altura: 0.2 }), null, 'pequeno demais');
  assert.equal(videoEditingService.webcamValida({ x: 0, y: 0, largura: 0.95, altura: 0.95 }), null, 'a live inteira');
  assert.equal(videoEditingService.webcamValida(null), null);
  assert.ok(videoEditingService.webcamValida({ x: 0.02, y: 0.7, largura: 0.18, altura: 0.3 }));
});

// ------------------------------------------------------------------ 7

function capturaFalsa() {
  const iniciadas = [];
  const paradas = [];
  const ativas = new Set();
  const desfazer = [
    trocar(liveCaptureService, 'iniciar', ({ sessionId, login }) => { iniciadas.push(login); ativas.add(sessionId); }),
    trocar(liveCaptureService, 'parar', async (sessionId, motivo) => { paradas.push(motivo); ativas.delete(sessionId); await livesRepository.endSession(sessionId, { status: 'encerrada', motivo }); }),
    trocar(liveCaptureService, 'pararTodas', async () => {}),
    trocar(liveCaptureService, 'gravando', (id) => ativas.has(id)),
    trocar(liveCaptureService, 'quantasGravando', () => ativas.size),
    trocar(liveCleanupService, 'usoDoDiscoPercent', () => 30),
    // Sem isto o teste conecta de verdade no chat da Twitch e o processo
    // nunca termina (a conexao se reabre sozinha quando cai).
    trocar(liveChatService, 'acompanhar', () => {}),
    trocar(liveChatService, 'parar', async () => {}),
  ];
  return { iniciadas, paradas, desfazer: () => desfazer.forEach((d) => d()) };
}

async function limparVigiados() {
  // Os testes compartilham o banco: deixa so os canais deste teste vigiados.
  await pool.query('UPDATE live_channel_follows SET is_active = false');
  await pool.query("UPDATE live_sessions SET status = 'encerrada', ended_at = now() WHERE status = 'gravando'");
}

test('com o modulo desligado o supervisor nao consulta a Twitch nem grava nada', async () => {
  await limparVigiados();
  const canal = await novoCanal();
  const u = await createClient();
  await livesRepository.follow(u.id, canal.id);
  const cap = capturaFalsa();
  let consultou = false;
  const desfazer = [
    trocar(livesSettings, 'estaLigado', async () => false),
    trocar(twitchApi, 'buscarAoVivo', async () => { consultou = true; return new Map(); }),
  ];
  try {
    await liveSupervisor.monitorar();
  } finally {
    desfazer.forEach((d) => d());
    cap.desfazer();
  }
  assert.equal(consultou, false);
  assert.deepEqual(cap.iniciadas, []);
});

test('supervisor grava quem esta ao vivo ate o limite de canais, e para quando a live acaba', async () => {
  await limparVigiados();
  const u = await createClient();
  const canais = [await novoCanal(), await novoCanal(), await novoCanal()];
  for (const c of canais) await livesRepository.follow(u.id, c.id);
  const cap = capturaFalsa();
  let aoVivo = new Map(canais.map((c) => [c.login, { streamId: '1', titulo: 't', jogo: 'j', espectadores: 10 }]));
  const desfazer = [
    trocar(livesSettings, 'estaLigado', async () => true),
    trocar(livesSettings, 'obterConfig', async () => ({ ...livesSettings.PADRAO, maxCanais: 2 })),
    trocar(twitchApi, 'buscarAoVivo', async () => aoVivo),
  ];
  try {
    await liveSupervisor.monitorar();
    assert.equal(cap.iniciadas.length, 2, 'limite de 2 canais gravando');
    await liveSupervisor.monitorar();
    assert.equal(cap.iniciadas.length, 2, 'nao abre gravacao repetida');

    aoVivo = new Map();
    await liveSupervisor.monitorar();
    assert.deepEqual(cap.paradas, ['live terminou', 'live terminou']);
  } finally {
    desfazer.forEach((d) => d());
    cap.desfazer();
  }
  const { rows } = await pool.query('SELECT is_live FROM live_channels WHERE id = ANY($1::bigint[])', [canais.map((c) => c.id)]);
  assert.ok(rows.every((r) => r.is_live === false));
});

test('captura avisa o fim UMA vez so, mesmo com error e close no mesmo processo', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-'));
  const filhos = [];
  const spawnFalso = () => {
    const f = new EventEmitter();
    f.pid = 999999; // grupo que nao existe: o kill falha em silencio
    f.exitCode = null;
    f.signalCode = null;
    f.stdout = new EventEmitter();
    f.stdout.pipe = () => {};
    f.stderr = new EventEmitter();
    f.stdin = new EventEmitter();
    filhos.push(f);
    return f;
  };
  const avisos = [];
  const g = liveCaptureService.iniciar({ sessionId: 424242, login: 'x', dir, qualidade: '480p', onFim: (i) => avisos.push(i), spawnImpl: spawnFalso });
  const [streamlink, ffmpeg] = filhos;
  streamlink.stderr.emit('data', '[cli][info] Stream ended\n');
  streamlink.emit('error', new Error('ENOENT'));
  streamlink.emit('close', 1);
  // O ffmpeg ainda esta fechando o ultimo pedaco: a sessao nao pode ser
  // encerrada no banco antes disso, senao o inventario final perde o pedaco.
  await new Promise((r) => setImmediate(r));
  assert.equal(avisos.length, 0);
  ffmpeg.emit('close', 0);
  ffmpeg.emit('close', 0);
  await g.terminou;
  assert.equal(avisos.length, 1);
  assert.equal(avisos[0].motivo, 'live terminou');
  assert.equal(liveCaptureService.gravando(424242), false);
});

// ------------------------------------------------------------------ 8

test('retencao apaga os pedacos brutos antigos e marca no banco', async () => {
  const canal = await novoCanal();
  const sessao = await novaSessao(canal);
  const velho = path.join(sessao.dir_path, 'seg_000001.ts');
  const novo = path.join(sessao.dir_path, 'seg_000002.ts');
  fs.writeFileSync(velho, 'x');
  fs.writeFileSync(novo, 'x');
  await livesRepository.insertSegments(sessao.id, 'video', [
    { seq: 1, file_path: velho, start_offset: 0, end_offset: 10, bytes: 1 },
    { seq: 2, file_path: novo, start_offset: 10, end_offset: 20, bytes: 1 },
  ]);
  await pool.query("UPDATE live_segments SET created_at = now() - interval '30 hours' WHERE file_path = $1", [velho]);
  await liveCleanupService.apagarPedacosAntigos(24);
  assert.equal(fs.existsSync(velho), false);
  assert.equal(fs.existsSync(novo), true);
  const { rows } = await pool.query('SELECT file_path, deleted_at IS NOT NULL AS apagado FROM live_segments WHERE session_id = $1 ORDER BY seq', [sessao.id]);
  assert.deepEqual(rows.map((r) => r.apagado), [true, false]);
});

// ------------------------------------------------------------------ 9

test('nenhum codigo do modulo de lives escreve em tabela do fluxo do YouTube', () => {
  const raiz = path.join(__dirname, '..', '..', 'src');
  const arquivos = [
    path.join(raiz, 'repositories', 'livesRepository.js'),
    ...fs.readdirSync(path.join(raiz, 'services', 'lives')).map((f) => path.join(raiz, 'services', 'lives', f)),
    path.join(raiz, 'worker', 'liveSupervisor.js'),
    path.join(raiz, 'web', 'controllers', 'api', 'adminLivesApiController.js'),
  ];
  const escritas = [];
  for (const arq of arquivos) {
    const texto = fs.readFileSync(arq, 'utf8');
    // "DO UPDATE SET" (upsert) e "FOR UPDATE" (trava de linha) nao sao
    // escrita em outra tabela - ficam de fora.
    for (const m of texto.matchAll(/\b(?:INSERT\s+INTO|(?<!DO\s)(?<!FOR\s)UPDATE|DELETE\s+FROM)\s+([a-z_]+)/gi)) {
      escritas.push(`${path.basename(arq)}: ${m[1]}`);
    }
  }
  const foraDoModulo = escritas.filter((e) => !/: (live_\w+|settings)$/.test(e));
  assert.deepEqual(foraDoModulo, []);
  assert.ok(escritas.length > 10, 'a varredura precisa estar achando as escritas');
});
