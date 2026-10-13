// Corte que volta pra fila vai pro FIM dela - no horário E na posição.
//
// Caso real de 13/10/2026 (conta 61): o cliente clicou em "Tentar de novo"
// num corte que tinha dado erro. Ele ganhou um horário no fim da fila (o dia
// seguinte), mas a posição continuou sendo a primeira, porque a fila segue
// COALESCE(queue_order, id) e o id dele era o mais baixo. Como a fila é
// estrita (só olha o primeiro), os dois cortes seguintes - com horário já
// vencido no mesmo dia - ficaram presos atrás dele até o dia seguinte.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const pool = require('../../src/db/pool');
const postingsRepository = require('../../src/repositories/postingsRepository');
const { startServer, stopServer, createLoginableClient, createAgent } = require('../helpers/http');

test.after(async () => {
  await stopServer();
  await pool.end();
});

let seq = 0;
const unico = () => `${Date.now()}${seq++}`;

// Três cortes: o primeiro em `statusDoPrimeiro`, os outros dois pendentes e
// já vencidos (dentro das 2h, antes de a remarcação de atrasados entrar).
async function contaComFila(clienteId, statusDoPrimeiro) {
  const { rows: [conta] } = await pool.query(
    `INSERT INTO tiktok_accounts (client_user_id, tiktok_open_id, display_name, is_active,
       access_token_encrypted, access_token_iv, refresh_token_encrypted, refresh_token_iv,
       scopes, token_expires_at, connected_at, auto_post_enabled)
     VALUES ($1, $2, 'conta', true, 'x','x','x','x', ARRAY['video.publish'],
       now() + interval '30 days', now(), true)
     RETURNING *`,
    [clienteId, `open-${unico()}`]
  );
  await pool.query(
    `INSERT INTO posting_schedule_settings (tiktok_account_id, mode, videos_per_day, manual_times, timezone)
     VALUES ($1, 'manual', 2, ARRAY['12:30','19:00'], 'America/Sao_Paulo')`,
    [conta.id]
  );
  const { rows: [video] } = await pool.query(
    `INSERT INTO source_videos (youtube_video_id, title, status, input_type, owner_client_user_id, client_user_id)
     VALUES ($1, 'video', 'ready', 'upload', $2, $2) RETURNING *`,
    [`v${unico()}`, clienteId]
  );

  const postagens = [];
  const estados = [
    [statusDoPrimeiro, '-1 day'],
    ['pending', '-40 minutes'],
    ['pending', '-10 minutes'],
  ];
  for (const [i, [status, quando]] of estados.entries()) {
    const { rows: [clip] } = await pool.query(
      `INSERT INTO clips (source_video_id, start_seconds, end_seconds, status, title)
       VALUES ($1, $2, $3, 'ready', $4) RETURNING *`,
      [video.id, i * 30, i * 30 + 30, `Corte ${i + 1}`]
    );
    const { rows: [v] } = await pool.query(
      `INSERT INTO videos (source_type, clip_id, filename, mime_type)
       VALUES ('youtube_clip', $1, 'c.mp4', 'video/mp4') RETURNING *`,
      [clip.id]
    );
    const { rows: [p] } = await pool.query(
      `INSERT INTO postings (video_id, tiktok_account_id, status, scheduled_for)
       VALUES ($1, $2, $3, now() + $4::interval) RETURNING *`,
      [v.id, conta.id, status, quando]
    );
    postagens.push(p);
  }
  return { conta, postagens };
}

test('"Tentar de novo" não trava os cortes que já estavam na hora', async () => {
  const url = await startServer();
  const user = await createLoginableClient();
  const agente = createAgent(url);
  await agente.login(user.email, user.password);
  const { conta, postagens } = await contaComFila(user.id, 'error');

  const r = await agente.post(`/api/client/postings/${postagens[0].id}/retry`, {});
  assert.equal(r.status, 204);

  const proximo = await postingsRepository.findOldestDuePendingForAccount(conta.id);
  assert.ok(proximo, 'a fila não pode parar: há cortes com horário vencido');
  assert.equal(String(proximo.id), String(postagens[1].id));

  const { rows } = await pool.query(
    `SELECT p.id FROM postings p WHERE p.tiktok_account_id = $1 AND p.status = 'pending'
      ORDER BY COALESCE(p.queue_order, p.id), p.id`,
    [conta.id]
  );
  assert.equal(String(rows[rows.length - 1].id), String(postagens[0].id), 'quem voltou fica no fim da fila');
});

test('corte cancelado que volta pra fila também vai pro fim da ordem', async () => {
  const user = await createLoginableClient();
  const { conta, postagens } = await contaComFila(user.id, 'skipped');

  await postingsRepository.requeueSkipped(postagens[0].id, conta.id);

  const proximo = await postingsRepository.findOldestDuePendingForAccount(conta.id);
  assert.ok(proximo);
  assert.equal(String(proximo.id), String(postagens[1].id));
});
