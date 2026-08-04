// Publicação direta no TikTok: o padrão é da CONTA, a exceção é do corte.
//
// A primeira versão exigia confirmar corte a corte. Cumpria a regra da TikTok,
// mas acabava com a razão de existir do produto - o sistema roda sozinho. A
// regra de verdade é mais estreita do que parecia: o proibido é publicar com
// uma configuração que o criador nunca viu, não publicar sem ele reconfirmar
// toda vez.
//
// Então são duas camadas, e estes testes travam as duas:
//   1. o padrão da conta, escolhido uma vez - sem ele, NADA é publicado;
//   2. as opções de um corte específico, que ganham do padrão quando existem.
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
  assert.match(pagina, /DirectPostOptions,/, 'DirectPostOptions voltou a ser código morto');
  assert.match(pagina, /<DirectPostOptions/, 'o componente é importado mas nunca renderizado');
  assert.match(pagina, /<PublishDefaultsForm/, 'o padrão da conta não é editável em lugar nenhum');
});

// --- O servidor não confia na tela ---

// Um unico cliente logado serve pra quase todos os testes: o limitador de
// login e por IP quando nao ha sessao, e criar um cliente novo a cada teste
// estourava o limite (e o teste falhava por 429, nao pelo que ele mede).
let clientePadrao = null;
let agentePadrao = null;

async function agenteCompartilhado() {
  if (!agentePadrao) {
    clientePadrao = await createLoginableClient({ role: 'client' });
    agentePadrao = createAgent(baseUrl);
    await agentePadrao.login(clientePadrao.email, clientePadrao.password);
  }
  return { cliente: clientePadrao, agente: agentePadrao };
}

async function contaComCorteNaFila({ publishMode, padrao, clienteProprio = false }) {
  let cliente;
  let agente;
  if (clienteProprio) {
    cliente = await createLoginableClient({ role: 'client' });
    agente = createAgent(baseUrl);
    await agente.login(cliente.email, cliente.password);
  } else {
    ({ cliente, agente } = await agenteCompartilhado());
  }

  const { rows: [conta] } = await pool.query(
    `INSERT INTO tiktok_accounts (client_user_id, tiktok_open_id, display_name, is_active,
       access_token_encrypted, access_token_iv, refresh_token_encrypted, refresh_token_iv,
       scopes, token_expires_at, publish_mode, connected_at)
     VALUES ($1, $2, 'conta de teste', true, 'x','x','x','x',
       ARRAY['video.publish'], now() + interval '30 days', $3, now())
     RETURNING id`,
    [cliente.id, `open-${Date.now()}-${Math.random()}`, publishMode]
  );

  if (padrao) {
    await pool.query(
      `UPDATE tiktok_accounts
          SET default_privacy_level = $2, publish_options_set_at = now()
        WHERE id = $1`,
      [conta.id, padrao]
    );
  }

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

  return { agente, contaId: Number(conta.id), postagemId: Number(postagem.id) };
}

// --- Camada 1: o padrão da conta ---

test('sem padrão definido, nenhum corte é publicável', async () => {
  const { agente, contaId, postagemId } = await contaComCorteNaFila({ publishMode: 'direct' });

  const padrao = await agente.get(`/api/client/tiktok-accounts/${contaId}/publish-defaults`);
  assert.equal(padrao.body.definido, false);
  assert.equal(padrao.body.privacyLevel, null, 'veio privacidade pré-selecionada');

  const fila = await agente.get('/api/client/postings/queue');
  assert.equal(fila.body.postings.find((i) => Number(i.id) === postagemId).optionsCustom, false);
});

test('o padrão da conta é salvo e passa a valer', async () => {
  const { agente, contaId } = await contaComCorteNaFila({ publishMode: 'direct' });

  const r = await agente.put(`/api/client/tiktok-accounts/${contaId}/publish-defaults`, {
    privacyLevel: 'FOLLOWER_OF_CREATOR',
    disableComment: true,
  });

  assert.equal(r.status, 200);
  assert.equal(r.body.definido, true);
  assert.equal(r.body.privacyLevel, 'FOLLOWER_OF_CREATOR');
  assert.equal(r.body.disableComment, true);
});

test('padrão sem privacidade é recusado', async () => {
  const { agente, contaId } = await contaComCorteNaFila({ publishMode: 'direct' });

  const r = await agente.put(`/api/client/tiktok-accounts/${contaId}/publish-defaults`, {
    disableComment: true,
  });

  assert.equal(r.status, 400);
  assert.match(r.body.error, /Escolha quem pode ver/);
});

test('padrão com parceria paga não pode ser privado', async () => {
  const { agente, contaId } = await contaComCorteNaFila({ publishMode: 'direct' });

  const r = await agente.put(`/api/client/tiktok-accounts/${contaId}/publish-defaults`, {
    privacyLevel: 'SELF_ONLY',
    brandContentToggle: true,
  });

  assert.equal(r.status, 400);
  assert.match(r.body.error, /parceria paga/i);
});

test('o padrão de uma conta não é alterável por outro cliente', async () => {
  const alvo = await contaComCorteNaFila({ publishMode: 'direct' });
  const intruso = await contaComCorteNaFila({ publishMode: 'direct', clienteProprio: true });

  const r = await intruso.agente.put(`/api/client/tiktok-accounts/${alvo.contaId}/publish-defaults`, {
    privacyLevel: 'PUBLIC_TO_EVERYONE',
  });

  assert.equal(r.status, 404);
});

// --- Camada 2: a exceção de um corte ---

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

test('opções do corte ganham do padrão da conta', async () => {
  const { agente, postagemId } = await contaComCorteNaFila({
    publishMode: 'direct',
    padrao: 'FOLLOWER_OF_CREATOR',
  });

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

test('a fila diz quais cortes têm opções próprias', async () => {
  // É esse campo que a tela usa pra mostrar o selo "opções próprias" e oferecer
  // o botão de voltar ao padrão.
  const { agente, postagemId } = await contaComCorteNaFila({
    publishMode: 'direct',
    padrao: 'FOLLOWER_OF_CREATOR',
  });

  // id vem como string do Postgres (BIGINT) - comparar direto nunca bate.
  const achar = (r) => r.body.postings.find((i) => Number(i.id) === postagemId);

  assert.equal(achar(await agente.get('/api/client/postings/queue')).optionsCustom, false);

  await agente.put(`/api/client/postings/${postagemId}/options`, { privacyLevel: 'PUBLIC_TO_EVERYONE' });
  assert.equal(achar(await agente.get('/api/client/postings/queue')).optionsCustom, true);

  // E voltar ao padrão desfaz a exceção.
  const volta = await agente.delete(`/api/client/postings/${postagemId}/options`);
  assert.equal(volta.status, 200);

  const depois = achar(await agente.get('/api/client/postings/queue'));
  assert.equal(depois.optionsCustom, false);
  assert.equal(depois.privacyLevel, null, 'sobrou lixo da escolha desfeita');
});

test('a fila de outro cliente não é acessível', async () => {
  const alvo = await contaComCorteNaFila({ publishMode: 'direct' });
  const intruso = await contaComCorteNaFila({ publishMode: 'direct', clienteProprio: true });

  const r = await intruso.agente.put(`/api/client/postings/${alvo.postagemId}/options`, {
    privacyLevel: 'PUBLIC_TO_EVERYONE',
  });

  assert.equal(r.status, 404);
});

// --- Quem ganha: o resolvedor que o job de publicação usa ---
//
// Esta é a regra de negócio inteira em quatro casos. Testar aqui é barato e
// pega o que a tela sozinha não pegaria.

const publishOptions = require('../../src/lib/publishOptions');

const CONTA_COM_PADRAO = {
  publish_options_set_at: new Date(),
  default_privacy_level: 'FOLLOWER_OF_CREATOR',
  default_disable_comment: true,
  default_disable_duet: false,
  default_disable_stitch: false,
  default_brand_organic_toggle: false,
  default_brand_content_toggle: false,
};

test('sem padrão e sem opções próprias, não há o que publicar', () => {
  // Devolver null é o que faz o job PULAR em vez de inventar um padrão.
  assert.equal(publishOptions.resolveForPosting({}, {}), null);
});

test('sem opções próprias, o corte segue o padrão da conta', () => {
  const r = publishOptions.resolveForPosting(CONTA_COM_PADRAO, { options_confirmed_at: null });
  assert.equal(r.origem, 'conta');
  assert.equal(r.privacyLevel, 'FOLLOWER_OF_CREATOR');
  assert.equal(r.disableComment, true);
});

test('opções próprias do corte ganham do padrão', () => {
  const r = publishOptions.resolveForPosting(CONTA_COM_PADRAO, {
    options_confirmed_at: new Date(),
    privacy_level: 'SELF_ONLY',
    disable_comment: false,
  });
  assert.equal(r.origem, 'corte');
  assert.equal(r.privacyLevel, 'SELF_ONLY');
  assert.equal(r.disableComment, false, 'o padrão da conta vazou pra cima da escolha do corte');
});

test('padrão pela metade não conta como padrão', () => {
  // Uma conta com publish_options_set_at mas sem privacidade seria um estado
  // impossível pela tela; se acontecer, publicar seria pior que esperar.
  assert.equal(
    publishOptions.resolveForPosting({ publish_options_set_at: new Date(), default_privacy_level: null }, {}),
    null
  );
});
