// Cortes prontos que ficaram FORA da fila de postagem.
//
// Relato do fundador (10/09/2026): mandou processar um vídeo novo, os cortes
// ficaram prontos e nenhum apareceu na fila daquela conta. Não havia como
// corrigir sem mexer no banco — e nem como saber que havia algo para corrigir.
//
// São DOIS casos diferentes, e é por isso que existem dois botões:
//   1. corte que nunca entrou em fila NENHUMA (ninguém decidiu deixá-lo fora);
//   2. postagem que o cliente CANCELOU (foi uma decisão dele).
// Trazer os dois de volta no mesmo clique desfaria um cancelamento deliberado.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const fs = require('fs');
const os = require('os');
const path = require('path');
const pool = require('../../src/db/pool');
const postingsRepository = require('../../src/repositories/postingsRepository');
const queueService = require('../../src/services/queueService');
const { createSourceVideo } = require('../helpers/db');
const { startServer, stopServer, createLoginableClient, createAgent } = require('../helpers/http');

let url;
const arquivos = [];

test.before(async () => {
  url = await startServer();
});
test.after(async () => {
  for (const a of arquivos) fs.rmSync(a, { force: true });
  await stopServer();
  await queueService.stopBoss();
  await pool.end();
});

// Arquivo de verdade em disco: o backfill confere o TAMANHO antes de
// enfileirar, porque render interrompido deixa arquivo de 0 byte e a retenção
// apaga o arquivo sem limpar a coluna - nos dois casos o corte "parece" pronto.
function arquivoDeCorte(bytes = 1024) {
  const caminho = path.join(os.tmpdir(), `corte-teste-${process.pid}-${Math.random().toString(36).slice(2)}.mp4`);
  fs.writeFileSync(caminho, Buffer.alloc(bytes));
  arquivos.push(caminho);
  return caminho;
}

async function contaTiktok(clientUserId, { autoPost = true } = {}) {
  const { rows } = await pool.query(
    `INSERT INTO tiktok_accounts (client_user_id, tiktok_open_id, display_name, access_token_encrypted,
                                  refresh_token_encrypted, token_expires_at, scopes, is_active, auto_post_enabled)
     VALUES ($1, $2, 'Conta de teste', 'x', 'y', now() + interval '1 day', '{}', true, $3)
     RETURNING *`,
    [clientUserId, `open_${process.pid}_${Math.random().toString(36).slice(2, 10)}`, autoPost]
  );
  return rows[0];
}

// Vídeo avulso (sem canal) de propósito: o backfill encontra o corte por
// owner_client_user_id, que é o dono real nos dois casos desde a migration 042.
// Forçar um canal num vídeo 'manual' viola a constraint de origem - e essa
// constraint está certa.
async function corteProntoSemFila(clientUserId, { bytes = 1024 } = {}) {
  const video = await createSourceVideo(clientUserId);
  const { rows } = await pool.query(
    `INSERT INTO clips (source_video_id, title, description, start_seconds, end_seconds, status, local_clip_path)
     VALUES ($1, 'Corte pronto', 'legenda', 0, 30, 'ready', $2) RETURNING *`,
    [video.id, arquivoDeCorte(bytes)]
  );
  return rows[0];
}

async function clienteLogado() {
  const user = await createLoginableClient();
  const agent = createAgent(url);
  await agent.login(user.email, user.password);
  return { user, agent };
}

test('a tela avisa quantos cortes prontos estao fora da fila', async () => {
  const { user, agent } = await clienteLogado();
  const conta = await contaTiktok(user.id);
  await corteProntoSemFila(user.id);
  await corteProntoSemFila(user.id);

  const r = await agent.get(`/api/client/postings/pendencias?accountId=${conta.id}`);

  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.prontosForaDaFila, 2, 'saber ANTES de clicar e o que faz o botao valer a pena');
  assert.equal(r.body.cancelados, 0);
});

test('o botao coloca na fila os cortes que nunca entraram', async () => {
  const { user, agent } = await clienteLogado();
  const conta = await contaTiktok(user.id);
  await corteProntoSemFila(user.id);
  await corteProntoSemFila(user.id);

  const r = await agent.post('/api/client/postings/enfileirar-prontos', { accountId: Number(conta.id) });

  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.enfileirados, 2);

  const fila = await postingsRepository.countByStatusForAccount(conta.id);
  assert.equal(fila.pending, 2);
});

test('corte cujo arquivo sumiu NAO entra na fila', async () => {
  // Enfileirar um corte sem arquivo só encheria a fila com algo que abre a
  // prévia vazia e falha na publicação (aconteceu de verdade em 15/08/2026).
  const { user, agent } = await clienteLogado();
  const conta = await contaTiktok(user.id);
  const bom = await corteProntoSemFila(user.id);
  const vazio = await corteProntoSemFila(user.id, { bytes: 0 });

  const r = await agent.post('/api/client/postings/enfileirar-prontos', { accountId: Number(conta.id) });

  assert.equal(r.body.enfileirados, 1);
  assert.equal(r.body.ignorados, 1);
  assert.ok(bom.id && vazio.id);
});

test('clicar duas vezes nao duplica postagem', async () => {
  const { user, agent } = await clienteLogado();
  const conta = await contaTiktok(user.id);
  await corteProntoSemFila(user.id);

  await agent.post('/api/client/postings/enfileirar-prontos', { accountId: Number(conta.id) });
  const segunda = await agent.post('/api/client/postings/enfileirar-prontos', { accountId: Number(conta.id) });

  assert.equal(segunda.body.enfileirados, 0, 'na segunda vez nao ha mais nada orfao');
  const fila = await postingsRepository.countByStatusForAccount(conta.id);
  assert.equal(fila.pending, 1);
});

test('postagem CANCELADA volta pra fila pelo botao proprio', async () => {
  const { user, agent } = await clienteLogado();
  const conta = await contaTiktok(user.id);
  await corteProntoSemFila(user.id);
  await agent.post('/api/client/postings/enfileirar-prontos', { accountId: Number(conta.id) });

  const fila = await agent.get(`/api/client/postings/queue?accountId=${conta.id}`);
  const postagem = fila.body.postings[0];
  await agent.post(`/api/client/postings/${postagem.id}/skip`, {});

  const antes = await agent.get(`/api/client/postings/pendencias?accountId=${conta.id}`);
  assert.equal(antes.body.cancelados, 1);
  assert.equal(antes.body.prontosForaDaFila, 0, 'ela JA entrou em fila uma vez - nao e orfa');

  const r = await agent.post('/api/client/postings/reenfileirar-cancelados', { accountId: Number(conta.id) });

  assert.equal(r.body.devolvidos, 1);
  const depois = await postingsRepository.findById(postagem.id);
  assert.equal(depois.status, 'pending');
  assert.ok(depois.scheduled_for, 'ganha horario novo - o antigo ja passou');
});

test('o botao de cortes prontos NAO ressuscita postagem cancelada', async () => {
  // Cancelar é uma decisão do cliente. Se "colocar os cortes prontos na fila"
  // trouxesse os cancelados junto, quem cancelou de propósito veria tudo voltar
  // por causa de um clique que não era sobre isso.
  const { user, agent } = await clienteLogado();
  const conta = await contaTiktok(user.id);
  await corteProntoSemFila(user.id);
  await agent.post('/api/client/postings/enfileirar-prontos', { accountId: Number(conta.id) });
  const fila = await agent.get(`/api/client/postings/queue?accountId=${conta.id}`);
  const postagem = fila.body.postings[0];
  await agent.post(`/api/client/postings/${postagem.id}/skip`, {});

  const r = await agent.post('/api/client/postings/enfileirar-prontos', { accountId: Number(conta.id) });

  assert.equal(r.body.enfileirados, 0);
  assert.equal((await postingsRepository.findById(postagem.id)).status, 'skipped');
});

test('postagem JA POSTADA nunca volta pra fila', async () => {
  const { user, agent } = await clienteLogado();
  const conta = await contaTiktok(user.id);
  await corteProntoSemFila(user.id);
  await agent.post('/api/client/postings/enfileirar-prontos', { accountId: Number(conta.id) });
  const fila = await agent.get(`/api/client/postings/queue?accountId=${conta.id}`);
  await pool.query("UPDATE postings SET status = 'posted' WHERE id = $1", [fila.body.postings[0].id]);

  const pend = await agent.get(`/api/client/postings/pendencias?accountId=${conta.id}`);
  assert.equal(pend.body.prontosForaDaFila, 0);
  assert.equal(pend.body.cancelados, 0);

  const r = await agent.post('/api/client/postings/reenfileirar-cancelados', { accountId: Number(conta.id) });
  assert.equal(r.body.devolvidos, 0);
});

test('conta de OUTRO cliente nunca e tocada', async () => {
  const { user } = await clienteLogado();
  const conta = await contaTiktok(user.id);
  const intruso = await clienteLogado();

  assert.equal((await intruso.agent.get(`/api/client/postings/pendencias?accountId=${conta.id}`)).status, 404);
  assert.equal(
    (await intruso.agent.post('/api/client/postings/enfileirar-prontos', { accountId: Number(conta.id) })).status,
    404
  );
  assert.equal(
    (await intruso.agent.post('/api/client/postings/reenfileirar-cancelados', { accountId: Number(conta.id) })).status,
    404
  );
});

test('cancelada cujo arquivo a retencao ja apagou NAO volta pra fila', async () => {
  // A retenção apaga o arquivo do corte 3 dias depois de postado, e uma
  // postagem cancelada antiga pode estar nessa situação. Devolvê-la encheria a
  // fila com algo que abre a prévia vazia e falha na publicação - o mesmo
  // motivo pelo qual o backfill confere o arquivo.
  const { user, agent } = await clienteLogado();
  const conta = await contaTiktok(user.id);
  const corte = await corteProntoSemFila(user.id);
  await agent.post('/api/client/postings/enfileirar-prontos', { accountId: Number(conta.id) });
  const fila = await agent.get(`/api/client/postings/queue?accountId=${conta.id}`);
  const postagem = fila.body.postings[0];
  await agent.post(`/api/client/postings/${postagem.id}/skip`, {});

  // O arquivo some (retenção), mas a coluna continua apontando pra ele.
  fs.rmSync(corte.local_clip_path, { force: true });

  const pend = await agent.get(`/api/client/postings/pendencias?accountId=${conta.id}`);
  const r = await agent.post('/api/client/postings/reenfileirar-cancelados', { accountId: Number(conta.id) });

  assert.equal(r.body.devolvidos, 0, 'sem arquivo, voltar pra fila so gera falha na publicacao');
  assert.equal(r.body.ignorados, 1);
  assert.equal((await postingsRepository.findById(postagem.id)).status, 'skipped');
  assert.ok(pend.body.cancelados >= 0);
});
