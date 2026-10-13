// Tela "Lives" que vai pros clientes (/api/client/lives): "clipar sempre que
// estiver ao vivo" por canal, e o "clipar esta live" de quem deixou o
// automatico desligado. Em teste: so o admin abre.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const pool = require('../../src/db/pool');
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

async function logado(role = 'admin') {
  const u = await createLoginableClient({ role });
  const agent = createAgent(url);
  await agent.login(u.email, u.password);
  return { u, agent };
}

let n = 0;
async function canalSeguido(userId, { aoVivo = false, pausado = false } = {}) {
  const canal = await livesRepository.upsertChannel({
    login: `tela_${Date.now().toString(36)}_${n++}`,
    displayName: 'Canal',
    platformUserId: '1',
    profileImageUrl: null,
  });
  // last_checked_at no futuro: a tela nao vai consultar a plataforma de verdade.
  await pool.query("UPDATE live_channels SET is_live = $2, last_checked_at = now() + interval '1 hour' WHERE id = $1", [canal.id, aoVivo]);
  await livesRepository.follow(userId, canal.id);
  if (pausado) await livesRepository.setPaused(userId, canal.id, true);
  return Number(canal.id);
}

const doCanal = (r, id) => r.body.canais.find((c) => c.id === id);
const gravados = async () => (await livesRepository.listWatchedChannels()).map((c) => Number(c.id));

// Painel novo aberto pra todos desde 12/10/2026.
test('qualquer cliente abre a tela de lives', async () => {
  const { agent } = await logado('client');
  assert.equal((await agent.get('/api/client/lives')).status, 200);
});

test('ligar e desligar o automatico decide se o canal e gravado', async () => {
  const { u, agent } = await logado();
  const id = await canalSeguido(u.id, { aoVivo: true });
  let r = await agent.get('/api/client/lives');
  assert.equal(doCanal(r, id).autoClipar, true);
  assert.ok((await gravados()).includes(id));

  r = await agent.put(`/api/client/lives/canais/${id}/automatico`, { ligado: false });
  assert.equal(r.status, 200);
  assert.equal(doCanal(r, id).autoClipar, false);
  assert.equal(doCanal(r, id).recebendoCortes, false);
  assert.ok(!(await gravados()).includes(id), 'sem automatico e sem pedido, ninguem grava');

  assert.equal((await agent.put(`/api/client/lives/canais/${id}/automatico`, {})).status, 400);
});

test('clipar esta live: so com o canal ao vivo, grava, e acaba sozinho quando a live termina', async () => {
  const { u, agent } = await logado();
  const offline = await canalSeguido(u.id, { pausado: true });
  assert.equal((await agent.post(`/api/client/lives/canais/${offline}/clipar-esta-live`)).status, 409);
  assert.ok(!(await gravados()).includes(offline), 'pedido em canal offline nao pode ficar esperando a proxima live');

  const id = await canalSeguido(u.id, { aoVivo: true, pausado: true });
  const r = await agent.post(`/api/client/lives/canais/${id}/clipar-esta-live`);
  assert.equal(r.status, 200);
  assert.equal(doCanal(r, id).clipandoEstaLive, true);
  assert.equal(doCanal(r, id).recebendoCortes, true);
  assert.equal(doCanal(r, id).autoClipar, false);
  assert.ok((await gravados()).includes(id));
  // Recebe corte desta live (o juiz so entrega pra quem esta nesta lista).
  assert.ok((await livesRepository.followersWithQuality(id)).some((f) => f.user_id === Number(u.id)));

  // A live acabou: o pedido some, e a proxima live nao grava sozinha.
  await livesRepository.updateChannelStatus(id, { isLive: false });
  assert.ok(!(await gravados()).includes(id));
  await livesRepository.updateChannelStatus(id, { isLive: true });
  assert.ok(!(await gravados()).includes(id), 'live seguinte nao pode gravar sem novo pedido');
});

test('parar o "clipar esta live" antes da live acabar', async () => {
  const { u, agent } = await logado();
  const id = await canalSeguido(u.id, { aoVivo: true, pausado: true });
  await agent.post(`/api/client/lives/canais/${id}/clipar-esta-live`);
  const r = await agent.delete(`/api/client/lives/canais/${id}/clipar-esta-live`);
  assert.equal(r.status, 200);
  assert.equal(doCanal(r, id).clipandoEstaLive, false);
  assert.ok(!(await gravados()).includes(id));
});

test('o pedido de uma pessoa nao faz o canal gravar pra outra que tambem acompanha', async () => {
  const a = await logado();
  const b = await logado();
  const id = await canalSeguido(a.u.id, { aoVivo: true, pausado: true });
  await livesRepository.follow(b.u.id, id);
  await livesRepository.setPaused(b.u.id, id, true);
  await a.agent.post(`/api/client/lives/canais/${id}/clipar-esta-live`);
  const quem = (await livesRepository.followersWithQuality(id)).map((f) => f.user_id);
  assert.deepEqual(quem, [Number(a.u.id)]);
  assert.equal(doCanal(await b.agent.get('/api/client/lives'), id).recebendoCortes, false);
});

test('canal de outra pessoa: 404 em tudo', async () => {
  const dono = await logado();
  const outro = await logado();
  const id = await canalSeguido(dono.u.id, { aoVivo: true, pausado: true });
  assert.equal((await outro.agent.put(`/api/client/lives/canais/${id}/automatico`, { ligado: true })).status, 404);
  assert.equal((await outro.agent.post(`/api/client/lives/canais/${id}/clipar-esta-live`)).status, 404);
  assert.equal((await outro.agent.delete(`/api/client/lives/canais/${id}/clipar-esta-live`)).status, 404);
  assert.equal((await outro.agent.delete(`/api/client/lives/canais/${id}`)).status, 404);
  assert.ok(!(await gravados()).includes(id));
});

test('adicionar ja escolhe o automatico: desligado entra sem gravar', async () => {
  const { agent } = await logado();
  const slug = `t${Date.now().toString(36)}`;
  const original = { buscarUsuario: kickApi.buscarUsuario, buscarAoVivo: kickApi.buscarAoVivo };
  kickApi.buscarUsuario = async (l) => (l === slug ? { id: '77', login: slug, nome: 'Canal Novo', imagem: null } : null);
  kickApi.buscarAoVivo = async (logins) => ({ aoVivo: new Map(logins.map((l) => [l, { titulo: 'x', jogo: 'y', espectadores: 5 }])), falharam: new Set() });
  try {
    const r = await agent.post('/api/client/lives/canais', { canal: `kick.com/${slug}`, autoClipar: false });
    assert.equal(r.status, 200);
    const canal = r.body.canais.find((c) => c.login === slug);
    assert.equal(canal.aoVivo, true);
    assert.equal(canal.autoClipar, false);
    assert.ok(!(await gravados()).includes(canal.id));
  } finally {
    Object.assign(kickApi, original);
  }
});

// "Clipar este momento" mostra, no relogio da live, qual trecho vira corte
// (pedido de 08/10/2026). Pra isso o sistema guarda quando a live comecou na
// plataforma - a Twitch e a Kick informam, e antes isso era jogado fora.
test('inicio da live na plataforma: guardado enquanto ela dura, apagado quando acaba, e a tela recebe a janela do clipar agora', async () => {
  const { u, agent } = await logado();
  const id = await canalSeguido(u.id, { aoVivo: true });
  const inicio = new Date(Date.now() - 2 * 3600 * 1000);
  await livesRepository.updateChannelStatus(id, { isLive: true, iniciouEm: inicio.toISOString() });
  // Uma consulta que nao trouxe o horario nao apaga o que ja se sabia.
  await livesRepository.updateChannelStatus(id, { isLive: true });
  await pool.query("UPDATE live_channels SET last_checked_at = now() + interval '1 hour' WHERE id = $1", [id]);
  let r = await agent.get('/api/client/lives');
  assert.equal(doCanal(r, id).aoVivoDesde, inicio.toISOString());
  assert.equal(r.body.janelaCliparAgoraS, 150, 'o mesmo trecho que o servidor corta (JANELA_CLIPAR_AGORA_S)');

  await livesRepository.updateChannelStatus(id, { isLive: false });
  await pool.query("UPDATE live_channels SET last_checked_at = now() + interval '1 hour' WHERE id = $1", [id]);
  r = await agent.get('/api/client/lives');
  assert.equal(doCanal(r, id).aoVivoDesde, null, 'a proxima live nao pode herdar o relogio desta');
  const { rows } = await pool.query('SELECT live_started_at FROM live_channels WHERE id = $1', [id]);
  assert.equal(rows[0].live_started_at, null);
});
