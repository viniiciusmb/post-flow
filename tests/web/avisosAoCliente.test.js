// Aviso em pop-up para um cliente especifico (migration 095).
//
// Trava: cada cliente ve so os proprios avisos; "Entendi" fecha de vez; e um
// cliente nao fecha (nem descobre) o aviso de outro trocando o numero na URL.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const pool = require('../../src/db/pool');
const { startServer, stopServer, createLoginableClient, createAgent } = require('../helpers/http');
const clientNoticesRepository = require('../../src/repositories/clientNoticesRepository');

let baseUrl;

test.before(async () => {
  baseUrl = await startServer();
});

test.after(async () => {
  await stopServer();
  await pool.end();
});

async function agenteLogado() {
  const cliente = await createLoginableClient();
  const agent = createAgent(baseUrl);
  await agent.login(cliente.email, cliente.password);
  return { cliente, agent };
}

test('o cliente ve o proprio aviso e, depois de "Entendi", nao ve mais', async () => {
  const { cliente, agent } = await agenteLogado();
  await clientNoticesRepository.create({ clientUserId: cliente.id, title: 'Titulo', body: 'Um.\n\nDois.' });

  const antes = await agent.get('/api/client/notices');
  assert.equal(antes.status, 200);
  assert.equal(antes.body.notices.length, 1);
  assert.equal(antes.body.notices[0].body, 'Um.\n\nDois.');

  const fechar = await agent.post(`/api/client/notices/${antes.body.notices[0].id}/dismiss`);
  assert.equal(fechar.status, 200);

  const depois = await agent.get('/api/client/notices');
  assert.equal(depois.body.notices.length, 0);
});

test('um cliente nao ve nem fecha o aviso de outro', async () => {
  const dono = await agenteLogado();
  const intruso = await agenteLogado();
  const aviso = await clientNoticesRepository.create({ clientUserId: dono.cliente.id, title: 'So meu', body: 'x' });

  const lista = await intruso.agent.get('/api/client/notices');
  assert.equal(lista.body.notices.length, 0);

  const fechar = await intruso.agent.post(`/api/client/notices/${aviso.id}/dismiss`);
  assert.equal(fechar.status, 404);

  const doDono = await dono.agent.get('/api/client/notices');
  assert.equal(doDono.body.notices.length, 1, 'continua aberto para o dono');
});
