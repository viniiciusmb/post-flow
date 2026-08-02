// Ordem da tela "Cortes".
//
// Antes era só created_at DESC, então o vídeo que estava SENDO PROCESSADO
// aparecia no fim da lista se tivesse sido detectado antes dos outros. Ou
// seja: justamente o único item que se mexe sozinho na tela ficava escondido
// embaixo de tudo, e a pessoa precisava rolar pra achar.
'use strict';

const test = require('node:test');
const assert = require('node:assert');

const repo = require('../../src/repositories/sourceVideosRepository');
const { pool, createClient, closePool } = require('../helpers/db');

test.after(() => closePool());

// minutosAtras controla a data de criação: quanto maior, mais antigo.
async function criar(clientUserId, titulo, status, minutosAtras) {
  await pool.query(
    `INSERT INTO source_videos (title, status, input_type, client_user_id, owner_client_user_id, created_at)
     VALUES ($1, $2, 'manual', $3, $3, now() - ($4 || ' minutes')::interval)`,
    [titulo, status, clientUserId, String(minutosAtras)]
  );
}

test('o vídeo em processamento fica no topo, mesmo sendo o mais antigo', async () => {
  const cliente = await createClient();
  // O que está processando é o MAIS ANTIGO de todos: com a ordem anterior
  // (created_at DESC) ele cairia pro fim da lista.
  await criar(cliente.id, 'processando agora', 'cutting', 500);
  await criar(cliente.id, 'chegou depois', 'detected', 10);
  await criar(cliente.id, 'chegou por último', 'detected', 1);

  const lista = await repo.listForClient(cliente.id);
  assert.strictEqual(lista[0].title, 'processando agora');
});

test('a fila respeita a ordem de chegada: o mais antigo é o próximo a rodar', async () => {
  const cliente = await createClient();
  await criar(cliente.id, 'terceiro da fila', 'detected', 5);
  await criar(cliente.id, 'primeiro da fila', 'detected', 60);
  await criar(cliente.id, 'segundo da fila', 'detected', 30);

  const fila = (await repo.listForClient(cliente.id)).map((v) => v.title);
  assert.deepStrictEqual(fila, ['primeiro da fila', 'segundo da fila', 'terceiro da fila']);
});

test('a ordem dos grupos é: processando, fila, sem crédito, pausado, erro, pronto', async () => {
  const cliente = await createClient();
  // Criados fora de ordem de propósito, e todos com datas embaralhadas, pra
  // provar que quem manda é o ESTADO e não a data.
  await criar(cliente.id, 'pronto', 'ready', 1);
  await criar(cliente.id, 'com erro', 'error', 2);
  await criar(cliente.id, 'pausado', 'paused', 3);
  await criar(cliente.id, 'sem crédito', 'aguardando_creditos', 4);
  await criar(cliente.id, 'na fila', 'detected', 5);
  await criar(cliente.id, 'processando', 'transcribing', 6);

  const ordem = (await repo.listForClient(cliente.id)).map((v) => v.title);
  assert.deepStrictEqual(ordem, [
    'processando',
    'na fila',
    'sem crédito',
    'pausado',
    'com erro',
    'pronto',
  ]);
});

test('qualquer etapa de processamento conta como "em andamento"', async () => {
  // As quatro etapas ativas têm o mesmo peso: o que importa é que o vídeo está
  // andando, não em qual fase está.
  for (const etapa of ['downloading', 'transcribing', 'selecting_clips', 'cutting']) {
    const cliente = await createClient();
    await criar(cliente.id, 'pronto e recente', 'ready', 1);
    await criar(cliente.id, `andando: ${etapa}`, etapa, 999);

    const lista = await repo.listForClient(cliente.id);
    assert.strictEqual(lista[0].title, `andando: ${etapa}`, `${etapa} deveria vir primeiro`);
  }
});

test('entre vídeos já prontos, o mais recente vem primeiro', async () => {
  const cliente = await createClient();
  await criar(cliente.id, 'pronto antigo', 'ready', 500);
  await criar(cliente.id, 'pronto recente', 'ready', 5);

  const lista = (await repo.listForClient(cliente.id)).map((v) => v.title);
  assert.deepStrictEqual(lista, ['pronto recente', 'pronto antigo']);
});
