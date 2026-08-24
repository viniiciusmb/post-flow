// A lista de clientes do admin: plano, custo gerado e cortes postados, com
// filtro de período e ordenação.
//
// O risco desta tela é o custo aparecer INFLADO. Somar vídeos e postagens numa
// consulta só multiplica as linhas uma pela outra (fan-out): um cliente com 3
// vídeos e 4 postagens teria o custo contado 4 vezes. É o defeito clássico de
// relatório, e passa despercebido porque o número continua "plausível".
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const pool = require('../../src/db/pool');
const settingsRepository = require('../../src/repositories/settingsRepository');
const { startServer, stopServer, createLoginableClient, createAgent } = require('../helpers/http');

let baseUrl;
let admin;

test.before(async () => {
  baseUrl = await startServer();
  admin = await createLoginableClient({ role: 'admin' });
});

test.after(async () => {
  await stopServer();
  await pool.end();
});

let seq = 0;
const unico = () => `${Date.now()}${seq++}`;

async function agenteAdmin() {
  const agente = createAgent(baseUrl);
  await agente.login(admin.email, admin.password);
  return agente;
}

async function clienteComDados({ whisper = 0, claude = 0, videos = 1, postagens = 0, plano = null } = {}) {
  const cliente = await createLoginableClient({ role: 'client' });

  if (plano) {
    const { rows: [p] } = await pool.query('SELECT id FROM subscription_plans WHERE key = $1', [plano]);
    await pool.query(
      `INSERT INTO client_subscriptions (client_user_id, plan_id, status) VALUES ($1, $2, 'ativo')
       ON CONFLICT (client_user_id) DO UPDATE SET plan_id = $2, status = 'ativo'`,
      [cliente.id, p.id]
    );
  }

  for (let i = 0; i < videos; i++) {
    await pool.query(
      `INSERT INTO source_videos (youtube_video_id, title, status, input_type,
         owner_client_user_id, client_user_id, whisper_cost_usd, claude_cost_usd)
       VALUES ($1, 'v', 'ready', 'upload', $2, $2, $3, $4)`,
      [`v${unico()}`, cliente.id, whisper, claude]
    );
  }

  if (postagens > 0) {
    const { rows: [conta] } = await pool.query(
      `INSERT INTO tiktok_accounts (client_user_id, tiktok_open_id, display_name, is_active,
         access_token_encrypted, access_token_iv, refresh_token_encrypted, refresh_token_iv,
         scopes, token_expires_at, connected_at)
       VALUES ($1,$2,'conta',true,'x','x','x','x',ARRAY['video.publish'], now()+interval '30 days', now())
       RETURNING *`,
      [cliente.id, `open-${unico()}`]
    );
    const { rows: [sv] } = await pool.query(
      `INSERT INTO source_videos (youtube_video_id, title, status, input_type, owner_client_user_id, client_user_id)
       VALUES ($1,'v','ready','upload',$2,$2) RETURNING *`, [`v${unico()}`, cliente.id]
    );
    for (let i = 0; i < postagens; i++) {
      const { rows: [clip] } = await pool.query(
        `INSERT INTO clips (source_video_id, start_seconds, end_seconds, status, title)
         VALUES ($1,0,30,'ready','c') RETURNING *`, [sv.id]
      );
      const { rows: [v] } = await pool.query(
        `INSERT INTO videos (source_type, clip_id, filename, mime_type, file_size_bytes)
         VALUES ('youtube_clip',$1,'c.mp4','video/mp4',1000) RETURNING *`, [clip.id]
      );
      await pool.query(
        `INSERT INTO postings (video_id, tiktok_account_id, status, posted_at, queued_at)
         VALUES ($1,$2,'posted', now(), now())`, [v.id, conta.id]
      );
    }
  }
  return cliente;
}

function achar(body, id) {
  return body.clients.find((c) => String(c.id) === String(id));
}

test('cliente sem assinatura aparece como Free', async () => {
  const cliente = await clienteComDados({ videos: 0 });
  const agente = await agenteAdmin();
  const { body } = await agente.get('/api/admin/clients?range=all');

  const linha = achar(body, cliente.id);
  assert.ok(linha, 'o cliente não apareceu na lista');
  assert.equal(linha.plano.chave, 'free');
  assert.equal(linha.plano.nome, 'Free', 'plano em branco parece dado faltando');
});

test('cliente com assinatura ativa mostra o plano dele', async () => {
  const cliente = await clienteComDados({ videos: 0, plano: 'pro' });
  const agente = await agenteAdmin();
  const { body } = await agente.get('/api/admin/clients?range=all');

  const linha = achar(body, cliente.id);
  assert.equal(linha.plano.chave, 'pro');
  assert.equal(linha.plano.status, 'ativo');
});

test('o custo é a soma real, não multiplicada pelas postagens', async () => {
  // 3 vídeos de US$ 0,10 e 4 postagens. O custo é 0,30 - se a consulta juntar
  // vídeos e postagens numa linha só, viraria 1,20.
  const cliente = await clienteComDados({ whisper: 0.05, claude: 0.05, videos: 3, postagens: 4 });
  const agente = await agenteAdmin();
  const { body } = await agente.get('/api/admin/clients?range=all');

  const linha = achar(body, cliente.id);
  assert.ok(
    Math.abs(linha.custoUsd - 0.3) < 0.0001,
    `custo saiu ${linha.custoUsd}, esperado 0.30 - provável multiplicação pelas postagens`
  );
  assert.equal(linha.clipsPosted, 4, 'a contagem de postados também tem que ser exata');
});

test('banda só vira dinheiro quando saiu por proxy pago', async () => {
  // Túnel e reaproveitamento não custam por GB: a banda já está paga.
  await settingsRepository.setValue('custo_banda_por_gb_usd', '10');
  const cliente = await clienteComDados({ videos: 0 });
  const umGb = 1024 ** 3;
  for (const tipo of ['client_tunnel', 'founder_tunnel', 'reuse', 'proxy']) {
    await pool.query(
      `INSERT INTO source_videos (youtube_video_id, title, status, input_type,
         owner_client_user_id, client_user_id, download_egress_type, download_bytes)
       VALUES ($1,'v','ready','upload',$2,$2,$3,$4)`,
      [`v${unico()}`, cliente.id, tipo, umGb]
    );
  }
  const agente = await agenteAdmin();
  const { body } = await agente.get('/api/admin/clients?range=all');

  const linha = achar(body, cliente.id);
  assert.ok(
    Math.abs(linha.custoUsd - 10) < 0.001,
    `custo saiu ${linha.custoUsd}: só o 1 GB de proxy pago devia custar (US$ 10)`
  );
  await settingsRepository.setValue('custo_banda_por_gb_usd', '0');
});

test('o filtro de período muda o custo', async () => {
  const cliente = await clienteComDados({ whisper: 1, claude: 0, videos: 1 });
  await pool.query(
    `UPDATE source_videos SET created_at = now() - interval '40 days' WHERE owner_client_user_id = $1`,
    [cliente.id]
  );
  const agente = await agenteAdmin();

  const tudo = achar((await agente.get('/api/admin/clients?range=all')).body, cliente.id);
  assert.ok(Math.abs(tudo.custoUsd - 1) < 0.0001, 'no máximo, o vídeo antigo tem que contar');

  const hoje = achar((await agente.get('/api/admin/clients?range=today')).body, cliente.id);
  assert.equal(hoje.custoUsd, 0, 'vídeo de 40 dias atrás não pode contar no filtro de hoje');
});

test('período personalizado usa as datas enviadas', async () => {
  const cliente = await clienteComDados({ whisper: 2, claude: 0, videos: 1 });
  await pool.query(
    `UPDATE source_videos SET created_at = now() - interval '10 days' WHERE owner_client_user_id = $1`,
    [cliente.id]
  );
  const dia = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
  const agente = await agenteAdmin();

  const dentro = achar((await agente.get(`/api/admin/clients?range=custom&since=${dia(12)}&until=${dia(8)}`)).body, cliente.id);
  assert.ok(Math.abs(dentro.custoUsd - 2) < 0.0001, 'o vídeo estava dentro do intervalo pedido');

  const fora = achar((await agente.get(`/api/admin/clients?range=custom&since=${dia(3)}&until=${dia(1)}`)).body, cliente.id);
  assert.equal(fora.custoUsd, 0, 'o vídeo estava fora do intervalo pedido');
});

test('ordenar por maior custo traz o mais caro primeiro', async () => {
  const agente = await agenteAdmin();
  const { body } = await agente.get('/api/admin/clients?range=all&ordem=maior_custo');
  const custos = body.clients.map((c) => c.custoUsd);
  for (let i = 1; i < custos.length; i++) {
    assert.ok(custos[i] <= custos[i - 1], `a lista não veio do maior pro menor: ${custos.join(', ')}`);
  }
  assert.equal(body.ordem, 'maior_custo');
});

test('cliente com várias contas do TikTok aparece UMA vez', async () => {
  // A consulta antiga juntava tiktok_accounts e agrupava pelo nome da conta -
  // quem tinha 3 contas aparecia 3 vezes na lista do admin.
  const cliente = await clienteComDados({ videos: 0 });
  for (let i = 0; i < 3; i++) {
    await pool.query(
      `INSERT INTO tiktok_accounts (client_user_id, tiktok_open_id, display_name, is_active,
         access_token_encrypted, access_token_iv, refresh_token_encrypted, refresh_token_iv,
         scopes, token_expires_at, connected_at)
       VALUES ($1,$2,$3,true,'x','x','x','x',ARRAY['video.publish'], now()+interval '30 days', now())`,
      [cliente.id, `open-${unico()}`, `conta ${i}`]
    );
  }
  const agente = await agenteAdmin();
  const { body } = await agente.get('/api/admin/clients?range=all');
  const linhas = body.clients.filter((c) => String(c.id) === String(cliente.id));
  assert.equal(linhas.length, 1, `o cliente apareceu ${linhas.length} vezes`);
  assert.equal(linhas[0].tiktokAccountCount, 3);
});

test('cliente comum não abre a lista de clientes', async () => {
  const cliente = await createLoginableClient({ role: 'client' });
  const agente = createAgent(baseUrl);
  await agente.login(cliente.email, cliente.password);
  const { status } = await agente.get('/api/admin/clients');
  assert.equal(status, 403);
});
