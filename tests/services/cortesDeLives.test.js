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
//   6. a selecao respeita o teto por hora, ignora id inventado e nota baixa, e
//      faz um corte por usuario que acompanha o canal;
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
  const c = livesSettings.sanitizar({ maxCanais: 50, cortesPorHora: 0, retencaoHoras: 'x', qualidade: '4k', discoMaxPercent: 99 });
  assert.equal(c.maxCanais, 5);
  assert.equal(c.cortesPorHora, 1);
  assert.equal(c.retencaoHoras, livesSettings.PADRAO.retencaoHoras);
  assert.equal(c.qualidade, '480p');
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

test('bloco com fala e transcrito com o fim do bloco anterior como contexto, e o custo e registrado', async () => {
  const canal = await novoCanal();
  const sessao = await novaSessao(canal);
  await blocoTranscrito(sessao, 0, 30, 'e ai galera, bora comecar a partida');
  await livesRepository.insertSegments(sessao.id, 'audio', [{ seq: 99, file_path: '/x/aud2.ogg', start_offset: 30, end_offset: 60, bytes: 1 }]);
  let contextoRecebido = null;
  const desfazer = [
    trocar(liveTranscriptionService, 'analisarAudio', async () => ({ silencioSegundos: 2, loudness: -18, pico: -1 })),
    trocar(openaiLives, 'transcreverBloco', async (_f, { contexto, segundos }) => {
      contextoRecebido = contexto;
      return { texto: 'que jogada absurda', custoUsd: (segundos / 60) * 0.003 };
    }),
  ];
  try {
    while (await liveTranscriptionService.processarProximo()) { /* esvazia a fila */ }
  } finally {
    desfazer.forEach((d) => d());
  }
  assert.equal(contextoRecebido, 'e ai galera, bora comecar a partida');
  const { rows } = await pool.query("SELECT text, loudness_lufs FROM live_transcripts WHERE session_id = $1 AND start_offset = 30", [sessao.id]);
  assert.equal(rows[0].text, 'que jogada absurda');
  const { rows: custo } = await pool.query("SELECT kind, audio_seconds, cost_usd FROM live_costs WHERE session_id = $1", [sessao.id]);
  assert.equal(custo.length, 1);
  assert.equal(custo[0].kind, 'transcricao');
  assert.ok(Math.abs(Number(custo[0].cost_usd) - 0.0015) < 1e-9);
});

test('a leitura da analise de audio bate com a saida REAL do ffmpeg 5.1 do servidor', () => {
  const fixtures = path.join(__dirname, '..', 'fixtures');
  const fala = liveTranscriptionService.interpretarAnalise(fs.readFileSync(path.join(fixtures, 'ffmpeg-analise-fala.txt'), 'utf8'), 30);
  assert.deepEqual(fala, { silencioSegundos: 0, loudness: -16.9, pico: 1.4 });
  const silencio = liveTranscriptionService.interpretarAnalise(fs.readFileSync(path.join(fixtures, 'ffmpeg-analise-silencio.txt'), 'utf8'), 30);
  assert.equal(silencio.silencioSegundos, 30);
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

test('selecao respeita o teto por hora, ignora id inventado e nota baixa, e faz um corte por seguidor', async () => {
  const canal = await novoCanal();
  const [a, b] = [await createClient(), await createClient()];
  await livesRepository.follow(a.id, canal.id);
  await livesRepository.follow(b.id, canal.id);
  const sessao = await novaSessao(canal, { recorded: 1800 });
  const c1 = await livesRepository.insertCandidate({ sessionId: sessao.id, source: 'triagem', inicio: 100, fim: 140, motivo: 'm1', nota: 9 });
  const c2 = await livesRepository.insertCandidate({ sessionId: sessao.id, source: 'triagem', inicio: 300, fim: 340, motivo: 'm2', nota: 8 });
  const c3 = await livesRepository.insertCandidate({ sessionId: sessao.id, source: 'triagem', inicio: 600, fim: 640, motivo: 'm3', nota: 7 });
  let maximoPedido = null;
  const desfazer = trocar(openaiLives, 'pedirJson', async ({ sistema }) => {
    maximoPedido = Number(sistema.match(/NO MAXIMO (\d+)/)[1]);
    return {
      dados: {
        escolhidos: [
          { id: Number(c1.id), inicio_s: 95, fim_s: 138, titulo: 'Que jogada', gancho: 'olha isso', nota: 9 },
          { id: 999999, inicio_s: 0, fim_s: 30, titulo: 'inventado', gancho: '', nota: 10 },
          { id: Number(c3.id), inicio_s: 600, fim_s: 640, titulo: 'fraco', gancho: '', nota: 5 },
          { id: Number(c2.id), inicio_s: 300, fim_s: 340, titulo: 'Segundo', gancho: '', nota: 8 },
        ],
      },
      inputTokens: 2000,
      outputTokens: 200,
      custoUsd: 0.0002,
    };
  });
  try {
    // Teto de 1 por hora; a primeira hora conta inteira -> 1 vaga.
    assert.equal(await liveAnalysisService.selecionarSessao(sessao, { cortesPorHora: 1 }), 1);
  } finally {
    desfazer();
  }
  assert.equal(maximoPedido, 1);
  const { rows: cortes } = await pool.query('SELECT user_id, candidate_id, start_offset, title FROM live_clips WHERE session_id = $1 ORDER BY user_id', [sessao.id]);
  assert.equal(cortes.length, 2, 'um corte pra cada usuario que acompanha o canal');
  assert.deepEqual(cortes.map((c) => Number(c.user_id)), [Number(a.id), Number(b.id)].sort((x, y) => x - y));
  assert.ok(cortes.every((c) => Number(c.candidate_id) === Number(c1.id) && c.title === 'Que jogada'));
  assert.equal(Number(cortes[0].start_offset), 95);
});

test('selecao nao chama a IA antes de 10 minutos da anterior, mas sempre roda no fim da live', async () => {
  const canal = await novoCanal();
  const u = await createClient();
  await livesRepository.follow(u.id, canal.id);
  const sessao = await novaSessao(canal, { recorded: 600 });
  await livesRepository.insertCandidate({ sessionId: sessao.id, source: 'triagem', inicio: 100, fim: 140, nota: 8 });
  let chamadas = 0;
  const desfazer = trocar(openaiLives, 'pedirJson', async () => {
    chamadas += 1;
    return { dados: { escolhidos: [] }, inputTokens: 1, outputTokens: 1, custoUsd: 0 };
  });
  try {
    const recente = { ...sessao, last_selection_at: new Date(Date.now() - 60_000) };
    await liveAnalysisService.selecionarSessao(recente, { cortesPorHora: 5 });
    assert.equal(chamadas, 0);
    await liveAnalysisService.selecionarSessao({ ...recente, status: 'encerrada' }, { cortesPorHora: 5 });
    assert.equal(chamadas, 1);
  } finally {
    desfazer();
  }
  // Com a live encerrada, o que sobrou pendente e descartado.
  const { rows } = await pool.query("SELECT count(*)::int AS n FROM live_candidates WHERE session_id = $1 AND status = 'pendente'", [sessao.id]);
  assert.equal(rows[0].n, 0);
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
