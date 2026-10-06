// Rotas do suporte com IA, de ponta a ponta pelo HTTP: quem pode chamar, e o
// que cada um consegue ver.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const pool = require('../../src/db/pool');
const suporteService = require('../../src/services/suporte/suporteService');
const { startServer, stopServer, createLoginableClient, createAgent } = require('../helpers/http');

let url;

test.before(async () => {
  url = await startServer();
  suporteService._definirClienteParaTeste({
    beta: { messages: { create: async () => ({ content: [{ type: 'text', text: 'Oi, posso ajudar.' }], stop_reason: 'end_turn', usage: {} }) } },
  });
});
test.after(async () => {
  await stopServer();
  await pool.end();
});

async function logado(role = 'client') {
  const user = await createLoginableClient({ role });
  const agent = createAgent(url);
  await agent.login(user.email, user.password);
  return { user, agent };
}

test('sem login nao conversa', async () => {
  const agent = createAgent(url);
  await agent.get('/');
  const r = await agent.post('/api/client/support/messages', { message: 'oi' });
  assert.equal(r.status, 401);
});

test('sem o token de CSRF a mensagem e recusada', async () => {
  const { agent } = await logado('admin');
  const r = await agent.postSemCsrf('/api/client/support/messages', { message: 'oi' });
  assert.equal(r.status, 403);
});

// Flora em teste: so o admin conversa (06/10/2026). Quando abrir para os
// clientes, este teste muda junto com as rotas.
test('enquanto esta em teste, cliente nao abre a Flora - nem a pagina nem a API', async () => {
  const { agent } = await logado();
  assert.equal((await agent.post('/api/client/support/messages', { message: 'oi' })).status, 403);
  assert.equal((await agent.get('/api/client/support')).status, 403);
  assert.notEqual((await agent.get('/client/support')).status, 200);
});

test('admin conversa e ve a propria conversa; outro admin nao ve', async () => {
  const { agent } = await logado('admin');
  const r = await agent.post('/api/client/support/messages', { message: 'meu video nao cortou' });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.resposta, 'Oi, posso ajudar.');

  const minha = await agent.get('/api/client/support');
  assert.deepEqual(minha.body.conversation.mensagens.map((m) => m.autor), ['cliente', 'suporte']);

  const { agent: outro } = await logado('admin');
  const alheia = await outro.get(`/api/client/support?conversationId=${r.body.conversationId}`);
  assert.equal(alheia.body.conversation, null);
  const continuar = await outro.post('/api/client/support/messages', { conversationId: r.body.conversationId, message: 'oi' });
  assert.equal(continuar.status, 404);
});

test('cliente nao acessa a lista de conversas do admin; o admin acessa', async () => {
  const { agent } = await logado();
  assert.equal((await agent.get('/api/admin/support')).status, 403);

  const { agent: admin } = await logado('admin');
  const r = await admin.get('/api/admin/support');
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.body.conversations));
});

test('com Accept text/event-stream a resposta chega em etapas e termina com a resposta', async () => {
  const { agent } = await logado('admin');
  const r = await agent.postCom('/api/client/support/messages', { message: 'oi' }, { accept: 'text/event-stream' });

  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /text\/event-stream/);
  const eventos = r.text.split('\n\n').filter(Boolean).map((b) => JSON.parse(b.replace(/^data: /, '')));
  assert.equal(eventos[0].etapa, 'pensando');
  assert.equal(eventos.at(-1).etapa, 'fim');
  assert.equal(eventos.at(-1).resposta, 'Oi, posso ajudar.');
});

test('erro de validacao continua saindo como JSON com status, mesmo pedindo etapas', async () => {
  const { agent } = await logado('admin');
  const r = await agent.postCom('/api/client/support/messages', { message: '   ' }, { accept: 'text/event-stream' });
  assert.equal(r.status, 400);
  assert.ok(r.body.error);
});
