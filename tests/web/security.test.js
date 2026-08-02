// Ataques de verdade contra o app rodando (rota + sessao + CSRF + controller +
// repositorio). Os testes de repositorio provam que a QUERY filtra por dono;
// estes provam que nao existe caminho pela HTTP que contorne isso.
//
// Se algum destes falhar, e um buraco de seguranca real, nao um detalhe.
'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { startServer, stopServer, createLoginableClient, createAgent } = require('../helpers/http');
const { pool, createSourceVideo, createYoutubeChannel } = require('../helpers/db');

let url;

test.before(async () => {
  url = await startServer();
});

test.after(async () => {
  await stopServer();
  await pool.end();
});

// --------------------------------------------------------------------------
// CSRF
// --------------------------------------------------------------------------

test('CSRF: POST logado SEM o token e recusado', async () => {
  const cliente = await createLoginableClient();
  const agent = createAgent(url);
  await agent.login(cliente.email, cliente.password);

  // Exatamente o que um site malicioso conseguiria fazer: o navegador manda o
  // cookie de sessao, mas o atacante nao tem como saber o token.
  const r = await agent.postSemCsrf('/api/client/youtube-channels', {
    channelUrl: 'https://youtube.com/@qualquer',
  });

  assert.strictEqual(r.status, 403, 'requisicao sem token anti-CSRF tem que ser recusada');
});

test('CSRF: POST logado COM o token passa da checagem', async () => {
  const cliente = await createLoginableClient();
  const agent = createAgent(url);
  await agent.login(cliente.email, cliente.password);

  const r = await agent.post('/api/client/youtube-channels', {
    channelUrl: 'https://youtube.com/@qualquer',
  });

  // Pode falhar por regra de negocio (sem plano ativo, canal invalido), mas
  // NAO pela mensagem de CSRF - e isso que estamos checando.
  assert.ok(
    !r.body?.error?.includes('Sessao expirada'),
    `com token valido nao pode cair no bloqueio de CSRF (veio: ${JSON.stringify(r.body)})`
  );
});

test('CSRF: GET nao exige token (senao o painel nem carregaria)', async () => {
  const cliente = await createLoginableClient();
  const agent = createAgent(url);
  await agent.login(cliente.email, cliente.password);

  const r = await agent.get('/api/client/youtube-channels');
  assert.strictEqual(r.status, 200);
});

// --------------------------------------------------------------------------
// Autenticacao
// --------------------------------------------------------------------------

test('sem login, as rotas de API do cliente recusam', async () => {
  const anonimo = createAgent(url);
  const r = await anonimo.get('/api/client/youtube-channels');
  assert.ok(r.status === 401 || r.status === 403, `esperava 401/403, veio ${r.status}`);
});

test('cliente nao alcanca as rotas de admin', async () => {
  const cliente = await createLoginableClient();
  const agent = createAgent(url);
  await agent.login(cliente.email, cliente.password);

  for (const rota of ['/api/admin/dashboard', '/api/admin/clients', '/api/admin/metrics', '/api/admin/bandwidth']) {
    const r = await agent.get(rota);
    assert.ok(r.status === 401 || r.status === 403, `${rota} deveria recusar cliente, veio ${r.status}`);
  }
});

// --------------------------------------------------------------------------
// IDOR - o risco central de um sistema multi-tenant
// --------------------------------------------------------------------------

test('IDOR: cliente nao le os cortes de um video de outro cliente', async () => {
  const dono = await createLoginableClient();
  const invasor = await createLoginableClient();
  const video = await createSourceVideo(dono.id, { status: 'ready' });

  const agent = createAgent(url);
  await agent.login(invasor.email, invasor.password);

  const r = await agent.get(`/api/client/source-videos/${video.id}/clips`);
  assert.ok(r.status === 403 || r.status === 404, `esperava 403/404, veio ${r.status}`);
});

test('IDOR: cliente nao apaga video de outro cliente', async () => {
  const dono = await createLoginableClient();
  const invasor = await createLoginableClient();
  const video = await createSourceVideo(dono.id);

  const agent = createAgent(url);
  await agent.login(invasor.email, invasor.password);
  const r = await agent.delete(`/api/client/source-videos/${video.id}`);

  assert.ok(r.status === 403 || r.status === 404, `esperava 403/404, veio ${r.status}`);
  const { rows } = await pool.query('SELECT id FROM source_videos WHERE id = $1', [video.id]);
  assert.strictEqual(rows.length, 1, 'o video do dono nao pode ter sido apagado');
});

test('IDOR: exclusao em LOTE tambem respeita a posse', async () => {
  // A exclusao em lote recebe uma lista de IDs no corpo. E o tipo de rota onde
  // e facil esquecer de checar dono item a item.
  const dono = await createLoginableClient();
  const invasor = await createLoginableClient();
  const doDono = await createSourceVideo(dono.id, { title: 'do dono' });
  const doInvasor = await createSourceVideo(invasor.id, { title: 'do invasor' });

  const agent = createAgent(url);
  await agent.login(invasor.email, invasor.password);
  await agent.post('/api/client/source-videos/bulk-delete', { ids: [Number(doDono.id), Number(doInvasor.id)] });

  const { rows: sobrouDoDono } = await pool.query('SELECT id FROM source_videos WHERE id = $1', [doDono.id]);
  const { rows: sobrouDoInvasor } = await pool.query('SELECT id FROM source_videos WHERE id = $1', [doInvasor.id]);

  assert.strictEqual(sobrouDoDono.length, 1, 'o video do OUTRO cliente nao pode ser apagado em lote');
  assert.strictEqual(sobrouDoInvasor.length, 0, 'o proprio video do invasor pode, sim, ser apagado');
});

test('IDOR: cliente nao pausa nem retoma video de outro cliente', async () => {
  const dono = await createLoginableClient();
  const invasor = await createLoginableClient();
  const video = await createSourceVideo(dono.id, { status: 'cutting' });

  const agent = createAgent(url);
  await agent.login(invasor.email, invasor.password);

  const pausa = await agent.post(`/api/client/source-videos/${video.id}/pause`);
  assert.ok(pausa.status >= 400, `pausar video alheio tem que falhar, veio ${pausa.status}`);

  const { rows } = await pool.query('SELECT cancel_requested, status FROM source_videos WHERE id = $1', [video.id]);
  assert.strictEqual(rows[0].cancel_requested, false, 'nao pode ter marcado pausa no video do outro');
  assert.strictEqual(rows[0].status, 'cutting');
});

test('IDOR: cliente nao desativa nem apaga canal de outro cliente', async () => {
  const dono = await createLoginableClient();
  const invasor = await createLoginableClient();
  const canal = await createYoutubeChannel(dono.id);

  const agent = createAgent(url);
  await agent.login(invasor.email, invasor.password);

  await agent.post(`/api/client/youtube-channels/${canal.id}/active`, { isActive: false });
  await agent.delete(`/api/client/youtube-channels/${canal.id}`);

  const { rows } = await pool.query('SELECT id, is_active FROM youtube_channels WHERE id = $1', [canal.id]);
  assert.strictEqual(rows.length, 1, 'o canal do dono nao pode ter sido apagado');
  assert.strictEqual(rows[0].is_active, true, 'o canal do dono nao pode ter sido desativado');
});

test('IDOR: a listagem de videos so traz os do proprio cliente', async () => {
  const dono = await createLoginableClient();
  const invasor = await createLoginableClient();
  await createSourceVideo(dono.id, { title: 'segredo do dono' });

  const agent = createAgent(url);
  await agent.login(invasor.email, invasor.password);
  const r = await agent.get('/api/client/source-videos');

  assert.strictEqual(r.status, 200);
  const titulos = JSON.stringify(r.body);
  assert.ok(!titulos.includes('segredo do dono'), 'video de outro cliente vazou na listagem');
});
