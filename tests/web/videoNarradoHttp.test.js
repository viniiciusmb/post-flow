// O vídeo narrado está em MODO DE TESTE: só o admin pode ver e usar.
//
// "Só admin" é o requisito central desta etapa, e é o tipo de coisa que
// silenciosamente deixa de valer quando alguém move uma rota de lugar. Por
// isso ele é executado aqui como ataque de verdade, com um cliente logado
// batendo na rota — e não conferido por leitura de código.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const pool = require('../../src/db/pool');
const queueService = require('../../src/services/queueService');
const { startServer, stopServer, createLoginableClient, createAgent } = require('../helpers/http');

let url;

test.before(async () => {
  url = await startServer();
});

test.after(async () => {
  await stopServer();
  // Criar um vídeo enfileira de verdade, e o pg-boss abre conexões e um
  // agendador próprios que mantêm o processo vivo depois dos testes passarem.
  // Sem isto o ARQUIVO falha por timeout mesmo com todos os testes verdes.
  await queueService.stopBoss();
  await pool.end();
});

const ROTEIRO = 'Em outubro de 1347, doze navios genoveses atracaram no porto da Sicilia. '
  + 'A maior parte dos marinheiros a bordo estava morta. '
  + 'Em menos de cinco anos, a peste negra mataria um terco de toda a populacao da Europa.';

async function logarComo(role) {
  const user = await createLoginableClient({ role });
  const agente = createAgent(url);
  await agente.login(user.email, user.password);
  return { user, agente };
}

test('cliente comum NAO enxerga o recurso em teste', async () => {
  const { agente } = await logarComo('client');

  const lista = await agente.get('/api/admin/narrated');
  assert.equal(lista.status, 403, 'a lista vazou para um cliente');

  const criar = await agente.post('/api/admin/narrated', { title: 'Teste', script: ROTEIRO });
  assert.equal(criar.status, 403, 'um cliente conseguiu gastar dinheiro gerando video');
});

test('visitante sem sessao tambem nao entra', async () => {
  const anonimo = createAgent(url);
  const r = await anonimo.get('/api/admin/narrated');
  assert.ok([401, 403].includes(r.status), `esperava 401/403, veio ${r.status}`);
});

test('admin cria o video, ele aparece na lista e a resposta traz as opcoes', async () => {
  const { agente } = await logarComo('admin');

  const criado = await agente.post('/api/admin/narrated', {
    title: 'A Peste Negra',
    script: ROTEIRO,
    aspect: '16:9',
    imagePolicy: 'qualidade',
  });
  assert.equal(criado.status, 201, criado.text);
  assert.equal(criado.body.video.imagePolicy, 'qualidade');
  assert.equal(criado.body.video.status, 'na_fila');

  // As opções fixas vêm junto no POST, não só no GET: a tela reusa a resposta
  // para atualizar o estado inteiro, e um POST sem elas quebra a página no
  // save seguinte — defeito real já visto em /api/client/video-settings.
  assert.ok(Array.isArray(criado.body.options?.politicas), 'o POST tem que devolver as opcoes, igual o GET');

  const lista = await agente.get('/api/admin/narrated');
  assert.equal(lista.status, 200);
  assert.ok(lista.body.videos.some((v) => Number(v.id) === Number(criado.body.video.id)));
  assert.ok(Array.isArray(lista.body.options?.politicas));
});

test('roteiro vazio e roteiro gigante sao recusados AGORA, com o motivo escrito', async () => {
  const { agente } = await logarComo('admin');

  const vazio = await agente.post('/api/admin/narrated', { title: 'Sem roteiro', script: '   ' });
  assert.equal(vazio.status, 400);
  assert.match(vazio.body.error, /roteiro/i);

  // Recusar na hora, e não deixar falhar 10 minutos depois no meio da geração
  // — quando a narração já teria sido paga.
  const gigante = await agente.post('/api/admin/narrated', { title: 'Enorme', script: 'a. '.repeat(20_000) });
  assert.equal(gigante.status, 400);
  assert.match(gigante.body.error, /caracteres|menores/i);
});

test('a previa do roteiro nao cria nada - ela existe para ajustar ANTES de gastar', async () => {
  const { agente } = await logarComo('admin');

  const antes = await agente.get('/api/admin/narrated');
  const previa = await agente.post('/api/admin/narrated/preview', { script: ROTEIRO });

  assert.equal(previa.status, 200);
  assert.ok(previa.body.cenas >= 1, 'a previa precisa dizer quantas cenas vao sair');
  assert.ok(previa.body.segundosEstimados > 0);

  const depois = await agente.get('/api/admin/narrated');
  assert.equal(depois.body.videos.length, antes.body.videos.length, 'a previa cadastrou video');
});

test('um admin nao alcanca o video de outro admin (IDOR)', async () => {
  const dono = await logarComo('admin');
  const intruso = await logarComo('admin');

  const criado = await dono.agente.post('/api/admin/narrated', { title: 'Meu vídeo', script: ROTEIRO });
  assert.equal(criado.status, 201, criado.text);
  const id = Number(criado.body.video.id);

  assert.equal((await intruso.agente.get(`/api/admin/narrated/${id}`)).status, 404);
  assert.equal((await intruso.agente.get(`/api/admin/narrated/${id}/download`)).status, 404);
  assert.equal((await intruso.agente.delete(`/api/admin/narrated/${id}`)).status, 404);

  // E o dono continua com o vídeo dele depois da tentativa.
  assert.equal((await dono.agente.get(`/api/admin/narrated/${id}`)).status, 200);
});

test('baixar video que ainda nao ficou pronto devolve 404, nao um arquivo quebrado', async () => {
  const { agente } = await logarComo('admin');
  const criado = await agente.post('/api/admin/narrated', { title: 'Ainda gerando', script: ROTEIRO });

  const r = await agente.get(`/api/admin/narrated/${criado.body.video.id}/download`);
  assert.equal(r.status, 404);
});
