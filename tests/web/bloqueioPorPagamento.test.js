// Cliente que não pagou fica sem nenhuma funcionalidade (14/10/2026).
//
// O Eduardo (#203) teve a renovação recusada no cartão e virou inadimplente,
// mas os 14 cortes dele continuavam saindo no TikTok e os canais continuavam
// sendo vigiados. Decisão do fundador: sem pagamento, nada roda - painel,
// publicação, processamento e lives - até regularizar. Quando o pagamento cai,
// tudo volta sozinho.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const pool = require('../../src/db/pool');
const clientSubscriptionsRepository = require('../../src/repositories/clientSubscriptionsRepository');
const subscriptionPlansRepository = require('../../src/repositories/subscriptionPlansRepository');
const socialPostingsRepository = require('../../src/repositories/socialPostingsRepository');
const livesRepository = require('../../src/repositories/livesRepository');
const assinaturaEmDiaService = require('../../src/services/assinaturaEmDiaService');
const tiktokPostingJob = require('../../src/worker/jobs/tiktokPostingJob');
const { startServer, stopServer, createLoginableClient, createAgent } = require('../helpers/http');

let url;
test.before(async () => {
  url = await startServer();
});
test.after(async () => {
  await stopServer();
  await pool.end();
});

let n = 0;
const uid = () => `${process.pid}_${Date.now()}_${n++}`;

async function cliente(status) {
  const u = await createLoginableClient();
  const [plano] = await subscriptionPlansRepository.listActive();
  await clientSubscriptionsRepository.setPlan(u.id, plano.id);
  if (status !== 'ativo') await clientSubscriptionsRepository.setStatus(u.id, status);
  return u;
}

async function logado(u) {
  const agent = createAgent(url);
  await agent.login(u.email, u.password);
  return agent;
}

async function contaComCorteNaHora(userId) {
  const { rows: [conta] } = await pool.query(
    `INSERT INTO tiktok_accounts (client_user_id, tiktok_open_id, token_expires_at, display_name, access_token_encrypted, refresh_token_encrypted, auto_post_enabled)
     VALUES ($1, $2, now() + interval '1 day', 'Conta', 'x', 'x', true) RETURNING *`,
    [userId, `open_${uid()}`]
  );
  await pool.query(
    `INSERT INTO posting_schedule_settings (tiktok_account_id, mode, videos_per_day, manual_times, timezone) VALUES ($1, 'auto', 6, '{}', 'America/Sao_Paulo')`,
    [conta.id]
  );
  const { rows: [sv] } = await pool.query(
    `INSERT INTO source_videos (input_type, client_user_id, owner_client_user_id, youtube_video_id, title, status)
     VALUES ('manual', $1, $1, $2, 'V', 'ready') RETURNING id`,
    [userId, `yt_${uid()}`]
  );
  const { rows: [c] } = await pool.query(
    `INSERT INTO clips (source_video_id, title, start_seconds, end_seconds, status, local_clip_path) VALUES ($1, 'C', 0, 30, 'ready', '/tmp/nao-existe-${uid()}.mp4') RETURNING id`,
    [sv.id]
  );
  const { rows: [v] } = await pool.query(
    `INSERT INTO videos (source_type, clip_id, filename, mime_type) VALUES ('youtube_clip', $1, 'c', 'video/mp4') RETURNING id`,
    [c.id]
  );
  const { rows: [p] } = await pool.query(
    `INSERT INTO postings (video_id, tiktok_account_id, status, scheduled_for) VALUES ($1, $2, 'pending', now() - interval '1 minute') RETURNING *`,
    [v.id, conta.id]
  );
  return p;
}

test('painel: inadimplente recebe 402 em tudo, menos no que serve pra pagar', async () => {
  const agent = await logado(await cliente('inadimplente'));
  for (const rota of ['/api/client/youtube-channels', '/api/client/lives', '/api/client/feed', '/api/client/social-accounts']) {
    const r = await agent.get(rota);
    assert.equal(r.status, 402, `${rota} devia estar travada`);
    assert.equal(r.body.pagamentoPendente, true);
  }
  assert.equal((await agent.post('/api/client/youtube-channels', { url: '@qualquer' })).status, 402);
  assert.equal((await agent.get('/api/client/billing/overview')).status, 200, 'Plano e uso continua aberto');

  const emDia = await logado(await cliente('ativo'));
  assert.equal((await emDia.get('/api/client/youtube-channels')).status, 200);
});

test('TikTok: a fila de quem não pagou não publica; a de quem pagou segue', async () => {
  const devendo = await contaComCorteNaHora((await cliente('inadimplente')).id);
  const emDia = await contaComCorteNaHora((await cliente('ativo')).id);
  await tiktokPostingJob.run();
  const status = async (id) => (await pool.query('SELECT status FROM postings WHERE id = $1', [id])).rows[0].status;
  assert.equal(await status(devendo.id), 'pending', 'nada saiu do perfil de quem não pagou');
  assert.notEqual(await status(emDia.id), 'pending', 'a conta em dia foi trabalhada (aqui falha por falta do arquivo, de propósito)');
});

test('outras redes e lives ignoram quem não pagou; quem cancelou e já passou do período também', async () => {
  for (const status of ['inadimplente', 'cancelado']) {
    const u = await cliente(status);
    assert.equal(await assinaturaEmDiaService.emDia(u.id), false, status);
    const { rows: [conta] } = await pool.query(
      `INSERT INTO social_accounts (client_user_id, network, outstand_account_id, username) VALUES ($1, 'instagram', $2, 'x') RETURNING id`,
      [u.id, `out_${uid()}`]
    );
    const { rows: [sv] } = await pool.query(
      `INSERT INTO source_videos (input_type, client_user_id, owner_client_user_id, youtube_video_id, title, status)
       VALUES ('manual', $1, $1, $2, 'V', 'ready') RETURNING id`,
      [u.id, `yt_${uid()}`]
    );
    const { rows: [clip] } = await pool.query(
      `INSERT INTO clips (source_video_id, title, start_seconds, end_seconds, status) VALUES ($1, 'C', 0, 30, 'ready') RETURNING id`,
      [sv.id]
    );
    await pool.query(
      `INSERT INTO social_postings (client_user_id, social_account_id, clip_id, status, scheduled_for) VALUES ($1, $2, $3, 'pending', now())`,
      [u.id, conta.id, clip.id]
    );
    const contas = await socialPostingsRepository.contasQuePublicamSozinhas();
    assert.ok(!contas.some((c) => Number(c.id) === Number(conta.id)), `${status}: a conta não pode publicar`);

    const canal = await livesRepository.upsertChannel({ login: `bloq_${uid()}`, displayName: 'C', platformUserId: '1', profileImageUrl: null });
    await livesRepository.follow(u.id, canal.id);
    assert.ok(!(await livesRepository.activeFollowerIds(canal.id)).includes(Number(u.id)), `${status}: não recebe cortes de live`);
  }
  const ok = await cliente('ativo');
  assert.equal(await assinaturaEmDiaService.emDia(ok.id), true);
});

test('pagou: tudo volta sozinho', async () => {
  const u = await cliente('inadimplente');
  const p = await contaComCorteNaHora(u.id);
  await clientSubscriptionsRepository.setStatus(u.id, 'ativo');
  await tiktokPostingJob.run();
  assert.notEqual((await pool.query('SELECT status FROM postings WHERE id = $1', [p.id])).rows[0].status, 'pending');
  const agent = await logado(u);
  assert.equal((await agent.get('/api/client/youtube-channels')).status, 200);
});

test('processamento: vídeo de quem não pagou espera em "aguardando crédito" sem baixar nada', async () => {
  const processVideoJob = require('../../src/worker/videoJobs/processVideoJob');
  const u = await cliente('inadimplente');
  // Com crédito sobrando: o que segura o vídeo tem que ser o pagamento, não a falta de crédito.
  await require('../../src/repositories/clientCreditsRepository').getOrCreate(u.id);
  await pool.query('UPDATE client_credits SET quota_normal = 1000, used_normal = 0 WHERE client_user_id = $1', [u.id]);
  const { rows: [sv] } = await pool.query(
    `INSERT INTO source_videos (input_type, client_user_id, owner_client_user_id, youtube_video_id, title, status, duration_seconds)
     VALUES ('manual', $1, $1, $2, 'V', 'detected', 60) RETURNING id`,
    [u.id, `yt_${uid()}`]
  );
  await processVideoJob.run(sv.id);
  const { rows: [depois] } = await pool.query('SELECT status, local_video_path FROM source_videos WHERE id = $1', [sv.id]);
  assert.equal(depois.status, 'aguardando_creditos');
  assert.equal(depois.local_video_path, null, 'nada foi baixado');
});
