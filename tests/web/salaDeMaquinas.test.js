// Início novo (12/10/2026): a "sala de máquinas" mostra a linha de produção ao
// vivo. Em teste só com o admin e a Rise Style (painel novo).
//
// O que importa travar aqui é quem vê o quê: o cliente vê só o trabalho dele,
// cliente fora do teste não vê nada, e o sistema inteiro é só do admin.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const pool = require('../../src/db/pool');
const settingsRepository = require('../../src/repositories/settingsRepository');
const painelNovo = require('../../src/lib/painelNovo');
const { startServer, stopServer, createLoginableClient, createAgent } = require('../helpers/http');

let url;

test.before(async () => {
  url = await startServer();
});

test.after(async () => {
  await stopServer();
  await pool.end();
});

async function logado({ noPainelNovo = true, role = 'client' } = {}) {
  const u = await createLoginableClient({ role });
  if (noPainelNovo && role === 'client') {
    const atuais = await painelNovo.idsLiberados();
    await settingsRepository.setValue(painelNovo.CHAVE, [...atuais, Number(u.id)]);
  }
  const agent = createAgent(url);
  await agent.login(u.email, u.password);
  return { u, agent };
}

// Começou "há muito tempo": a linha mostra os primeiros 4 por ordem de
// início, e outros arquivos de teste deixam vídeos em processamento no banco.
async function videoEmTranscricao(clientUserId, titulo) {
  const { rows } = await pool.query(
    `INSERT INTO youtube_channels (client_user_id, youtube_channel_id, channel_name, channel_url)
     VALUES ($1, $2, 'Canal da máquina', 'https://youtube.com/x') RETURNING id`,
    [clientUserId, `UC${clientUserId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`]
  );
  await pool.query(
    `INSERT INTO source_videos (youtube_channel_id, youtube_video_id, title, status, input_type, owner_client_user_id, processing_started_at)
     VALUES ($1, md5(random()::text), $2, 'transcribing', 'channel', $3, '2000-01-01')`,
    [rows[0].id, titulo, clientUserId]
  );
}

test('cliente no painel novo vê a própria linha, e só a dele', async () => {
  const { u, agent } = await logado();
  const outro = await logado();
  await videoEmTranscricao(u.id, 'video do dono da conta');
  await videoEmTranscricao(outro.u.id, 'video de outro cliente');

  const r = await agent.get('/api/client/maquina');
  assert.equal(r.status, 200);
  assert.equal(r.body.escopo, 'cliente');
  assert.equal(r.body.etapas.transcrevendo, 1);
  const titulos = r.body.processando.map((v) => v.titulo);
  assert.deepEqual(titulos, ['video do dono da conta']);
  assert.equal(r.body.processando[0].cliente, null, 'cliente não vê nome de cliente nenhum');
  assert.ok(!JSON.stringify(r.body).includes('video de outro cliente'), 'nada do outro cliente vaza, nem no registro');
});

test('cliente fora do teste não acessa a máquina', async () => {
  const { agent } = await logado({ noPainelNovo: false });
  const r = await agent.get('/api/client/maquina');
  assert.equal(r.status, 403);
});

test('o sistema inteiro é só do admin', async () => {
  const cliente = await logado();
  const r = await cliente.agent.get('/api/admin/maquina');
  assert.equal(r.status, 403);

  await videoEmTranscricao(cliente.u.id, 'video visto pelo admin');
  const admin = await logado({ role: 'admin' });
  const s = await admin.agent.get('/api/admin/maquina');
  assert.equal(s.status, 200);
  assert.equal(s.body.escopo, 'sistema');
  const v = s.body.processando.find((x) => x.titulo === 'video visto pelo admin');
  assert.ok(v, 'admin vê vídeo de qualquer cliente');
  assert.ok(v.cliente, 'e sabe de qual cliente ele é');
});

test('live compartilhada: cada cliente vê só os cortes feitos pra ele', async () => {
  const a = await logado();
  const b = await logado();
  const { rows: [canal] } = await pool.query(
    `INSERT INTO live_channels (platform, login, display_name, is_live) VALUES ('twitch', $1, 'Canal compartilhado', true) RETURNING id`,
    [`maq_${Date.now()}`]
  );
  for (const u of [a.u, b.u]) {
    await pool.query('INSERT INTO live_channel_follows (user_id, live_channel_id) VALUES ($1, $2)', [u.id, canal.id]);
  }
  const { rows: [sessao] } = await pool.query(
    `INSERT INTO live_sessions (live_channel_id, status, dir_path, recorded_seconds) VALUES ($1, 'gravando', '/tmp/x', 600) RETURNING id`,
    [canal.id]
  );
  await pool.query(
    `INSERT INTO live_clips (session_id, live_channel_id, user_id, source, start_offset, end_offset, title, status, ready_at)
     VALUES ($1, $2, $3, 'triagem', 10, 60, 'corte feito pro cliente B', 'pronto', now())`,
    [sessao.id, canal.id, b.u.id]
  );

  const ra = await a.agent.get('/api/client/maquina');
  const rb = await b.agent.get('/api/client/maquina');
  const liveA = ra.body.aoVivo.find((l) => l.id === Number(canal.id));
  const liveB = rb.body.aoVivo.find((l) => l.id === Number(canal.id));
  assert.ok(liveA && liveB, 'os dois veem a live gravando');
  assert.equal(liveA.cortes.length, 0);
  assert.equal(ra.body.feed.prontos, 0);
  assert.ok(!JSON.stringify(ra.body).includes('corte feito pro cliente B'));
  assert.equal(liveB.cortes.length, 1);
  assert.equal(rb.body.feed.prontos, 1);
});

// Duas contas na mesma rede: cada vídeo tem que apontar pra faixa da conta
// certa, e toda faixa de destino tem que existir na saída. Se a chave do
// destino e a da faixa saírem de regras diferentes, o corte "voa" pra conta
// errada na tela.
test('várias contas por rede: cada corte vai pra faixa da conta certa', async () => {
  const { u, agent } = await logado();
  const conta = async (openId, nome) =>
    (await pool.query(
      `INSERT INTO tiktok_accounts (client_user_id, tiktok_open_id, display_name, is_active,
         access_token_encrypted, access_token_iv, refresh_token_encrypted, refresh_token_iv, scopes, token_expires_at, connected_at)
       VALUES ($1, $2, $3, true, 'x','x','x','x', ARRAY['video.publish'], now() + interval '30 days', now()) RETURNING id`,
      [u.id, `${openId}_${Date.now()}_${u.id}`, nome]
    )).rows[0].id;
  const tt1 = await conta('tt1', 'conta.um');
  const tt2 = await conta('tt2', 'conta.dois');
  const ig = (await pool.query(
    `INSERT INTO social_accounts (client_user_id, network, outstand_account_id, username) VALUES ($1, 'instagram', $2, 'insta.um') RETURNING id`,
    [u.id, `acc_maq_${Date.now()}_${u.id}`]
  )).rows[0].id;
  const igSemPublicarSozinho = (await pool.query(
    `INSERT INTO social_accounts (client_user_id, network, outstand_account_id, username) VALUES ($1, 'instagram', $2, 'insta.dois') RETURNING id`,
    [u.id, `acc_maq2_${Date.now()}_${u.id}`]
  )).rows[0].id;
  await pool.query('INSERT INTO social_posting_settings (social_account_id, auto_post_enabled) VALUES ($1, false)', [igSemPublicarSozinho]);

  const canal = async (nome, tiktok) =>
    (await pool.query(
      `INSERT INTO youtube_channels (client_user_id, youtube_channel_id, channel_name, channel_url, tiktok_account_id)
       VALUES ($1, $2, $3, 'https://youtube.com/x', $4) RETURNING id`,
      [u.id, `UC${nome}_${Date.now()}_${u.id}`, nome, tiktok]
    )).rows[0].id;
  const canalA = await canal('canalA', tt1);
  const canalB = await canal('canalB', tt2);
  await pool.query('INSERT INTO youtube_channel_social_targets (youtube_channel_id, social_account_id) VALUES ($1, $2), ($1, $3)', [canalA, ig, igSemPublicarSozinho]);
  for (const [c, titulo] of [[canalA, 'video do canal A'], [canalB, 'video do canal B']]) {
    await pool.query(
      `INSERT INTO source_videos (youtube_channel_id, youtube_video_id, title, status, input_type, owner_client_user_id, processing_started_at)
       VALUES ($1, md5(random()::text), $2, 'cutting', 'channel', $3, '2000-01-01')`,
      [c, titulo, u.id]
    );
  }

  const r = await agent.get('/api/client/maquina');
  assert.equal(r.status, 200);
  const faixas = r.body.filas.map((f) => f.chave).sort();
  assert.deepEqual(faixas, [`instagram:${ig}`, `instagram:${igSemPublicarSozinho}`, `tiktok:${tt1}`, `tiktok:${tt2}`].sort());
  const destinos = Object.fromEntries(r.body.processando.map((v) => [v.titulo, [...v.destinos].sort()]));
  // Canal A: a conta do TikTok dele e o Instagram com "publicar sozinho" ligado.
  // O Instagram com publicar sozinho DESLIGADO não recebe corte automático.
  assert.deepEqual(destinos['video do canal A'], [`instagram:${ig}`, `tiktok:${tt1}`].sort());
  assert.deepEqual(destinos['video do canal B'], [`tiktok:${tt2}`]);
  for (const v of r.body.processando) {
    for (const d of v.destinos) assert.ok(faixas.includes(d), `destino ${d} sem faixa na saída`);
  }
});

// Resumo da barra do topo / menu: as mesmas travas do estado completo.
test('resumo do topo: só painel novo, só o que é do cliente, sistema só pro admin', async () => {
  const fora = await logado({ noPainelNovo: false });
  assert.equal((await fora.agent.get('/api/client/maquina/resumo')).status, 403);

  const { u, agent } = await logado();
  const outro = await logado();
  await videoEmTranscricao(u.id, 'video meu no resumo');
  await videoEmTranscricao(outro.u.id, 'video alheio no resumo');
  await videoEmTranscricao(outro.u.id, 'outro video alheio no resumo');

  const r = await agent.get('/api/client/maquina/resumo');
  assert.equal(r.status, 200);
  assert.equal(r.body.naLinha, 1, 'conta só o vídeo do próprio cliente');

  assert.equal((await agent.get('/api/admin/maquina/resumo')).status, 403);
  const admin = await logado({ role: 'admin' });
  const s = await admin.agent.get('/api/admin/maquina/resumo');
  assert.equal(s.status, 200);
  assert.ok(s.body.naLinha >= 3, 'o admin vê a linha de todo mundo');
});
