// API da tela "Lives" (/api/admin/lives) - so admin, na fase de validacao.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const pool = require('../../src/db/pool');
const twitchApi = require('../../src/services/lives/twitchApi');
const kickApi = require('../../src/services/lives/kickApi');
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

test('Twitch sem configuracao nao bloqueia o modulo: so avisa, e so pra quem acompanha canal da Twitch', async () => {
  const { u, agent } = await logado('admin');
  let r = await agent.get('/api/admin/lives');
  assert.equal(r.status, 200);
  assert.equal(r.body.ligado, false);
  assert.ok(!r.body.bloqueios.some((b) => /TWITCH/.test(b)), 'a Kick funciona sem o app da Twitch');
  assert.ok(!(r.body.avisos || []).some((a) => /TWITCH/.test(a)));

  const canal = await livesRepository.upsertChannel({ login: loginNovo(), displayName: 'x', platformUserId: '1', profileImageUrl: null });
  await livesRepository.follow(u.id, canal.id);
  r = await agent.get('/api/admin/lives');
  assert.ok(r.body.avisos.some((a) => /TWITCH_CLIENT_ID/.test(a)));
});

test('adicionar canal da Kick: pelo link ou pelo nome com a plataforma escolhida, sem precisar da Twitch', async () => {
  const { agent } = await logado('admin');
  const slug = `k${Date.now().toString(36)}`;
  const desfazer = [
    trocar(kickApi, 'buscarUsuario', async (l) => (l === slug ? { id: '4242', login: slug, nome: 'Canal Kick', imagem: null } : null)),
    trocar(kickApi, 'buscarAoVivo', async (logins) => ({
      aoVivo: new Map(logins.filter((l) => l === slug).map((l) => [l, { titulo: 'ao vivo', jogo: 'Just Chatting', espectadores: 321 }])),
      falharam: new Set(),
    })),
  ];
  try {
    assert.equal((await agent.post('/api/admin/lives/canais', { canal: 'kick.com/nao-existe-zz' })).status, 404);
    const r = await agent.post('/api/admin/lives/canais', { canal: `https://kick.com/${slug}?ref=x` });
    assert.equal(r.status, 200);
    const canal = r.body.canais.find((c) => c.login === slug);
    assert.equal(canal.plataforma, 'kick');
    assert.equal(canal.url, `https://kick.com/${slug}`);
    assert.equal(canal.aoVivo, true);
    assert.equal(canal.espectadores, 321);

    // Nome solto + plataforma escolhida na tela = o mesmo canal (nao duplica).
    const r2 = await agent.post('/api/admin/lives/canais', { canal: slug, plataforma: 'kick' });
    assert.equal(r2.body.canais.filter((c) => c.login === slug).length, 1);
    const { rows } = await pool.query("SELECT platform FROM live_channels WHERE login = $1", [slug]);
    assert.deepEqual(rows.map((x) => x.platform), ['kick']);
  } finally {
    desfazer.forEach((d) => d());
  }
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
  // 04/10/2026: o nivel maximo passou de nota 9 / 2 por hora pra nota 8 / 6
  // por hora - com 2 por hora quase nada saia.
  assert.equal(r2.body.niveis['5'].notaMinima, 8);
  assert.equal(r2.body.niveis['5'].porHora, 15, 'mesmo no "so os melhores" a IA pode entregar ate 15 por hora');
});

test('tipos de corte: id desconhecido e recusado, lista vazia vira "todos", e a escolha volta na resposta', async () => {
  const { agent } = await logado('admin');
  assert.equal((await agent.put('/api/admin/lives/opcoes', { categorias: ['humor', 'nao-existe'] })).status, 400);
  assert.equal((await agent.put('/api/admin/lives/opcoes', { categorias: 'humor' })).status, 400);
  let r = await agent.put('/api/admin/lives/opcoes', { categorias: ['dinheiro', 'humor', 'humor'] });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.opcoes.categorias, ['dinheiro', 'humor']);
  assert.ok(r.body.categorias.some((c) => c.id === 'historias' && c.nome));
  // Mexer em outra opcao nao apaga a escolha.
  r = await agent.put('/api/admin/lives/opcoes', { qualidade: 2 });
  assert.deepEqual(r.body.opcoes.categorias, ['dinheiro', 'humor']);
  r = await agent.put('/api/admin/lives/opcoes', { categorias: [] });
  assert.equal(r.body.opcoes.categorias, null);
});

test('pausar e retomar canal: continua na lista, so muda o "pausado"; canal de outra pessoa e 404', async () => {
  const { u, agent } = await logado('admin');
  const outro = await logado('admin');
  const canal = await livesRepository.upsertChannel({ login: loginNovo(), displayName: 'x', platformUserId: '1', profileImageUrl: null });
  await livesRepository.follow(u.id, canal.id);
  let r = await agent.post(`/api/admin/lives/canais/${canal.id}/pausar`);
  assert.equal(r.status, 200);
  let c = r.body.canais.find((x) => x.id === Number(canal.id));
  assert.equal(c.pausado, true, 'pausado continua na lista');
  assert.equal((await outro.agent.post(`/api/admin/lives/canais/${canal.id}/pausar`)).status, 404);
  r = await agent.post(`/api/admin/lives/canais/${canal.id}/retomar`);
  c = r.body.canais.find((x) => x.id === Number(canal.id));
  assert.equal(c.pausado, false);
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
