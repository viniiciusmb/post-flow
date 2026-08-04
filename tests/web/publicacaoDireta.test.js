// Publicação direta no TikTok: o corte não sai antes do criador decidir.
//
// A tela de opções (privacidade, interações, divulgação comercial) existia como
// componente havia dias, mas NUNCA tinha sido ligada na página - era código
// morto, e ninguém percebeu porque nenhum teste tocava nesse caminho. O usuário
// só descobriu ao procurar as opções na tela pra gravar o vídeo de aprovação.
//
// Estes testes travam as duas pontas:
//   1. o front realmente renderiza o componente (import presente na página);
//   2. o servidor recusa publicar sem as escolhas, mesmo chamando a API direto.
//
// A segunda parte é a que vale de verdade: a auditoria da Content Posting API
// reprova app que publica com valor padrão que o criador nunca viu.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const pool = require('../../src/db/pool');
const { startServer, stopServer, createLoginableClient, createAgent } = require('../helpers/http');

const RAIZ = path.join(__dirname, '..', '..');

let baseUrl;

test.before(async () => {
  baseUrl = await startServer();
});

test.after(async () => {
  await stopServer();
  await pool.end();
});

test('a tela de publicação importa o bloco de opções', () => {
  // Sem este import, o componente inteiro vira enfeite no repositório: compila,
  // passa no TypeScript, e não aparece pra ninguém.
  const pagina = fs.readFileSync(
    path.join(RAIZ, 'web-client/src/pages/TikTokAccountPage.tsx'),
    'utf8'
  );
  assert.match(pagina, /import \{ DirectPostOptions \}/, 'DirectPostOptions voltou a ser código morto');
  assert.match(pagina, /<DirectPostOptions/, 'o componente é importado mas nunca renderizado');
});

// --- O servidor não confia na tela ---

async function contaComCorteNaFila({ publishMode }) {
  const cliente = await createLoginableClient({ role: 'client' });

  const { rows: [conta] } = await pool.query(
    `INSERT INTO tiktok_accounts (client_user_id, tiktok_open_id, display_name, is_active,
       access_token_encrypted, access_token_iv, refresh_token_encrypted, refresh_token_iv,
       scopes, token_expires_at, publish_mode, connected_at)
     VALUES ($1, $2, 'conta de teste', true, 'x','x','x','x',
       ARRAY['video.publish'], now() + interval '30 days', $3, now())
     RETURNING id`,
    [cliente.id, `open-${Date.now()}-${Math.random()}`, publishMode]
  );

  const { rows: [video] } = await pool.query(
    `INSERT INTO source_videos (youtube_video_id, title, status, input_type, owner_client_user_id, client_user_id)
     VALUES ($1, 'video de teste', 'ready', 'upload', $2, $2) RETURNING id`,
    [`vid${Date.now()}${Math.floor(Math.random() * 1000)}`, cliente.id]
  );

  const { rows: [corte] } = await pool.query(
    `INSERT INTO clips (source_video_id, start_seconds, end_seconds, status, title)
     VALUES ($1, 0, 30, 'ready', 'corte de teste') RETURNING id`,
    [video.id]
  );

  // A fila aponta pra "videos" (o arquivo publicavel), que por sua vez aponta
  // pro corte. Postagem de corte do YouTube tem source_type 'youtube_clip'.
  const { rows: [arquivo] } = await pool.query(
    `INSERT INTO videos (filename, discovered_at, source_type, clip_id)
     VALUES ('corte.mp4', now(), 'youtube_clip', $1) RETURNING id`,
    [corte.id]
  );

  const { rows: [postagem] } = await pool.query(
    `INSERT INTO postings (video_id, tiktok_account_id, status, queued_at)
     VALUES ($1, $2, 'pending', now()) RETURNING id`,
    [arquivo.id, conta.id]
  );

  const agente = createAgent(baseUrl);
  await agente.login(cliente.email, cliente.password);
  return { agente, contaId: Number(conta.id), postagemId: Number(postagem.id) };
}

test('sem escolher a privacidade, salvar é recusado', async () => {
  const { agente, postagemId } = await contaComCorteNaFila({ publishMode: 'direct' });

  const r = await agente.put(`/api/client/postings/${postagemId}/options`, {
    disableComment: false,
    brandOrganicToggle: false,
  });

  assert.equal(r.status, 400);
  assert.match(r.body.error, /Escolha quem pode ver/);
});

test('parceria paga não pode ficar visível só pra quem publicou', async () => {
  // A tela já desabilita a opção, mas quem chamar a API direto tem que esbarrar
  // aqui também - é regra da TikTok, não preferência nossa.
  const { agente, postagemId } = await contaComCorteNaFila({ publishMode: 'direct' });

  const r = await agente.put(`/api/client/postings/${postagemId}/options`, {
    privacyLevel: 'SELF_ONLY',
    brandContentToggle: true,
  });

  assert.equal(r.status, 400);
  assert.match(r.body.error, /parceria paga/i);
});

test('depois de escolher, o corte fica marcado como confirmado', async () => {
  const { agente, postagemId } = await contaComCorteNaFila({ publishMode: 'direct' });

  const r = await agente.put(`/api/client/postings/${postagemId}/options`, {
    privacyLevel: 'PUBLIC_TO_EVERYONE',
    disableComment: true,
    brandOrganicToggle: true,
  });
  assert.equal(r.status, 200);

  const { rows } = await pool.query(
    'SELECT privacy_level, disable_comment, brand_organic_toggle, options_confirmed_at FROM postings WHERE id = $1',
    [postagemId]
  );
  assert.equal(rows[0].privacy_level, 'PUBLIC_TO_EVERYONE');
  assert.equal(rows[0].disable_comment, true);
  assert.equal(rows[0].brand_organic_toggle, true);
  assert.ok(rows[0].options_confirmed_at, 'a confirmação não foi registrada');
});

test('a fila conta pro cliente se o corte já está liberado', async () => {
  // É esse campo que a tela usa pra decidir entre "Definir opções" e "Opções
  // definidas", e pra bloquear o botão de postar.
  const { agente, postagemId } = await contaComCorteNaFila({ publishMode: 'direct' });

  // id vem como string do Postgres (BIGINT) - comparar direto nunca bate.
  const achar = (r) => r.body.postings.find((i) => Number(i.id) === postagemId);

  assert.equal(achar(await agente.get('/api/client/postings/queue')).optionsConfirmed, false);

  await agente.put(`/api/client/postings/${postagemId}/options`, { privacyLevel: 'PUBLIC_TO_EVERYONE' });

  assert.equal(achar(await agente.get('/api/client/postings/queue')).optionsConfirmed, true);
});

test('a fila de outro cliente não é acessível', async () => {
  const alvo = await contaComCorteNaFila({ publishMode: 'direct' });
  const intruso = await contaComCorteNaFila({ publishMode: 'direct' });

  const r = await intruso.agente.put(`/api/client/postings/${alvo.postagemId}/options`, {
    privacyLevel: 'PUBLIC_TO_EVERYONE',
  });

  assert.equal(r.status, 404);
});
