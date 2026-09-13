// Vincular um canal a uma conta do TikTok traz para a fila os cortes desse
// canal que já estavam prontos.
//
// O buraco que isto fecha, encontrado num cliente pagante de verdade
// (13/09/2026): ele cadastrou o canal, mandou cortar, conectou a conta do
// TikTok 90 segundos depois e vinculou os dois em seguida. Os 7 cortes ficaram
// prontos e NUNCA entraram em fila nenhuma — a tela dizia "0 na fila" e não
// havia nada explicando por quê.
//
// Eram dois caminhos falhando juntos:
//   - o pipeline lê a conta de destino uma vez, e naquele instante o canal
//     ainda não tinha nenhuma (corrigido em processVideoJob, que agora relê a
//     cada corte);
//   - o backfill que existia só rodava ao CONECTAR a conta, e naquele momento
//     os cortes ainda estavam renderizando.
//
// O teste é por HTTP de propósito: o que precisa estar travado é que a ROTA de
// vincular faça isso. Chamar o serviço direto passaria mesmo com a chamada
// removida do controller.
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

// O serviço só enfileira corte cujo arquivo existe de verdade em disco — um
// caminho gravado no banco pode apontar para arquivo que a retenção apagou.
function arquivoDeCorte() {
  const caminho = path.join(os.tmpdir(), `corte-vinculo-${unico()}.mp4`);
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

async function canalComCortesProntos(clienteId, quantos = 2) {
  const { rows: [canal] } = await pool.query(
    `INSERT INTO youtube_channels (client_user_id, youtube_channel_id, channel_url, channel_name)
     VALUES ($1, $2, 'https://youtube.com/@x', 'canal') RETURNING *`,
    [clienteId, `UC${unico()}`]
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
  return { canal, cortes };
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

test('vincular o canal traz para a fila os cortes que já estavam prontos', async () => {
  const { user, agente } = await clienteLogado();
  const conta = await contaTiktok(user.id);
  const { canal, cortes } = await canalComCortesProntos(user.id, 3);

  const r = await agente.post(`/api/client/youtube-channels/${canal.id}/tiktok-account`, {
    tiktokAccountId: conta.id,
  });

  assert.equal(r.status, 200);
  assert.equal(r.body.enfileirados, 3);

  const fila = await filaDa(conta.id);
  assert.equal(fila.length, 3);
  assert.deepEqual(
    fila.map((p) => Number(p.clip_id)).sort((a, b) => a - b),
    cortes.map((c) => Number(c.id)).sort((a, b) => a - b)
  );
  // Entram como pendentes: o cliente VÊ os cortes na fila e o agendamento
  // decide quando sair. Nada é publicado por causa do vínculo.
  assert.ok(fila.every((p) => p.status === 'pending'));
});

test('NÃO arrasta os cortes de outro canal do mesmo cliente', async () => {
  // O estrago aqui não tem desfazer: o corte sai no perfil errado, e vídeo
  // publicado já foi. Por isso o escopo é o canal, e não o dono.
  const { user, agente } = await clienteLogado();
  const contaA = await contaTiktok(user.id, 'conta A');
  const contaB = await contaTiktok(user.id, 'conta B');
  const { canal: canalA } = await canalComCortesProntos(user.id, 2);
  const { canal: canalB, cortes: cortesB } = await canalComCortesProntos(user.id, 2);

  await agente.post(`/api/client/youtube-channels/${canalA.id}/tiktok-account`, { tiktokAccountId: contaA.id });
  await agente.post(`/api/client/youtube-channels/${canalB.id}/tiktok-account`, { tiktokAccountId: contaB.id });

  const filaB = await filaDa(contaB.id);
  assert.equal(filaB.length, 2, 'a conta B só pode receber os cortes do canal B');
  assert.deepEqual(
    filaB.map((p) => Number(p.clip_id)).sort((a, b) => a - b),
    cortesB.map((c) => Number(c.id)).sort((a, b) => a - b)
  );
  assert.equal((await filaDa(contaA.id)).length, 2);
});

test('vincular de novo não duplica o que já está na fila', async () => {
  const { user, agente } = await clienteLogado();
  const conta = await contaTiktok(user.id);
  const { canal } = await canalComCortesProntos(user.id, 2);

  await agente.post(`/api/client/youtube-channels/${canal.id}/tiktok-account`, { tiktokAccountId: conta.id });
  const segundo = await agente.post(`/api/client/youtube-channels/${canal.id}/tiktok-account`, {
    tiktokAccountId: conta.id,
  });

  assert.equal(segundo.body.enfileirados, 0);
  assert.equal((await filaDa(conta.id)).length, 2);
});

test('não ressuscita postagem que o cliente cancelou', async () => {
  // Cancelar é uma decisão deliberada. Trazer o corte de volta por causa de um
  // clique que não era sobre isso desfaria a escolha dele em silêncio.
  const { user, agente } = await clienteLogado();
  const conta = await contaTiktok(user.id);
  const { canal } = await canalComCortesProntos(user.id, 2);

  await agente.post(`/api/client/youtube-channels/${canal.id}/tiktok-account`, { tiktokAccountId: conta.id });
  await pool.query(`UPDATE postings SET status = 'skipped' WHERE tiktok_account_id = $1`, [conta.id]);

  await agente.post(`/api/client/youtube-channels/${canal.id}/tiktok-account`, { tiktokAccountId: null });
  const r = await agente.post(`/api/client/youtube-channels/${canal.id}/tiktok-account`, { tiktokAccountId: conta.id });

  assert.equal(r.body.enfileirados, 0);
  const fila = await filaDa(conta.id);
  assert.equal(fila.length, 2);
  assert.ok(fila.every((p) => p.status === 'skipped'));
});

test('canal de outro cliente não pode ser vinculado', async () => {
  const { user, agente } = await clienteLogado();
  const conta = await contaTiktok(user.id);

  const outro = await createLoginableClient();
  const { canal: canalAlheio } = await canalComCortesProntos(outro.id, 1);

  const r = await agente.post(`/api/client/youtube-channels/${canalAlheio.id}/tiktok-account`, {
    tiktokAccountId: conta.id,
  });

  assert.equal(r.status, 404);
  assert.equal((await filaDa(conta.id)).length, 0);
});

test('o corte só é OFERECIDO à conta a que ele pertence', async () => {
  // Visto na tela (13/09/2026): um cliente com 3 contas via o MESMO "7 cortes
  // prontos fora da fila" em TODOS os cartões, inclusive nos que não tinham
  // nada solto. Clicar no cartão errado publicaria os 7 no perfil errado - e
  // vídeo publicado não tem desfazer.
  const backfill = require('../../src/services/backfillPostingsService');
  const { user, agente } = await clienteLogado();
  const contaA = await contaTiktok(user.id, 'conta A');
  const contaB = await contaTiktok(user.id, 'conta B');

  const { canal: canalB } = await canalComCortesProntos(user.id, 4);
  await agente.post(`/api/client/youtube-channels/${canalB.id}/tiktok-account`, { tiktokAccountId: contaB.id });
  // Agora os 4 estão na fila da B. Deixa 2 deles órfãos de novo, como se o
  // vínculo tivesse acontecido depois de prontos.
  await pool.query(
    `DELETE FROM postings WHERE id IN (SELECT id FROM postings WHERE tiktok_account_id = $1 ORDER BY id LIMIT 2)`,
    [contaB.id]
  );

  const naA = await backfill.contarPendencias({ clientUserId: user.id, tiktokAccountId: contaA.id });
  const naB = await backfill.contarPendencias({ clientUserId: user.id, tiktokAccountId: contaB.id });

  assert.equal(naB.prontosForaDaFila, 2, 'a conta do canal é quem tem os cortes soltos');
  assert.equal(naA.prontosForaDaFila, 0, 'a outra conta não pode oferecer cortes que não são dela');

  // E o botão "Colocar na fila" da conta errada também não os leva.
  const r = await backfill.enfileirarCortesProntos({ clientUserId: user.id, tiktokAccountId: contaA.id });
  assert.equal(r.enfileirados, 0);
  assert.equal((await filaDa(contaA.id)).length, 0);
});

test('corte de canal ainda sem conta vinculada continua sendo oferecido a qualquer conta', async () => {
  // É o caso de quem cortou antes de conectar o TikTok - exatamente o que este
  // serviço existe para resolver. Estreitar demais o filtro esconderia o corte
  // de todo mundo e o recurso deixaria de funcionar.
  const backfill = require('../../src/services/backfillPostingsService');
  const { user } = await clienteLogado();
  const conta = await contaTiktok(user.id);
  await canalComCortesProntos(user.id, 2); // canal sem vínculo

  const contagem = await backfill.contarPendencias({ clientUserId: user.id, tiktokAccountId: conta.id });
  assert.equal(contagem.prontosForaDaFila, 2);
});
