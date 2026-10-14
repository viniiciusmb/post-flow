// O corte marcado pras 12:00 sai às 12:00, não às 12:10.
//
// Caso real de 13/10/2026 (cliente #402): o job do TikTok rodava de 10 em 10
// minutos e o horário gravado guardava os segundos (12:00:49), então a rodada
// das 12:00:00 achava que ainda não era hora e o corte esperava a das 12:10.
// O cliente viu o horário passar, achou que a publicação automática tinha
// quebrado e publicou na mão. Medido em 3 dias: 57 de 121 publicações saíram
// de 5 a 11 minutos atrasadas.
//
// Rodar de minuto em minuto não pode virar rajada: 10 minutos entre duas
// publicações da mesma conta continuam garantidos pelo próprio job.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const pool = require('../../src/db/pool');
const postingsRepository = require('../../src/repositories/postingsRepository');
const tiktokPostingJob = require('../../src/worker/jobs/tiktokPostingJob');
const { createClient } = require('../helpers/db');

test.after(async () => {
  await pool.end();
});

let n = 0;
const uid = () => `${process.pid}_${Date.now()}_${n++}`;

async function contaTiktok(userId, porDia = 6) {
  const { rows } = await pool.query(
    `INSERT INTO tiktok_accounts (client_user_id, tiktok_open_id, token_expires_at, display_name, access_token_encrypted, refresh_token_encrypted, auto_post_enabled)
     VALUES ($1, $2, now() + interval '1 day', 'Conta', 'x', 'x', true) RETURNING *`,
    [userId, `open_${uid()}`]
  );
  await pool.query(
    `INSERT INTO posting_schedule_settings (tiktok_account_id, mode, videos_per_day, manual_times, timezone) VALUES ($1, 'auto', $2, '{}', 'America/Sao_Paulo')`,
    [rows[0].id, porDia]
  );
  return rows[0];
}

async function postagem(userId, contaId, { status = 'pending', scheduledFor = null, queuedAt = null } = {}) {
  const { rows: sv } = await pool.query(
    `INSERT INTO source_videos (input_type, client_user_id, owner_client_user_id, youtube_video_id, title, status)
     VALUES ('manual', $1, $1, $2, 'V', 'ready') RETURNING id`,
    [userId, `yt_${uid()}`]
  );
  const { rows: c } = await pool.query(
    `INSERT INTO clips (source_video_id, title, start_seconds, end_seconds, status, local_clip_path) VALUES ($1, 'C', 0, 30, 'ready', '/tmp/x.mp4') RETURNING id`,
    [sv[0].id]
  );
  const { rows: v } = await pool.query(
    `INSERT INTO videos (source_type, clip_id, filename, mime_type) VALUES ('youtube_clip', $1, 'c', 'video/mp4') RETURNING id`,
    [c[0].id]
  );
  const { rows } = await pool.query(
    `INSERT INTO postings (video_id, tiktok_account_id, status, scheduled_for, queued_at, posted_at)
     VALUES ($1, $2, $3, $4, $5::timestamptz, CASE WHEN $3 = 'posted' THEN $5::timestamptz ELSE NULL END) RETURNING *`,
    [v[0].id, contaId, status, scheduledFor, queuedAt]
  );
  return rows[0];
}

const inicioDoMinuto = () => new Date(Math.floor(Date.now() / 60000) * 60000);

test('o corte marcado pro minuto atual já está na hora, mesmo com segundos à frente do relógio', async () => {
  const u = await createClient();
  const conta = await contaTiktok(u.id);
  // "12:00:59" quando são 12:00:xx: é o horário das 12:00.
  const p = await postagem(u.id, conta.id, { scheduledFor: new Date(inicioDoMinuto().getTime() + 59e3) });
  const daVez = await postingsRepository.findOldestDuePendingForAccount(conta.id);
  assert.equal(String(daVez && daVez.id), String(p.id));
});

test('o corte do minuto seguinte ainda não está na hora', async () => {
  const u = await createClient();
  const conta = await contaTiktok(u.id);
  await postagem(u.id, conta.id, { scheduledFor: new Date(inicioDoMinuto().getTime() + 60e3) });
  assert.equal(await postingsRepository.findOldestDuePendingForAccount(conta.id), null);
});

test('rodar de minuto em minuto não solta dois cortes da mesma conta em menos de 10 minutos', async () => {
  const u = await createClient();
  const conta = await contaTiktok(u.id);
  await postagem(u.id, conta.id, { status: 'posted', queuedAt: new Date(Date.now() - 4 * 60e3) });
  await postagem(u.id, conta.id, { scheduledFor: new Date(Date.now() - 2 * 60e3) });
  const publicados = [];
  await tiktokPostingJob.maybePublishNext(conta, { publicar: async (_a, p) => publicados.push(p.id) });
  assert.equal(publicados.length, 0, 'a conta publicou há 4 minutos');

  const conta2 = await contaTiktok(u.id);
  await postagem(u.id, conta2.id, { status: 'posted', queuedAt: new Date(Date.now() - 11 * 60e3) });
  await postagem(u.id, conta2.id, { scheduledFor: new Date(Date.now() - 60e3) });
  await tiktokPostingJob.maybePublishNext(conta2, { publicar: async (_a, p) => publicados.push(p.id) });
  assert.equal(publicados.length, 1, 'passados 10 minutos, o próximo sai');
});

test('o job de publicação do TikTok está agendado de minuto em minuto', () => {
  const fonte = require('node:fs').readFileSync(require.resolve('../../src/worker/videoScheduler.js'), 'utf8');
  assert.match(fonte, /schedule\(QUEUE_TIKTOK_POSTING, '\* \* \* \* \*'\)/);
});
