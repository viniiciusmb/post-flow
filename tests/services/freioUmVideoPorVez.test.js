// A fila de uma conta do TikTok da risestyle43 amanheceu em 13/09/2026 com 40
// cortes de TRÊS vídeos diferentes, intercalados, num canal com o freio de
// engarrafamento ligado. Eram três defeitos que só apareceram juntos:
//
//   1. O freio olhava a fila uma vez e deixava entrar até 3 vídeos (o teto de
//      rajada). O canal ficou 2 dias segurado, publicou 3 vídeos, e quando a
//      fila liberou os 3 entraram na mesma checagem.
//   2. O freio só contava postagem pendente. Vídeo baixando ainda não tem
//      postagem, então 20 min depois a fila "parecia vazia" e entrava outro.
//   3. O resgate de "vídeo preso em detected" enfileirava inclusive vídeo
//      barrado de propósito (limite de duração) - 19 cortes de um vídeo de 37
//      min num canal com limite de 30, e uma cobrança de excedente.
//
// E, por cima, a fila seguia a ordem de criação: dois vídeos renderizando em
// paralelo publicavam uma série picotada no meio da outra.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const pool = require('../../src/db/pool');
const db = require('../helpers/db');
const channelCheckJob = require('../../src/worker/videoJobs/channelCheckJob');
const ytDlpService = require('../../src/services/ytDlpService');
const sourceVideosRepository = require('../../src/repositories/sourceVideosRepository');
const postingsRepository = require('../../src/repositories/postingsRepository');

test.after(async () => {
  await pool.end();
});

let seq = 0;
const unico = () => `${Date.now()}${seq++}`;

function bossFalso() {
  const enviados = [];
  return { enviados, send: async (_fila, dados) => enviados.push(dados) };
}

async function comListagem(listagem, fn) {
  const original = ytDlpService.listChannelVideos;
  const originalMeta = ytDlpService.getVideoMetadata;
  ytDlpService.listChannelVideos = async () => listagem;
  ytDlpService.getVideoMetadata = async (url) => {
    const id = url.split('v=')[1];
    const v = listagem.find((x) => x.videoId === id);
    return { title: v ? v.title : 'titulo', publishedAt: new Date(), durationSeconds: 600 };
  };
  try {
    await fn();
  } finally {
    ytDlpService.listChannelVideos = original;
    ytDlpService.getVideoMetadata = originalMeta;
  }
}

async function criarConta(clienteId) {
  const { rows: [conta] } = await pool.query(
    `INSERT INTO tiktok_accounts (client_user_id, tiktok_open_id, display_name, is_active, auto_post_enabled,
       access_token_encrypted, access_token_iv, refresh_token_encrypted, refresh_token_iv,
       scopes, token_expires_at, connected_at)
     VALUES ($1,$2,'conta',true,true,'x','x','x','x',ARRAY['video.publish'], now()+interval '30 days', now())
     RETURNING *`,
    [clienteId, `open-${unico()}`]
  );
  return conta;
}

// Canal ativo, com conta do TikTok e marco d'água já estabelecido. Os outros
// canais do banco são desligados: a checagem roda sobre TODOS os ativos.
async function canalMonitorando({ freio = true } = {}) {
  await pool.query('UPDATE youtube_channels SET is_active = false');
  const cliente = await db.createClient();
  const conta = await criarConta(cliente.id);
  const canal = await db.createYoutubeChannel(cliente.id);
  const marco = `MARCO_${unico()}`;
  await pool.query(
    `UPDATE youtube_channels
        SET is_active = true, tiktok_account_id = $2, last_video_id = $3, process_only_when_queue_clear = $4
      WHERE id = $1`,
    [canal.id, conta.id, marco, freio]
  );
  return { cliente, conta, canal, marco };
}

function listagemCom(marco, n) {
  // Do mais novo pro mais velho, como a aba /videos do YouTube devolve.
  const novos = Array.from({ length: n }, (_, i) => ({
    videoId: `NOVO${n - i}_${unico()}`,
    title: `video novo ${n - i}`,
    thumbnailUrl: null,
    durationSeconds: 600,
    publishedAt: null,
  }));
  return [...novos, { videoId: marco, title: 'antigo', thumbnailUrl: null, durationSeconds: 600, publishedAt: null }];
}

async function videoDoCanal(canal, cliente, { status, reason = null }) {
  const { rows: [sv] } = await pool.query(
    `INSERT INTO source_videos (youtube_channel_id, owner_client_user_id, youtube_video_id, title, status, input_type, auto_skipped_reason)
     VALUES ($1,$2,$3,'ja existente',$4,'channel',$5) RETURNING *`,
    [canal.id, cliente.id, `EXISTENTE_${unico()}`, status, reason]
  );
  return sv;
}

async function marcoDe(canalId) {
  const { rows } = await pool.query('SELECT last_video_id FROM youtube_channels WHERE id = $1', [canalId]);
  return rows[0].last_video_id;
}

// --- 1. Um vídeo por vez ---

test('fila liberada com 3 vídeos novos: só o MAIS RECENTE entra, os outros ficam visíveis com motivo', async () => {
  const { canal, marco } = await canalMonitorando();
  const listagem = listagemCom(marco, 3);
  const boss = bossFalso();

  await comListagem(listagem, () => channelCheckJob.run(boss));

  assert.equal(boss.enviados.length, 1, `entraram ${boss.enviados.length} vídeos com o freio ligado`);
  const { rows: [enfileirado] } = await pool.query('SELECT * FROM source_videos WHERE id = $1', [
    boss.enviados[0].sourceVideoId,
  ]);
  assert.equal(enfileirado.youtube_video_id, listagem[0].videoId, 'o freio tem que pegar o vídeo mais novo');

  const { rows: deFora } = await pool.query(
    'SELECT youtube_video_id, status, auto_skipped_reason FROM source_videos WHERE youtube_video_id = ANY($1)',
    [[listagem[1].videoId, listagem[2].videoId]]
  );
  assert.equal(deFora.length, 2, 'os mais antigos não podem sumir sem rastro');
  for (const v of deFora) {
    assert.equal(v.status, 'detected');
    assert.equal(v.auto_skipped_reason, 'mais_recente');
  }
  assert.equal(await marcoDe(canal.id), listagem[0].videoId, 'o marco anda até o vídeo que entrou');
});

test('os vídeos deixados de fora NÃO voltam pela porta dos fundos do resgate de vídeo preso', async () => {
  const { marco } = await canalMonitorando();
  const listagem = listagemCom(marco, 2);
  await comListagem(listagem, () => channelCheckJob.run(bossFalso()));

  await pool.query(`UPDATE source_videos SET updated_at = now() - interval '2 hours' WHERE youtube_video_id = $1`, [
    listagem[1].videoId,
  ]);
  const presos = await sourceVideosRepository.findStuckDetected();
  assert.ok(
    !presos.some((v) => v.youtube_video_id === listagem[1].videoId),
    'o resgate enfileiraria o vídeo que o freio deixou de fora'
  );
});

// --- 2. O freio enxerga o que está a caminho ---

test('vídeo ainda processando pra mesma conta segura o freio, mesmo com a fila de postagens vazia', async () => {
  const { canal, cliente, marco } = await canalMonitorando();
  await videoDoCanal(canal, cliente, { status: 'downloading' });
  const boss = bossFalso();

  await comListagem(listagemCom(marco, 1), () => channelCheckJob.run(boss));

  assert.equal(boss.enviados.length, 0, 'o canal pegou outro vídeo com um ainda processando');
  assert.equal(await marcoDe(canal.id), marco, 'segurar é adiar: o marco não pode andar');
});

test('vídeo enfileirado esperando a vez do worker também segura', async () => {
  const { canal, cliente, marco } = await canalMonitorando();
  await videoDoCanal(canal, cliente, { status: 'detected' });
  const boss = bossFalso();

  await comListagem(listagemCom(marco, 1), () => channelCheckJob.run(boss));

  assert.equal(boss.enviados.length, 0);
});

test('vídeo avulso a caminho da MESMA conta também segura o canal', async () => {
  const { canal, cliente, conta, marco } = await canalMonitorando();
  const avulso = await db.createSourceVideo(cliente.id, { status: 'transcribing' });
  await pool.query('INSERT INTO source_video_tiktok_targets (source_video_id, tiktok_account_id) VALUES ($1,$2)', [
    avulso.id,
    conta.id,
  ]);
  const boss = bossFalso();

  await comListagem(listagemCom(marco, 1), () => channelCheckJob.run(boss));

  assert.equal(boss.enviados.length, 0);
  assert.equal(await marcoDe(canal.id), marco);
});

test('vídeo a caminho de OUTRA conta não segura este canal', async () => {
  const { cliente, marco } = await canalMonitorando();
  const outraConta = await criarConta(cliente.id);
  const avulso = await db.createSourceVideo(cliente.id, { status: 'cutting' });
  await pool.query('INSERT INTO source_video_tiktok_targets (source_video_id, tiktok_account_id) VALUES ($1,$2)', [
    avulso.id,
    outraConta.id,
  ]);
  const boss = bossFalso();

  await comListagem(listagemCom(marco, 1), () => channelCheckJob.run(boss));

  assert.equal(boss.enviados.length, 1, 'uma fila de outra conta não tem nada a ver com esta');
});

test('vídeo barrado de propósito ou pausado NÃO trava o canal', async () => {
  // Nenhum dos dois vai virar corte sem o cliente mandar - contar travaria o
  // canal pra sempre.
  const { canal, cliente, marco } = await canalMonitorando();
  await videoDoCanal(canal, cliente, { status: 'detected', reason: 'duracao' });
  await videoDoCanal(canal, cliente, { status: 'paused' });
  const boss = bossFalso();

  await comListagem(listagemCom(marco, 1), () => channelCheckJob.run(boss));

  assert.equal(boss.enviados.length, 1);
});

test('com o freio desligado, o canal continua pegando vários (até o teto de rajada)', async () => {
  const { marco } = await canalMonitorando({ freio: false });
  const boss = bossFalso();

  await comListagem(listagemCom(marco, 3), () => channelCheckJob.run(boss));

  assert.equal(boss.enviados.length, 3, 'quem desligou o freio quer processar tudo');
});

// --- 3. O resgate respeita quem foi deixado de fora ---

test('resgate de vídeo preso ignora TODO vídeo com motivo de exclusão', async () => {
  const cliente = await db.createClient();
  const ids = {};
  for (const reason of [null, 'duracao', 'mais_recente', 'aguardando_estilo']) {
    const sv = await db.createSourceVideo(cliente.id, { status: 'detected' });
    await pool.query(
      `UPDATE source_videos SET auto_skipped_reason = $2, updated_at = now() - interval '2 hours' WHERE id = $1`,
      [sv.id, reason]
    );
    ids[reason || 'sem_motivo'] = Number(sv.id);
  }

  const presos = (await sourceVideosRepository.findStuckDetected()).map((v) => Number(v.id));

  assert.ok(presos.includes(ids.sem_motivo), 'vídeo preso de verdade tem que continuar sendo resgatado');
  for (const reason of ['duracao', 'mais_recente', 'aguardando_estilo']) {
    assert.ok(!presos.includes(ids[reason]), `vídeo com motivo "${reason}" foi enfileirado sozinho`);
  }
});

// --- 4. A fila agrupada por vídeo ---

async function corteProntoDe(sourceVideoId) {
  const { rows: [clip] } = await pool.query(
    `INSERT INTO clips (source_video_id, start_seconds, end_seconds, status, title)
     VALUES ($1,0,30,'ready','c') RETURNING *`,
    [sourceVideoId]
  );
  const { rows: [v] } = await pool.query(
    `INSERT INTO videos (source_type, clip_id, filename, mime_type, file_size_bytes)
     VALUES ('youtube_clip',$1,'c.mp4','video/mp4',1000) RETURNING *`,
    [clip.id]
  );
  return v;
}

async function filaDaConta(contaId) {
  const { rows } = await pool.query(
    `SELECT p.id, p.scheduled_for, c.source_video_id
       FROM postings p JOIN videos v ON v.id = p.video_id JOIN clips c ON c.id = v.clip_id
      WHERE p.tiktok_account_id = $1 AND p.status = 'pending'
      ORDER BY COALESCE(p.queue_order, p.id)`,
    [contaId]
  );
  return rows;
}

test('fila intercalada vira fila agrupada por vídeo, sem adiar nenhum horário', async () => {
  const cliente = await db.createClient();
  const conta = await criarConta(cliente.id);
  const a = await db.createSourceVideo(cliente.id);
  const b = await db.createSourceVideo(cliente.id);

  // A1, B1, A2, B2, com horários de hora em hora - como dois vídeos
  // renderizando em paralelo deixavam a fila.
  const ordemDeCriacao = [a, b, a, b];
  const horarios = [];
  for (let i = 0; i < ordemDeCriacao.length; i++) {
    const v = await corteProntoDe(ordemDeCriacao[i].id);
    const quando = new Date(Date.now() + (i + 1) * 3600 * 1000);
    horarios.push(quando.getTime());
    await pool.query(
      `INSERT INTO postings (video_id, tiktok_account_id, status, scheduled_for) VALUES ($1,$2,'pending',$3)`,
      [v.id, conta.id, quando]
    );
  }

  assert.equal(await postingsRepository.agruparFilaPorVideo(conta.id), true);

  const fila = await filaDaConta(conta.id);
  assert.deepEqual(
    fila.map((p) => Number(p.source_video_id)),
    [Number(a.id), Number(a.id), Number(b.id), Number(b.id)],
    'os cortes de um vídeo têm que sair juntos'
  );
  assert.deepEqual(
    fila.map((p) => new Date(p.scheduled_for).getTime()),
    horarios,
    'os horários são os mesmos de antes, só redistribuídos na ordem nova - nenhum corte pode ser adiado'
  );

  assert.equal(await postingsRepository.agruparFilaPorVideo(conta.id), false, 'fila já agrupada não muda nada');
});

test('toda postagem nova já nasce agrupada com os irmãos dela', async () => {
  const cliente = await db.createClient();
  const conta = await criarConta(cliente.id);
  const a = await db.createSourceVideo(cliente.id);
  const b = await db.createSourceVideo(cliente.id);

  for (const sv of [a, b, a, b, a]) {
    const v = await corteProntoDe(sv.id);
    await postingsRepository.createIfNotExists({ videoId: v.id, tiktokAccountId: conta.id });
  }

  const fila = await filaDaConta(conta.id);
  assert.deepEqual(fila.map((p) => Number(p.source_video_id)), [a, a, a, b, b].map((x) => Number(x.id)));
  const tempos = fila.map((p) => new Date(p.scheduled_for).getTime());
  assert.deepEqual(tempos, [...tempos].sort((x, y) => x - y), 'o horário acompanha a ordem da fila');
});
