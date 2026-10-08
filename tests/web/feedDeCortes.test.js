// Feed de cortes (08/10/2026): listar os cortes prontos do cliente em páginas,
// filtrar por canal, marcar "gostei" e mandar um corte pra fila das contas que
// o cliente escolher.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const pool = require('../../src/db/pool');
const settingsRepository = require('../../src/repositories/settingsRepository');
const painelNovo = require('../../src/lib/painelNovo');
const { startServer, stopServer, createLoginableClient, createAgent } = require('../helpers/http');

let url;
const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'feed-'));
test.before(async () => {
  url = await startServer();
});
test.after(async () => {
  await stopServer();
  await pool.end();
  fs.rmSync(pasta, { recursive: true, force: true });
});

async function logado({ noPainelNovo = true } = {}) {
  const u = await createLoginableClient();
  if (noPainelNovo) {
    const atuais = await painelNovo.idsLiberados();
    await settingsRepository.setValue(painelNovo.CHAVE, [...atuais, Number(u.id)]);
  }
  const agent = createAgent(url);
  await agent.login(u.email, u.password);
  return { u, agent };
}

let n = 0;
const uid = () => `${process.pid}_${Date.now().toString(36)}_${n++}`;

async function canal(userId) {
  const { rows } = await pool.query(
    `INSERT INTO youtube_channels (client_user_id, youtube_channel_id, channel_url, channel_name)
     VALUES ($1, $2, 'https://www.youtube.com/@feed', 'Canal do feed') RETURNING id`,
    [userId, `UCfeed_${uid()}`]
  );
  return Number(rows[0].id);
}

async function video(userId, canalId = null) {
  const { rows } = canalId
    ? await pool.query(
        `INSERT INTO source_videos (youtube_channel_id, input_type, owner_client_user_id, youtube_video_id, title, status)
         VALUES ($1, 'channel', $2, $3, 'Vídeo de origem', 'ready') RETURNING id`,
        [canalId, userId, `yt_${uid()}`]
      )
    : await pool.query(
        `INSERT INTO source_videos (input_type, client_user_id, owner_client_user_id, youtube_video_id, title, status)
         VALUES ('manual', $1, $1, $2, 'Vídeo avulso', 'ready') RETURNING id`,
        [userId, `yt_${uid()}`]
      );
  return Number(rows[0].id);
}

async function corte(videoId, { comArquivo = true, status = 'ready' } = {}) {
  const arquivo = path.join(pasta, `${uid()}.mp4`);
  if (comArquivo) fs.writeFileSync(arquivo, 'conteudo de video falso');
  const { rows } = await pool.query(
    `INSERT INTO clips (source_video_id, title, description, start_seconds, end_seconds, status, local_clip_path)
     VALUES ($1, 'Corte', 'Legenda do corte', 10, 55, $2, $3) RETURNING id`,
    [videoId, status, arquivo]
  );
  return Number(rows[0].id);
}

async function contaTiktok(userId) {
  const { rows } = await pool.query(
    `INSERT INTO tiktok_accounts (client_user_id, tiktok_open_id, token_expires_at, display_name, access_token_encrypted, refresh_token_encrypted)
     VALUES ($1, $2, now() + interval '1 day', 'Conta feed', 'x', 'x') RETURNING id`,
    [userId, `open_${uid()}`]
  );
  return Number(rows[0].id);
}

test('quem nao esta no painel novo nao abre o feed', async () => {
  const { agent } = await logado({ noPainelNovo: false });
  assert.equal((await agent.get('/api/client/feed')).status, 403);
});

test('mostra so os cortes prontos do proprio cliente, do mais novo pro mais antigo, sem repetir entre paginas', async () => {
  const { u, agent } = await logado();
  const v = await video(u.id);
  const meus = [];
  for (let i = 0; i < 14; i++) meus.push(await corte(v));
  await corte(v, { status: 'rendering' });
  await corte(v, { comArquivo: false });

  const outro = await logado();
  await corte(await video(outro.u.id));

  const p1 = await agent.get('/api/client/feed');
  assert.equal(p1.status, 200);
  assert.equal(p1.body.cortes.length, 12);
  assert.ok(p1.body.proximo);
  const p2 = await agent.get(`/api/client/feed?antes=${p1.body.proximo}`);
  const ids = [...p1.body.cortes, ...p2.body.cortes].map((c) => c.id);
  assert.deepEqual(ids, [...meus].reverse(), 'todos os prontos, sem repetir nem pular, do mais novo pro mais antigo');
  assert.equal(p2.body.proximo, null);
  assert.equal(p1.body.cortes[0].duracaoSegundos, 45);
  assert.match(p1.body.cortes[0].videoUrl, /\/clips\/\d+\/download$/);
});

test('filtro por canal, avulsos, e canal de outro cliente', async () => {
  const { u, agent } = await logado();
  const c1 = await canal(u.id);
  const c2 = await canal(u.id);
  const doC1 = await corte(await video(u.id, c1));
  const doC2 = await corte(await video(u.id, c2));
  const avulso = await corte(await video(u.id));

  assert.deepEqual((await agent.get(`/api/client/feed?canal=${c1}`)).body.cortes.map((c) => c.id), [doC1]);
  assert.deepEqual((await agent.get(`/api/client/feed?canal=${c2}`)).body.cortes.map((c) => c.id), [doC2]);
  assert.deepEqual((await agent.get('/api/client/feed?canal=avulsos')).body.cortes.map((c) => c.id), [avulso]);
  assert.equal((await agent.get('/api/client/feed?canal=todos')).body.cortes.length, 3);

  const outro = await logado();
  const deOutro = await canal(outro.u.id);
  assert.equal((await agent.get(`/api/client/feed?canal=${deOutro}`)).status, 404);

  const ctx = (await agent.get('/api/client/feed/contexto')).body;
  assert.deepEqual(ctx.canais.map((c) => c.id).sort(), [c1, c2].sort());
});

test('gostei: marca, aparece na aba, desmarca, e nao vale pra corte de outro', async () => {
  const { u, agent } = await logado();
  const v = await video(u.id);
  const a = await corte(v);
  await corte(v);

  let r = await agent.put(`/api/client/feed/cortes/${a}/gostei`, { gostei: true });
  assert.equal(r.status, 200);
  assert.equal(r.body.totalGostei, 1);
  // Marcar de novo não duplica.
  r = await agent.put(`/api/client/feed/cortes/${a}/gostei`, { gostei: true });
  assert.equal(r.body.totalGostei, 1);
  const aba = (await agent.get('/api/client/feed?aba=gostei')).body.cortes;
  assert.deepEqual(aba.map((c) => c.id), [a]);
  assert.equal(aba[0].gostei, true);

  r = await agent.put(`/api/client/feed/cortes/${a}/gostei`, { gostei: false });
  assert.equal(r.body.totalGostei, 0);
  assert.equal((await agent.get('/api/client/feed?aba=gostei')).body.cortes.length, 0);
  assert.equal((await agent.put(`/api/client/feed/cortes/${a}/gostei`, {})).status, 400);

  const outro = await logado();
  assert.equal((await outro.agent.put(`/api/client/feed/cortes/${a}/gostei`, { gostei: true })).status, 404);
});

test('enviar pra fila: cria a postagem na conta escolhida, avisa repeticao e devolve cancelada', async () => {
  const { u, agent } = await logado();
  const conta = await contaTiktok(u.id);
  const c = await corte(await video(u.id));

  let r = await agent.post(`/api/client/feed/cortes/${c}/enviar`, { tiktokAccountIds: [conta] });
  assert.equal(r.status, 200);
  assert.equal(r.body.resultados[0].resultado, 'enfileirado');
  assert.ok(r.body.resultados[0].scheduledFor, 'a postagem nasce com horario da fila da conta');
  const { rows } = await pool.query(
    'SELECT p.* FROM postings p JOIN videos v ON v.id = p.video_id WHERE v.clip_id = $1',
    [c]
  );
  assert.equal(rows.length, 1);
  assert.equal(Number(rows[0].tiktok_account_id), conta);
  assert.equal(rows[0].status, 'pending');

  r = await agent.post(`/api/client/feed/cortes/${c}/enviar`, { tiktokAccountIds: [conta] });
  assert.equal(r.body.resultados[0].resultado, 'ja_na_fila');

  await pool.query("UPDATE postings SET status = 'skipped' WHERE id = $1", [rows[0].id]);
  r = await agent.post(`/api/client/feed/cortes/${c}/enviar`, { tiktokAccountIds: [conta] });
  assert.equal(r.body.resultados[0].resultado, 'enfileirado', 'cancelada volta pra fila quando o cliente pede de novo');

  const lista = (await agent.get('/api/client/feed')).body.cortes.find((x) => x.id === c);
  assert.equal(lista.postagens[0].accountId, conta);
  assert.equal(lista.postagens[0].status, 'pending');
});

test('enviar: conta de outro cliente recusa tudo, sem criar postagem nenhuma', async () => {
  const { u, agent } = await logado();
  const minha = await contaTiktok(u.id);
  const c = await corte(await video(u.id));
  const outro = await logado();
  const dele = await contaTiktok(outro.u.id);

  const r = await agent.post(`/api/client/feed/cortes/${c}/enviar`, { tiktokAccountIds: [minha, dele] });
  assert.equal(r.status, 404);
  const { rows } = await pool.query('SELECT 1 FROM postings p JOIN videos v ON v.id = p.video_id WHERE v.clip_id = $1', [c]);
  assert.equal(rows.length, 0);

  assert.equal((await agent.post(`/api/client/feed/cortes/${c}/enviar`, { tiktokAccountIds: [] })).status, 400);
  // Corte de outro cliente não pode ser enviado nem pra conta dele mesmo.
  const deOutro = await corte(await video(outro.u.id));
  assert.equal((await agent.post(`/api/client/feed/cortes/${deOutro}/enviar`, { tiktokAccountIds: [minha] })).status, 404);
});

test('enviar: corte cujo arquivo sumiu e recusado com 410', async () => {
  const { u, agent } = await logado();
  const conta = await contaTiktok(u.id);
  const c = await corte(await video(u.id));
  const { rows } = await pool.query('SELECT local_clip_path FROM clips WHERE id = $1', [c]);
  fs.rmSync(rows[0].local_clip_path);
  assert.equal((await agent.post(`/api/client/feed/cortes/${c}/enviar`, { tiktokAccountIds: [conta] })).status, 410);
});
