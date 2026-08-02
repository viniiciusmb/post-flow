// Recuperacao de video travado. A verificacao mais importante deste arquivo
// NAO e "recupera o travado" - e "NAO mexe no que ainda esta vivo".
//
// Os deploys usam start-first: por alguns minutos o container antigo continua
// processando enquanto o novo ja subiu. Uma deteccao ingenua por tempo
// ("esta ha 40min em cutting = travado") resetaria um video que esta sendo
// renderizado agora, corrompendo o corte. Por isso a deteccao e por sinal de
// vida (processing_heartbeat_at, tocado a cada 60s pelo processVideoJob).
'use strict';

const test = require('node:test');
const assert = require('node:assert');

const job = require('../../src/worker/jobs/videoStuckRecoveryJob');
const sourceVideosRepository = require('../../src/repositories/sourceVideosRepository');
const { pool, createClient, closePool } = require('../helpers/db');

test.after(() => closePool());

// pg-boss de mentira: so anota o que teria sido reenfileirado.
function fakeBoss() {
  const enfileirados = [];
  return {
    enfileirados,
    send: async (queue, data, opts) => enfileirados.push({ queue, ...data, ...opts }),
  };
}

async function criarVideo(clientUserId, { status, minutosSemSinal, recuperacoes = 0, titulo = 'v' }) {
  const { rows } = await pool.query(
    `INSERT INTO source_videos (title, status, input_type, client_user_id, owner_client_user_id,
                                processing_started_at, processing_heartbeat_at, stuck_recovery_count)
     VALUES ($1, $2, 'manual', $3, $3, now() - interval '90 minutes',
             now() - ($4 || ' minutes')::interval, $5)
     RETURNING *`,
    [titulo, status, clientUserId, String(minutosSemSinal), recuperacoes]
  );
  return rows[0];
}

async function statusDe(id) {
  const { rows } = await pool.query('SELECT * FROM source_videos WHERE id = $1', [id]);
  return rows[0];
}

test('video em andamento que ainda da sinal de vida NAO e tocado', async () => {
  const cliente = await createClient();
  const vivo = await criarVideo(cliente.id, { status: 'cutting', minutosSemSinal: 1, titulo: 'renderizando agora' });
  const boss = fakeBoss();

  await job.run({ boss });

  const depois = await statusDe(vivo.id);
  assert.strictEqual(depois.status, 'cutting', 'nao pode resetar quem esta trabalhando');
  assert.strictEqual(Number(depois.stuck_recovery_count), 0);
  assert.ok(
    !boss.enfileirados.some((e) => String(e.sourceVideoId) === String(vivo.id)),
    'nao pode reenfileirar quem esta trabalhando (duplicaria o processamento)'
  );
});

test('video logo abaixo do limite de silencio ainda e considerado vivo', async () => {
  const cliente = await createClient();
  const naBeira = await criarVideo(cliente.id, {
    status: 'downloading',
    minutosSemSinal: job.STALE_MINUTES - 1,
    titulo: 'na beira',
  });

  await job.run({ boss: fakeBoss() });

  const depois = await statusDe(naBeira.id);
  assert.strictEqual(depois.status, 'downloading', 'a margem de seguranca tem que ser respeitada');
});

test('video sem sinal de vida ha muito tempo volta pra fila mantendo o progresso', async () => {
  const cliente = await createClient();
  const morto = await criarVideo(cliente.id, { status: 'cutting', minutosSemSinal: 30, titulo: 'worker morreu' });
  const boss = fakeBoss();

  const resultado = await job.run({ boss });

  const depois = await statusDe(morto.id);
  assert.strictEqual(resultado.recovered, 1);
  assert.strictEqual(depois.status, 'detected', 'volta pro inicio do pipeline, que sabe pular o que ja foi feito');
  assert.strictEqual(Number(depois.stuck_recovery_count), 1, 'conta a ressurreicao pra poder desistir depois');
  assert.strictEqual(depois.processing_heartbeat_at, null, 'zera o sinal de vida antigo');
  assert.ok(
    boss.enfileirados.some((e) => String(e.sourceVideoId) === String(morto.id)),
    'precisa ser reenfileirado, senao fica parado em detected pra sempre'
  );
});

test('depois de travar vezes demais, vira erro de verdade em vez de ficar em loop', async () => {
  const cliente = await createClient();
  const teimoso = await criarVideo(cliente.id, {
    status: 'transcribing',
    minutosSemSinal: 30,
    recuperacoes: job.MAX_RECOVERIES,
    titulo: 'trava sempre',
  });
  const boss = fakeBoss();

  const resultado = await job.run({ boss });

  const depois = await statusDe(teimoso.id);
  assert.strictEqual(resultado.gaveUp, 1);
  assert.strictEqual(depois.status, 'error', 'o cliente precisa VER que deu errado, nao ficar em loop invisivel');
  assert.match(depois.error_message, /travou/i);
  assert.ok(
    !boss.enfileirados.some((e) => String(e.sourceVideoId) === String(teimoso.id)),
    'nao pode continuar reenfileirando um video que ja desistimos'
  );
});

test('video que nao esta em andamento nunca e considerado travado', async () => {
  const cliente = await createClient();
  const pronto = await criarVideo(cliente.id, { status: 'ready', minutosSemSinal: 9999, titulo: 'ja terminou' });
  const pausado = await criarVideo(cliente.id, { status: 'paused', minutosSemSinal: 9999, titulo: 'cliente pausou' });

  await job.run({ boss: fakeBoss() });

  assert.strictEqual((await statusDe(pronto.id)).status, 'ready');
  assert.strictEqual((await statusDe(pausado.id)).status, 'paused', 'pausa do cliente nao e travamento');
});

test('o sinal de vida avanca sem sujar updated_at', async () => {
  // updated_at e usado por outras consultas (retry automatico de erro
  // transitorio filtra por "parado ha 10min"). Se o heartbeat de minuto em
  // minuto mexesse nele, aquela regra nunca mais dispararia.
  const cliente = await createClient();
  const video = await criarVideo(cliente.id, { status: 'cutting', minutosSemSinal: 5, titulo: 'batendo' });

  await sourceVideosRepository.touchProcessingHeartbeat(video.id);

  const depois = await statusDe(video.id);
  assert.ok(
    new Date(depois.processing_heartbeat_at) > new Date(video.processing_heartbeat_at),
    'o sinal de vida tem que avancar'
  );
  assert.strictEqual(
    String(depois.updated_at),
    String(video.updated_at),
    'o heartbeat nao pode mexer em updated_at'
  );
});
