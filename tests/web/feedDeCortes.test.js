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
  // O marcador "N / total" conta os prontos com arquivo registrado: os 14 +
  // o que perdeu o arquivo no disco = 15 (o de render em andamento fica de
  // fora). A tela acerta o total quando chega ao fim da lista.
  assert.equal(p1.body.total, 15);
  assert.ok(p1.body.proximo);
  const p2 = await agent.get(`/api/client/feed?depois=${p1.body.proximo}`);
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

  assert.deepEqual((await agent.get(`/api/client/feed?canal=yt-${c1}`)).body.cortes.map((c) => c.id), [doC1]);
  assert.deepEqual((await agent.get(`/api/client/feed?canal=yt-${c2}`)).body.cortes.map((c) => c.id), [doC2]);
  assert.deepEqual((await agent.get('/api/client/feed?canal=avulsos')).body.cortes.map((c) => c.id), [avulso]);
  assert.equal((await agent.get('/api/client/feed?canal=todos')).body.cortes.length, 3);

  const outro = await logado();
  const deOutro = await canal(outro.u.id);
  assert.equal((await agent.get(`/api/client/feed?canal=yt-${deOutro}`)).status, 404);

  const ctx = (await agent.get('/api/client/feed/contexto')).body;
  assert.deepEqual(ctx.canais.filter((c) => c.tipo === 'youtube').map((c) => c.id).sort(), [c1, c2].sort());
});

test('gostei: marca, aparece na aba, desmarca, e nao vale pra corte de outro', async () => {
  const { u, agent } = await logado();
  const v = await video(u.id);
  const a = await corte(v);
  await corte(v);

  let r = await agent.put(`/api/client/feed/cortes/youtube/${a}/gostei`, { gostei: true });
  assert.equal(r.status, 200);
  assert.equal(r.body.totalGostei, 1);
  // Marcar de novo não duplica.
  r = await agent.put(`/api/client/feed/cortes/youtube/${a}/gostei`, { gostei: true });
  assert.equal(r.body.totalGostei, 1);
  const aba = (await agent.get('/api/client/feed?aba=gostei')).body.cortes;
  assert.deepEqual(aba.map((c) => c.id), [a]);
  assert.equal(aba[0].gostei, true);

  r = await agent.put(`/api/client/feed/cortes/youtube/${a}/gostei`, { gostei: false });
  assert.equal(r.body.totalGostei, 0);
  assert.equal((await agent.get('/api/client/feed?aba=gostei')).body.cortes.length, 0);
  assert.equal((await agent.put(`/api/client/feed/cortes/youtube/${a}/gostei`, {})).status, 400);

  const outro = await logado();
  assert.equal((await outro.agent.put(`/api/client/feed/cortes/youtube/${a}/gostei`, { gostei: true })).status, 404);
});

test('enviar pra fila: cria a postagem na conta escolhida, avisa repeticao e devolve cancelada', async () => {
  const { u, agent } = await logado();
  const conta = await contaTiktok(u.id);
  const c = await corte(await video(u.id));

  let r = await agent.post(`/api/client/feed/cortes/youtube/${c}/enviar`, { tiktokAccountIds: [conta] });
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

  r = await agent.post(`/api/client/feed/cortes/youtube/${c}/enviar`, { tiktokAccountIds: [conta] });
  assert.equal(r.body.resultados[0].resultado, 'ja_na_fila');

  await pool.query("UPDATE postings SET status = 'skipped' WHERE id = $1", [rows[0].id]);
  r = await agent.post(`/api/client/feed/cortes/youtube/${c}/enviar`, { tiktokAccountIds: [conta] });
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

  const r = await agent.post(`/api/client/feed/cortes/youtube/${c}/enviar`, { tiktokAccountIds: [minha, dele] });
  assert.equal(r.status, 404);
  const { rows } = await pool.query('SELECT 1 FROM postings p JOIN videos v ON v.id = p.video_id WHERE v.clip_id = $1', [c]);
  assert.equal(rows.length, 0);

  assert.equal((await agent.post(`/api/client/feed/cortes/youtube/${c}/enviar`, { tiktokAccountIds: [] })).status, 400);
  // Corte de outro cliente não pode ser enviado nem pra conta dele mesmo.
  const deOutro = await corte(await video(outro.u.id));
  assert.equal((await agent.post(`/api/client/feed/cortes/youtube/${deOutro}/enviar`, { tiktokAccountIds: [minha] })).status, 404);
});

test('enviar: corte cujo arquivo sumiu e recusado com 410', async () => {
  const { u, agent } = await logado();
  const conta = await contaTiktok(u.id);
  const c = await corte(await video(u.id));
  const { rows } = await pool.query('SELECT local_clip_path FROM clips WHERE id = $1', [c]);
  fs.rmSync(rows[0].local_clip_path);
  assert.equal((await agent.post(`/api/client/feed/cortes/youtube/${c}/enviar`, { tiktokAccountIds: [conta] })).status, 410);
});

// ---------------------------------------------------------------------------
// Cortes de LIVE no feed e na fila (08/10/2026)
// ---------------------------------------------------------------------------
const livesRepository = require('../../src/repositories/livesRepository');
const postingsRepository = require('../../src/repositories/postingsRepository');
const postingCleanupJob = require('../../src/worker/jobs/postingCleanupJob');
const liveCleanupService = require('../../src/services/lives/liveCleanupService');

async function canalDeLive() {
  return livesRepository.upsertChannel({ login: `feed_${uid()}`, displayName: 'Streamer', platformUserId: '1', profileImageUrl: null });
}

async function corteDeLive(userId, canalId, { comArquivo = true, prontoHaHoras = 0 } = {}) {
  const arquivo = path.join(pasta, `live_${uid()}.mp4`);
  if (comArquivo) fs.writeFileSync(arquivo, 'video de live falso');
  const { rows } = await pool.query(
    `INSERT INTO live_clips (live_channel_id, user_id, source, start_offset, end_offset, title, hook, status, local_clip_path, ready_at)
     VALUES ($1, $2, 'triagem', 100, 160, 'Momento da live', 'Que jogada!', 'pronto', $3, now() - make_interval(hours => $4)) RETURNING id`,
    [canalId, userId, arquivo, prontoHaHoras]
  );
  return Number(rows[0].id);
}

test('cortes de live aparecem junto, e os filtros de origem, canal e ordem funcionam', async () => {
  const { u, agent } = await logado();
  const yt = await corte(await video(u.id));
  const ch = await canalDeLive();
  const live = await corteDeLive(u.id, ch.id);

  const todos = (await agent.get('/api/client/feed')).body.cortes;
  assert.deepEqual(todos.map((c) => c.chave), [`live-${live}`, `youtube-${yt}`], 'o mais recente primeiro, dos dois tipos');
  assert.match(todos[0].videoUrl, new RegExp(`/lives/cortes/${live}/arquivo$`));
  assert.equal(todos[0].duracaoSegundos, 60);

  assert.deepEqual((await agent.get('/api/client/feed?origem=lives')).body.cortes.map((c) => c.chave), [`live-${live}`]);
  assert.deepEqual((await agent.get('/api/client/feed?origem=youtube')).body.cortes.map((c) => c.chave), [`youtube-${yt}`]);
  assert.deepEqual((await agent.get(`/api/client/feed?canal=live-${ch.id}`)).body.cortes.map((c) => c.chave), [`live-${live}`]);
  assert.deepEqual(
    (await agent.get('/api/client/feed?ordem=antigos')).body.cortes.map((c) => c.chave),
    [`youtube-${yt}`, `live-${live}`],
    'mais antigos primeiro'
  );
  const ctx = (await agent.get('/api/client/feed/contexto')).body;
  assert.ok(ctx.canais.some((c) => c.chave === `live-${ch.id}`));

  // Corte de live de outro cliente no mesmo canal não aparece.
  const outro = await logado();
  await corteDeLive(outro.u.id, ch.id);
  assert.equal((await agent.get(`/api/client/feed?canal=live-${ch.id}`)).body.cortes.length, 1);
});

test('paginacao com cursor nao repete nem pula, nas duas ordens', async () => {
  const { u, agent } = await logado();
  const v = await video(u.id);
  const ch = await canalDeLive();
  const chaves = [];
  for (let i = 0; i < 9; i++) chaves.push(`youtube-${await corte(v)}`);
  for (let i = 0; i < 9; i++) chaves.push(`live-${await corteDeLive(u.id, ch.id)}`);
  for (const ordem of ['recentes', 'antigos']) {
    const vistos = [];
    let cursor = null;
    for (let volta = 0; volta < 5; volta++) {
      const r = (await agent.get(`/api/client/feed?ordem=${ordem}${cursor ? `&depois=${cursor}` : ''}`)).body;
      vistos.push(...r.cortes.map((c) => c.chave));
      cursor = r.proximo;
      if (!cursor) break;
    }
    assert.equal(vistos.length, 18, `ordem ${ordem}`);
    assert.equal(new Set(vistos).size, 18, 'nenhum repetido');
  }
});

test('gostei vale pra corte de live, e aba gostei mistura os dois tipos', async () => {
  const { u, agent } = await logado();
  const yt = await corte(await video(u.id));
  const ch = await canalDeLive();
  const live = await corteDeLive(u.id, ch.id);
  await agent.put(`/api/client/feed/cortes/youtube/${yt}/gostei`, { gostei: true });
  const r = await agent.put(`/api/client/feed/cortes/live/${live}/gostei`, { gostei: true });
  assert.equal(r.body.totalGostei, 2);
  const aba = (await agent.get('/api/client/feed?aba=gostei')).body.cortes.map((c) => c.chave);
  assert.deepEqual(aba.sort(), [`live-${live}`, `youtube-${yt}`].sort());

  const outro = await logado();
  assert.equal((await outro.agent.put(`/api/client/feed/cortes/live/${live}/gostei`, { gostei: true })).status, 404);
});

test('corte de live vai pra fila, o publicador acha o arquivo, e as limpezas nao se confundem', async () => {
  const { u, agent } = await logado();
  const conta = await contaTiktok(u.id);
  const ch = await canalDeLive();
  // Corte de live cujo prazo de 3 dias JA passou: a limpeza das lives apagaria,
  // mas ele esta na fila e nao pode sumir dela.
  const live = await corteDeLive(u.id, ch.id, { prontoHaHoras: 100 });

  const r = await agent.post(`/api/client/feed/cortes/live/${live}/enviar`, { tiktokAccountIds: [conta] });
  assert.equal(r.status, 200);
  assert.equal(r.body.resultados[0].resultado, 'enfileirado');

  await pool.query("UPDATE postings SET scheduled_for = now() - interval '1 minute' WHERE tiktok_account_id = $1", [conta]);
  const daVez = await postingsRepository.findOldestDuePendingForAccount(conta);
  assert.ok(daVez, 'o publicador enxerga a postagem do corte de live');
  const { rows: k } = await pool.query('SELECT local_clip_path FROM live_clips WHERE id = $1', [live]);
  assert.equal(daVez.local_clip_path, k[0].local_clip_path);
  assert.equal(Number(daVez.clip_end_seconds) - Number(daVez.clip_start_seconds), 60);

  await liveCleanupService.apagarCortesVencidos(72);
  assert.equal((await pool.query('SELECT 1 FROM live_clips WHERE id = $1', [live])).rows.length, 1, 'corte na fila nao pode ser apagado pela limpeza das lives');

  // Publicado ha 4 dias: a limpeza de 3 dias apaga o corte de LIVE - e nunca um
  // corte do YouTube que tenha o mesmo numero.
  // Garante que existe um corte do YouTube com o MESMO numero do corte de live
  // (ids das duas tabelas sao independentes e se cruzam na vida real).
  const outroDono = await logado();
  const vOutro = await video(outroDono.u.id);
  await pool.query(
    `INSERT INTO clips (id, source_video_id, title, start_seconds, end_seconds, status)
     VALUES ($1, $2, 'Corte do YouTube de mesmo numero', 0, 30, 'ready') ON CONFLICT (id) DO NOTHING`,
    [live, vOutro]
  );
  const { rows: mesmoNumero } = await pool.query('SELECT id FROM clips WHERE id = $1', [live]);
  assert.equal(mesmoNumero.length, 1);
  await pool.query("UPDATE postings SET status = 'posted', posted_at = now() - interval '4 days' WHERE tiktok_account_id = $1", [conta]);
  await postingCleanupJob.run();
  assert.equal((await pool.query('SELECT 1 FROM live_clips WHERE id = $1', [live])).rows.length, 0);
  if (mesmoNumero.length) {
    assert.equal((await pool.query('SELECT 1 FROM clips WHERE id = $1', [live])).rows.length, 1, 'corte do YouTube de mesmo numero ficou');
  }
});
