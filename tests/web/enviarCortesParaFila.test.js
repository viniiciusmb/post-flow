// Os botões "enviar cortes pra fila de postagem" da tela de Cortes.
//
// O corte só entra em fila sozinho no instante em que termina de renderizar.
// Quem conecta (ou vincula) a conta do TikTok depois disso ficava com os cortes
// prontos e invisíveis: a fila mostrava zero, os cortes estavam lá, e nada na
// tela ligava as duas coisas. Aconteceu com o primeiro cliente pagante
// (13/09/2026), que perdeu 7 cortes dessa forma.
//
// O que estes testes travam:
//   - o corte vai para a conta DAQUELE vídeo (a mesma para onde o pipeline
//     mandaria), nunca para uma conta qualquer do cliente;
//   - sem conta vinculada o pedido é recusado com explicação, em vez de dizer
//     "pronto" sem ter feito nada;
//   - clicar duas vezes não duplica;
//   - só corte pronto e com arquivo de verdade entra;
//   - vídeo/corte de outro cliente é 404.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const fs = require('fs');
const os = require('os');
const path = require('path');
const pool = require('../../src/db/pool');
const { startServer, stopServer, createLoginableClient, createAgent } = require('../helpers/http');

test.after(async () => {
  await stopServer();
  await pool.end();
});

let seq = 0;
const unico = () => `${Date.now()}${seq++}`;

function arquivoDeCorte() {
  const caminho = path.join(os.tmpdir(), `corte-fila-${unico()}.mp4`);
  fs.writeFileSync(caminho, Buffer.alloc(2048, 1));
  return caminho;
}

async function contaTiktok(clienteId, nome = 'conta') {
  const { rows } = await pool.query(
    `INSERT INTO tiktok_accounts (client_user_id, tiktok_open_id, display_name, is_active,
       access_token_encrypted, access_token_iv, refresh_token_encrypted, refresh_token_iv,
       scopes, token_expires_at, connected_at, auto_post_enabled)
     VALUES ($1, $2, $3, true, 'x','x','x','x', ARRAY['video.publish'],
       now() + interval '30 days', now(), true)
     RETURNING *`,
    [clienteId, `open-${unico()}`, nome]
  );
  return rows[0];
}

// Vídeo de canal com N cortes prontos e NENHUMA postagem - o estado exato em
// que o cliente encontrou os dele.
async function videoDeCanalComCortes(clienteId, { contaId = null, quantos = 3 } = {}) {
  const { rows: [canal] } = await pool.query(
    `INSERT INTO youtube_channels (client_user_id, youtube_channel_id, channel_url, channel_name, tiktok_account_id)
     VALUES ($1, $2, 'https://youtube.com/@x', 'canal', $3) RETURNING *`,
    [clienteId, `UC${unico()}`, contaId]
  );
  const { rows: [video] } = await pool.query(
    `INSERT INTO source_videos (youtube_video_id, title, status, input_type, youtube_channel_id, owner_client_user_id)
     VALUES ($1, 'video', 'ready', 'channel', $2, $3) RETURNING *`,
    [`v${unico()}`, canal.id, clienteId]
  );
  const cortes = [];
  for (let i = 0; i < quantos; i++) {
    const { rows: [clip] } = await pool.query(
      `INSERT INTO clips (source_video_id, start_seconds, end_seconds, status, title, description, local_clip_path)
       VALUES ($1, 0, 30, 'ready', 'corte', 'legenda', $2) RETURNING *`,
      [video.id, arquivoDeCorte()]
    );
    cortes.push(clip);
  }
  return { canal, video, cortes };
}

async function filaDa(contaId) {
  const { rows } = await pool.query(
    'SELECT p.*, v.clip_id FROM postings p JOIN videos v ON v.id = p.video_id WHERE p.tiktok_account_id = $1 ORDER BY p.id',
    [contaId]
  );
  return rows;
}

async function clienteLogado() {
  const url = await startServer();
  const user = await createLoginableClient();
  const agente = createAgent(url);
  await agente.login(user.email, user.password);
  return { user, agente };
}

test('o botão do vídeo manda todos os cortes prontos pra fila', async () => {
  const { user, agente } = await clienteLogado();
  const conta = await contaTiktok(user.id);
  const { video, cortes } = await videoDeCanalComCortes(user.id, { contaId: conta.id, quantos: 3 });

  const r = await agente.post(`/api/client/source-videos/${video.id}/enqueue-clips`, {});

  assert.equal(r.status, 200);
  assert.equal(r.body.enfileirados, 3);
  const fila = await filaDa(conta.id);
  assert.deepEqual(
    fila.map((p) => Number(p.clip_id)).sort((a, b) => a - b),
    cortes.map((c) => Number(c.id)).sort((a, b) => a - b)
  );
  assert.ok(fila.every((p) => p.status === 'pending'));
});

test('o corte vai pra conta DAQUELE vídeo, não pra outra conta do cliente', async () => {
  // Publicar no perfil errado não tem desfazer: o vídeo já saiu.
  const { user, agente } = await clienteLogado();
  const contaCerta = await contaTiktok(user.id, 'a certa');
  const contaOutra = await contaTiktok(user.id, 'a outra');
  const { video } = await videoDeCanalComCortes(user.id, { contaId: contaCerta.id, quantos: 2 });

  await agente.post(`/api/client/source-videos/${video.id}/enqueue-clips`, {});

  assert.equal((await filaDa(contaCerta.id)).length, 2);
  assert.equal((await filaDa(contaOutra.id)).length, 0);
});

test('sem conta vinculada o pedido é recusado com explicação', async () => {
  // Dizer "pronto" sem ter feito nada seria pior: o cliente ficaria esperando
  // uma publicação que nunca vem.
  const { user, agente } = await clienteLogado();
  const { video } = await videoDeCanalComCortes(user.id, { contaId: null, quantos: 2 });

  const r = await agente.post(`/api/client/source-videos/${video.id}/enqueue-clips`, {});

  assert.equal(r.status, 400);
  assert.ok(r.body.error && r.body.error.length > 0);
});

test('clicar duas vezes não duplica', async () => {
  const { user, agente } = await clienteLogado();
  const conta = await contaTiktok(user.id);
  const { video } = await videoDeCanalComCortes(user.id, { contaId: conta.id, quantos: 2 });

  await agente.post(`/api/client/source-videos/${video.id}/enqueue-clips`, {});
  const segundo = await agente.post(`/api/client/source-videos/${video.id}/enqueue-clips`, {});

  assert.equal(segundo.body.enfileirados, 0);
  assert.equal((await filaDa(conta.id)).length, 2);
});

test('corte sem arquivo em disco fica de fora', async () => {
  // Caminho gravado no banco não é o mesmo que arquivo existindo: a retenção
  // apaga o arquivo sem limpar a coluna. Enfileirar um desses só encheria a
  // fila com algo que falha na publicação.
  const { user, agente } = await clienteLogado();
  const conta = await contaTiktok(user.id);
  const { video, cortes } = await videoDeCanalComCortes(user.id, { contaId: conta.id, quantos: 2 });
  fs.unlinkSync(cortes[0].local_clip_path);

  const r = await agente.post(`/api/client/source-videos/${video.id}/enqueue-clips`, {});

  assert.equal(r.body.enfileirados, 1);
  assert.equal(r.body.ignorados, 1);
});

test('o botão de UM corte manda só ele', async () => {
  // É o botão que aparece nos cortes que ficaram de fora quando os irmãos já
  // foram pra fila.
  const { user, agente } = await clienteLogado();
  const conta = await contaTiktok(user.id);
  const { cortes } = await videoDeCanalComCortes(user.id, { contaId: conta.id, quantos: 3 });

  const r = await agente.post(`/api/client/source-videos/clips/${cortes[1].id}/enqueue`, {});

  assert.equal(r.status, 200);
  assert.equal(r.body.enfileirados, 1);
  const fila = await filaDa(conta.id);
  assert.equal(fila.length, 1);
  assert.equal(Number(fila[0].clip_id), Number(cortes[1].id));
});

test('a lista de cortes diz em que pé de publicação cada um está', async () => {
  // É por este campo que a tela decide o que oferecer. Sem ele, o botão de
  // enviar apareceria em cima de um corte já publicado.
  const { user, agente } = await clienteLogado();
  const conta = await contaTiktok(user.id);
  const { video, cortes } = await videoDeCanalComCortes(user.id, { contaId: conta.id, quantos: 3 });

  await agente.post(`/api/client/source-videos/clips/${cortes[0].id}/enqueue`, {});
  await pool.query(
    `UPDATE postings SET status = 'posted' WHERE video_id IN (SELECT id FROM videos WHERE clip_id = $1)`,
    [cortes[0].id]
  );

  const r = await agente.get(`/api/client/source-videos/${video.id}/clips`);

  assert.equal(r.body.temDestinoDePostagem, true);
  // O id vem como STRING (BIGINT do Postgres) - a mesma armadilha que já
  // apareceu várias vezes neste projeto. Comparar sem converter faria o teste
  // passar por engano (não acharia nada e o undefined estouraria só depois).
  const porId = new Map(r.body.clips.map((c) => [Number(c.id), c]));
  assert.equal(porId.get(Number(cortes[0].id)).postingStatus, 'posted');
  assert.equal(porId.get(Number(cortes[1].id)).postingStatus, null);
  assert.equal(porId.get(Number(cortes[2].id)).postingStatus, null);
});

test('vídeo de outro cliente é 404', async () => {
  const { agente } = await clienteLogado();
  const outro = await createLoginableClient();
  const contaAlheia = await contaTiktok(outro.id);
  const { video, cortes } = await videoDeCanalComCortes(outro.id, { contaId: contaAlheia.id, quantos: 1 });

  const r1 = await agente.post(`/api/client/source-videos/${video.id}/enqueue-clips`, {});
  const r2 = await agente.post(`/api/client/source-videos/clips/${cortes[0].id}/enqueue`, {});

  assert.equal(r1.status, 404);
  assert.equal(r2.status, 404);
  assert.equal((await filaDa(contaAlheia.id)).length, 0);
});
