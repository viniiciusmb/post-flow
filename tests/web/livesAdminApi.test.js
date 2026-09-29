// API da tela "Lives" (/api/admin/lives) - so admin, na fase de validacao.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const pool = require('../../src/db/pool');
const twitchApi = require('../../src/services/lives/twitchApi');
const livesRepository = require('../../src/repositories/livesRepository');
const { startServer, stopServer, createLoginableClient, createAgent } = require('../helpers/http');

let url;
test.before(async () => {
  url = await startServer();
});
test.after(async () => {
  await stopServer();
  await pool.end();
});

async function logado(role) {
  const u = await createLoginableClient({ role });
  const agent = createAgent(url);
  await agent.login(u.email, u.password);
  return { u, agent };
}

function trocar(modulo, nome, falsa) {
  const original = modulo[nome];
  modulo[nome] = falsa;
  return () => { modulo[nome] = original; };
}

let n = 0;
const loginNovo = () => `api_${Date.now().toString(36)}_${n++}`;

test('cliente comum nao enxerga a funcionalidade de lives', async () => {
  const { agent } = await logado('client');
  assert.equal((await agent.get('/api/admin/lives')).status, 403);
  assert.equal((await agent.put('/api/admin/lives/config', { ligado: true })).status, 403);
  assert.equal((await agent.post('/api/admin/lives/canais', { canal: 'gaules' })).status, 403);
});

test('admin ve o modulo desligado e o motivo de a Twitch nao estar pronta', async () => {
  const { agent } = await logado('admin');
  const r = await agent.get('/api/admin/lives');
  assert.equal(r.status, 200);
  assert.equal(r.body.ligado, false);
  assert.ok(r.body.bloqueios.some((b) => /TWITCH_CLIENT_ID/.test(b)));
});

test('salvar configuracao puxa os limites pra dentro da faixa', async () => {
  const { agent } = await logado('admin');
  const r = await agent.put('/api/admin/lives/config', { config: { maxCanais: 99, horasPorCanalDia: 3 } });
  assert.equal(r.status, 200);
  assert.equal(r.body.config.maxCanais, 5);
  assert.equal(r.body.config.horasPorCanalDia, 3);
  await agent.put('/api/admin/lives/config', { config: { maxCanais: 2, horasPorCanalDia: 8 } });
});

test('adicionar canal: nome invalido e 400; canal que nao existe e 404; valido entra na lista', async () => {
  const { agent } = await logado('admin');
  assert.equal((await agent.post('/api/admin/lives/canais', { canal: 'nome invalido!' })).status, 400);

  const login = loginNovo();
  const desfazer = [
    trocar(twitchApi, 'configurado', () => true),
    trocar(twitchApi, 'buscarUsuario', async (l) => (l === login ? { id: '123', login, nome: 'Canal Teste', imagem: null } : null)),
    // O canal esta AO VIVO na Twitch agora.
    trocar(twitchApi, 'buscarAoVivo', async (logins) => new Map(logins.filter((l) => l === login).map((l) => [l, { titulo: 'live', jogo: 'Just Chatting', espectadores: 1823 }]))),
  ];
  try {
    assert.equal((await agent.post('/api/admin/lives/canais', { canal: 'naoexiste_xyz' })).status, 404);
    const r = await agent.post('/api/admin/lives/canais', { canal: `https://twitch.tv/${login}` });
    assert.equal(r.status, 200);
    const canal = r.body.canais.find((c) => c.login === login);
    assert.equal(canal.nome, 'Canal Teste');
    // Com o modulo DESLIGADO (padrao), o canal aparece ao vivo na hora - antes
    // aparecia "Offline" porque so o monitor (que so roda ligado) consultava.
    assert.equal(r.body.ligado, false);
    assert.equal(canal.aoVivo, true);
    assert.equal(canal.espectadores, 1823);
  } finally {
    desfazer.forEach((d) => d());
  }
});

test('clipar agora: so durante a gravacao, pega os ultimos 150s, e so em canal que a pessoa acompanha', async () => {
  const { u, agent } = await logado('admin');
  const canal = await livesRepository.upsertChannel({ login: loginNovo(), displayName: 'x', platformUserId: '1', profileImageUrl: null });

  assert.equal((await agent.post(`/api/admin/lives/canais/${canal.id}/clipar-agora`)).status, 404, 'nao acompanha');
  await livesRepository.follow(u.id, canal.id);
  assert.equal((await agent.post(`/api/admin/lives/canais/${canal.id}/clipar-agora`)).status, 409, 'nao esta gravando');

  const s = await livesRepository.createSession({ channelId: canal.id, dirPath: '/tmp/x' });
  await pool.query('UPDATE live_sessions SET recorded_seconds = 400 WHERE id = $1', [s.id]);
  const r = await agent.post(`/api/admin/lives/canais/${canal.id}/clipar-agora`);
  assert.equal(r.status, 201);
  const { rows } = await pool.query('SELECT source, start_offset, end_offset, user_id, status FROM live_clips WHERE id = $1', [r.body.id]);
  assert.deepEqual(
    { ...rows[0], start_offset: Number(rows[0].start_offset), end_offset: Number(rows[0].end_offset), user_id: Number(rows[0].user_id) },
    { source: 'clipar_agora', start_offset: 250, end_offset: 400, user_id: Number(u.id), status: 'na_fila' }
  );
});

test('um admin nao acessa nem apaga o corte de outro', async () => {
  const dono = await logado('admin');
  const outro = await logado('admin');
  const canal = await livesRepository.upsertChannel({ login: loginNovo(), displayName: 'x', platformUserId: '1', profileImageUrl: null });
  const corte = await livesRepository.insertClip({ sessionId: null, channelId: canal.id, userId: dono.u.id, candidateId: null, source: 'triagem', inicio: 0, fim: 30, titulo: 't' });
  assert.equal((await outro.agent.get(`/api/admin/lives/cortes/${corte.id}/arquivo`)).status, 404);
  assert.equal((await outro.agent.delete(`/api/admin/lives/cortes/${corte.id}`)).status, 404);
  assert.equal((await outro.agent.get('/api/admin/lives/cortes')).body.cortes.some((c) => c.id === Number(corte.id)), false);
  assert.equal((await dono.agent.get('/api/admin/lives/cortes')).body.cortes.some((c) => c.id === Number(corte.id)), true);
});

test('opcoes de live: qualidade fora de 1 a 5 e recusada, dentro e salva', async () => {
  const { agent } = await logado('admin');
  assert.equal((await agent.put('/api/admin/lives/opcoes', { qualidade: 9 })).status, 400);
  assert.equal((await agent.put('/api/admin/lives/opcoes', { cameraAlturaPercent: 90 })).status, 400);
  const r = await agent.put('/api/admin/lives/opcoes', { qualidade: 4, cameraPosicao: 'bottom' });
  assert.equal(r.status, 200);
  assert.equal(r.body.opcoes.qualidade, 4);
  assert.equal(r.body.opcoes.cameraPosicao, 'bottom');
  // Campo ausente preserva o que ja estava salvo.
  // O padrao novo e a IA escolher o formato.
  assert.equal(r.body.opcoes.cameraModo, 'ia');
  assert.equal((await agent.put('/api/admin/lives/opcoes', { cameraModo: 'qualquer' })).status, 400);
  const r2 = await agent.put('/api/admin/lives/opcoes', { cameraModo: 'desligado' });
  assert.equal(r2.body.opcoes.qualidade, 4);
  assert.equal(r2.body.niveis['5'].notaMinima, 9);
});

test('estilo proprio de live nasce igual ao de video e editar ele NAO mexe no estilo de video', async () => {
  const { agent } = await logado('admin');
  const opcoes = (await agent.get('/api/client/video-settings')).body.options;
  const [estiloVideo, estiloLive] = opcoes.captionStyles.filter((c) => c !== 'none');
  assert.equal((await agent.put('/api/client/video-settings', { captionStyle: estiloVideo })).status, 200);

  // Ligado por padrao: a live usa o estilo de video.
  assert.equal((await agent.get('/api/admin/lives/estilo')).body.captionStyle, estiloVideo);

  // Desligar: nasce como copia do de video.
  const r = await agent.put('/api/admin/lives/opcoes', { usarEstiloDosVideos: false });
  assert.equal(r.body.opcoes.usarEstiloDosVideos, false);
  assert.equal((await agent.get('/api/admin/lives/estilo')).body.captionStyle, estiloVideo);

  // Editar o de live...
  const salvo = await agent.put('/api/admin/lives/estilo', { captionStyle: estiloLive });
  assert.equal(salvo.status, 200);
  assert.equal(salvo.body.captionStyle, estiloLive);
  // ...nao muda o de video.
  assert.equal((await agent.get('/api/client/video-settings')).body.captionStyle, estiloVideo);
});

test('estilo de live recusa fundo de capa do YouTube e imagem enviada, e valor invalido', async () => {
  const { agent } = await logado('admin');
  assert.equal((await agent.put('/api/admin/lives/estilo', { backgroundStyle: 'thumbnail' })).status, 400);
  assert.equal((await agent.put('/api/admin/lives/estilo', { backgroundStyle: 'template' })).status, 400);
  assert.equal((await agent.put('/api/admin/lives/estilo', { captionStyle: 'nao-existe' })).status, 400);
});
