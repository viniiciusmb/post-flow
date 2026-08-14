// Cortes prontos entram na fila da conta que acabou de ser conectada.
//
// O pipeline só cria a postagem no instante em que o corte termina de
// renderizar. Quem cadastra o canal, deixa cortar e só depois conecta o TikTok
// — que é a ordem natural de quem está começando — abria a fila e via uma tela
// vazia, sem nenhuma explicação.
//
// O que estes testes protegem, além de o recurso funcionar, são as três formas
// de ele estragar algo: duplicar corte que já está em fila, ressuscitar corte
// que a pessoa cancelou, e publicar sozinho um monte de vídeo antigo.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const fs = require('fs');
const os = require('os');
const path = require('path');
const pool = require('../../src/db/pool');

// O serviço só enfileira corte cujo arquivo existe DE VERDADE em disco (um
// caminho gravado no banco pode apontar pra arquivo que a retenção apagou, ou
// pra um arquivo de 0 byte de uma renderização interrompida). Então o teste
// precisa criar arquivo mesmo, senão testaria um cenário que nunca enfileira.
function arquivoDeCorte() {
  const caminho = path.join(os.tmpdir(), `corte-teste-${Date.now()}-${Math.random().toString(36).slice(2)}.mp4`);
  fs.writeFileSync(caminho, Buffer.alloc(2048, 1));
  return caminho;
}
const backfill = require('../../src/services/backfillPostingsService');
const { createClient } = require('../helpers/db');

test.after(async () => {
  await pool.end();
});

let seq = 0;
const unico = () => `${Date.now()}${seq++}`;

async function contaTiktok(clienteId, { autoPost = false } = {}) {
  const { rows } = await pool.query(
    `INSERT INTO tiktok_accounts (client_user_id, tiktok_open_id, display_name, is_active,
       access_token_encrypted, access_token_iv, refresh_token_encrypted, refresh_token_iv,
       scopes, token_expires_at, connected_at, auto_post_enabled)
     VALUES ($1, $2, 'conta', true, 'x','x','x','x', ARRAY['video.publish'],
       now() + interval '30 days', now(), $3)
     RETURNING *`,
    [clienteId, `open-${unico()}`, autoPost]
  );
  return rows[0];
}

// Corte pronto de um vídeo AVULSO: o dono fica em owner_client_user_id.
async function corteProntoAvulso(clienteId, { status = 'ready', comArquivo = true } = {}) {
  const { rows: [video] } = await pool.query(
    `INSERT INTO source_videos (youtube_video_id, title, status, input_type, owner_client_user_id, client_user_id)
     VALUES ($1, 'video', 'ready', 'upload', $2, $2) RETURNING *`,
    [`v${unico()}`, clienteId]
  );
  const { rows: [clip] } = await pool.query(
    `INSERT INTO clips (source_video_id, start_seconds, end_seconds, status, title, description, local_clip_path)
     VALUES ($1, 0, 30, $2, 'corte', 'legenda', $3) RETURNING *`,
    [video.id, status, comArquivo ? arquivoDeCorte() : null]
  );
  return clip;
}

// Corte pronto vindo de CANAL. Desde a migration 042 o dono fica gravado em
// owner_client_user_id também nesse caso; o que muda é client_user_id, que
// continua NULL. Vale testar os dois caminhos mesmo assim: é justamente onde a
// consulta erraria se alguém trocasse a coluna sem perceber a diferença.
async function corteProntoDeCanal(clienteId) {
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
  const { rows: [clip] } = await pool.query(
    `INSERT INTO clips (source_video_id, start_seconds, end_seconds, status, title, local_clip_path)
     VALUES ($1, 0, 30, 'ready', 'corte de canal', $2) RETURNING *`,
    [video.id, arquivoDeCorte()]
  );
  return clip;
}

async function filaDa(contaId) {
  const { rows } = await pool.query(
    'SELECT p.*, v.clip_id FROM postings p JOIN videos v ON v.id = p.video_id WHERE p.tiktok_account_id = $1',
    [contaId]
  );
  return rows;
}

test('corte que ficou pronto antes da conta existir entra na fila', async () => {
  const cliente = await createClient();
  const corte = await corteProntoAvulso(cliente.id);
  const conta = await contaTiktok(cliente.id);

  const n = await backfill.enfileirarCortesProntos({ clientUserId: cliente.id, tiktokAccountId: conta.id });

  assert.equal(n, 1);
  const fila = await filaDa(conta.id);
  assert.equal(fila.length, 1);
  assert.equal(Number(fila[0].clip_id), Number(corte.id));
  assert.equal(fila[0].status, 'pending');
});

test('pega tanto corte de vídeo avulso quanto de canal', async () => {
  const cliente = await createClient();
  await corteProntoAvulso(cliente.id);
  await corteProntoDeCanal(cliente.id);
  const conta = await contaTiktok(cliente.id);

  const n = await backfill.enfileirarCortesProntos({ clientUserId: cliente.id, tiktokAccountId: conta.id });
  assert.equal(n, 2, 'um dos dois caminhos de dono ficou de fora');
});

test('não mexe em corte que ainda não está pronto', async () => {
  const cliente = await createClient();
  await corteProntoAvulso(cliente.id, { status: 'rendering' });
  await corteProntoAvulso(cliente.id, { status: 'error' });
  const conta = await contaTiktok(cliente.id);

  assert.equal(await backfill.enfileirarCortesProntos({ clientUserId: cliente.id, tiktokAccountId: conta.id }), 0);
});

test('não mexe em corte sem arquivo no disco', async () => {
  // Enfileirar um corte cujo arquivo a retenção já apagou só encheria a fila de
  // postagem que vai falhar.
  const cliente = await createClient();
  await corteProntoAvulso(cliente.id, { comArquivo: false });
  const conta = await contaTiktok(cliente.id);

  assert.equal(await backfill.enfileirarCortesProntos({ clientUserId: cliente.id, tiktokAccountId: conta.id }), 0);
});

test('não duplica corte que já está na fila de outra conta', async () => {
  const cliente = await createClient();
  await corteProntoAvulso(cliente.id);
  const primeira = await contaTiktok(cliente.id);
  await backfill.enfileirarCortesProntos({ clientUserId: cliente.id, tiktokAccountId: primeira.id });

  const segunda = await contaTiktok(cliente.id);
  const n = await backfill.enfileirarCortesProntos({ clientUserId: cliente.id, tiktokAccountId: segunda.id });

  assert.equal(n, 0, 'o mesmo corte foi parar na fila de duas contas');
});

test('não ressuscita corte que já foi postado ou cancelado', async () => {
  const cliente = await createClient();
  await corteProntoAvulso(cliente.id);
  const conta = await contaTiktok(cliente.id);
  await backfill.enfileirarCortesProntos({ clientUserId: cliente.id, tiktokAccountId: conta.id });

  for (const status of ['posted', 'skipped']) {
    await pool.query('UPDATE postings SET status = $2 WHERE tiktok_account_id = $1', [conta.id, status]);
    const outra = await contaTiktok(cliente.id);
    const n = await backfill.enfileirarCortesProntos({ clientUserId: cliente.id, tiktokAccountId: outra.id });
    assert.equal(n, 0, `corte com status ${status} voltou pra fila`);
  }
});

test('rodar duas vezes na mesma conta não duplica', async () => {
  const cliente = await createClient();
  await corteProntoAvulso(cliente.id);
  const conta = await contaTiktok(cliente.id);

  await backfill.enfileirarCortesProntos({ clientUserId: cliente.id, tiktokAccountId: conta.id });
  const segundaVez = await backfill.enfileirarCortesProntos({ clientUserId: cliente.id, tiktokAccountId: conta.id });

  assert.equal(segundaVez, 0);
  assert.equal((await filaDa(conta.id)).length, 1);
});

test('não pega corte de outro cliente', async () => {
  const dono = await createClient();
  const outro = await createClient();
  await corteProntoAvulso(outro.id);
  const conta = await contaTiktok(dono.id);

  assert.equal(await backfill.enfileirarCortesProntos({ clientUserId: dono.id, tiktokAccountId: conta.id }), 0);
});

test('a fila enche mas NADA é publicado sozinho', async () => {
  // A conta nova nasce com postagem automática desligada. Enfileirar deixa os
  // cortes visíveis e publicáveis a um clique - não faz um monte de vídeo
  // antigo sair no perfil de alguém que só conectou a conta.
  const cliente = await createClient();
  await corteProntoAvulso(cliente.id);
  const conta = await contaTiktok(cliente.id);
  assert.equal(conta.auto_post_enabled, false, 'conta nova deixou de nascer com auto-post desligado');

  await backfill.enfileirarCortesProntos({ clientUserId: cliente.id, tiktokAccountId: conta.id });

  const { rows } = await pool.query(
    `SELECT count(*)::int AS n FROM postings p JOIN tiktok_accounts ta ON ta.id = p.tiktok_account_id
      WHERE p.tiktok_account_id = $1 AND ta.auto_post_enabled = true`,
    [conta.id]
  );
  assert.equal(rows[0].n, 0, 'a fila ficou pronta pra publicar sozinha');
});

test('falha no meio não derruba a conexão', async () => {
  // Conectar a conta é o que o cliente pediu; o preenchimento da fila é bônus.
  const n = await backfill.enfileirarCortesProntos({ clientUserId: 999999999, tiktokAccountId: 999999999 });
  assert.equal(n, 0);
});

test('corte marcado como pronto mas com arquivo VAZIO não entra na fila', async () => {
  // Renderização interrompida no meio deixa um arquivo de 0 byte, e a retenção
  // apaga o arquivo sem limpar a coluna: nos dois casos o corte parece pronto e
  // não é. Enfileirar um desses enche a fila com algo que abre a prévia vazia e
  // falha na publicação — aconteceu de verdade (2026-08-15), num corte que foi
  // parar na fila de uma demonstração.
  const cliente = await createClient();
  const conta = await contaTiktok(cliente.id);

  const bom = await corteProntoAvulso(cliente.id);
  const ruim = await corteProntoAvulso(cliente.id);
  // Zera o arquivo do segundo, mantendo o caminho no banco.
  const { rows: [linha] } = await pool.query('SELECT local_clip_path FROM clips WHERE id = $1', [ruim.id]);
  fs.writeFileSync(linha.local_clip_path, Buffer.alloc(0));

  await backfill.enfileirarCortesProntos({ clientUserId: cliente.id, tiktokAccountId: conta.id });

  const fila = await filaDa(conta.id);
  const idsNaFila = fila.map((p) => Number(p.clip_id));
  assert.ok(idsNaFila.includes(Number(bom.id)), 'o corte com arquivo tem que entrar');
  assert.ok(!idsNaFila.includes(Number(ruim.id)), 'o corte de arquivo vazio NÃO pode entrar na fila');
});
