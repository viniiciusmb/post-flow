// Publicação de cortes no Instagram e no Facebook pela Outstand (10/10/2026).
//
// Antes a conta conectava mas o feed a mostrava como "publicação em breve".
// Os testes cobrem o caminho inteiro contra uma Outstand falsa (envio do
// arquivo, criação da publicação, resultado da rede) e as travas que importam:
// conta de outro cliente, limite de duração do Reel, e nunca publicar o mesmo
// vídeo duas vezes quando a chamada falha no meio.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const pool = require('../../src/db/pool');
const config = require('../../src/config');
const queueService = require('../../src/services/queueService');
const settingsRepository = require('../../src/repositories/settingsRepository');
const painelNovo = require('../../src/lib/painelNovo');
const socialPostingService = require('../../src/services/socialPostingService');
const { startServer, stopServer, createLoginableClient, createAgent } = require('../helpers/http');

let url;
let outstand;
const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'social-pub-'));

// Estado da Outstand falsa.
const arquivosRecebidos = new Map(); // mediaId -> bytes
const posts = new Map(); // postId -> { corpo, status, error }
const porChave = new Map(); // Idempotency-Key -> postId
let falharProximaCriacaoDepoisDeCriar = false;
let statusDaRede = 'published';
let erroDaRede = null;

test.before(async () => {
  outstand = http.createServer((req, res) => {
    const pedacos = [];
    req.on('data', (c) => pedacos.push(c));
    req.on('end', () => {
      const bruto = Buffer.concat(pedacos);
      const caminho = req.url.split('?')[0];
      const responde = (status, body) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(body));
      };
      const base = `http://127.0.0.1:${outstand.address().port}`;
      let m;
      if (req.method === 'POST' && caminho === '/v1/media/upload') {
        const id = `m${arquivosRecebidos.size + 1}_${process.pid}`;
        arquivosRecebidos.set(id, null);
        return responde(200, { success: true, data: { id, upload_url: `${base}/armazenamento/${id}`, expires_in: 3600 } });
      }
      if (req.method === 'PUT' && (m = caminho.match(/^\/armazenamento\/(.+)$/))) {
        // A URL de envio é do armazenamento deles: não pode levar a nossa chave.
        if (req.headers.authorization) return responde(400, { error: 'chave vazou pro armazenamento' });
        arquivosRecebidos.set(m[1], bruto);
        res.writeHead(200);
        return res.end();
      }
      if (req.method === 'POST' && (m = caminho.match(/^\/v1\/media\/(.+)\/confirm$/))) {
        if (!arquivosRecebidos.get(m[1])) return responde(400, { success: false, error: 'arquivo nao chegou' });
        return responde(200, { success: true, data: { id: m[1], url: `https://media.outstand.test/${m[1]}.mp4` } });
      }
      if (req.method === 'POST' && caminho === '/v1/posts') {
        const corpo = JSON.parse(bruto.toString());
        const chave = req.headers['idempotency-key'];
        let id = chave && porChave.get(chave);
        if (!id) {
          id = `p${posts.size + 1}_${process.pid}`;
          posts.set(id, { corpo, chave });
          if (chave) porChave.set(chave, id);
        }
        if (falharProximaCriacaoDepoisDeCriar) {
          // A Outstand criou, mas a resposta não chegou.
          falharProximaCriacaoDepoisDeCriar = false;
          return responde(502, { success: false, error: 'gateway' });
        }
        return responde(200, { success: true, post: { id, socialAccounts: corpo.accounts.map((a) => ({ id: a })) } });
      }
      if (req.method === 'GET' && (m = caminho.match(/^\/v1\/posts\/(.+)$/))) {
        const p = posts.get(m[1]);
        if (!p) return responde(404, { success: false, error: 'nao existe' });
        return responde(200, {
          success: true,
          post: {
            id: m[1],
            socialAccounts: p.corpo.accounts.map((a) => ({
              id: a,
              status: statusDaRede,
              error: statusDaRede === 'failed' ? erroDaRede : null,
              platformPostUrl: statusDaRede === 'published' ? `https://www.instagram.com/reel/${m[1]}/` : null,
            })),
          },
        });
      }
      responde(404, { success: false, error: 'rota falsa nao existe' });
    });
  });
  await new Promise((r) => outstand.listen(0, '127.0.0.1', r));
  config.outstand.apiKey = 'chave-de-teste';
  config.outstand.baseUrlOverride = `http://127.0.0.1:${outstand.address().port}`;
  url = await startServer();
});

test.after(async () => {
  await stopServer();
  await queueService.stopBoss();
  await new Promise((r) => outstand.close(r));
  await pool.end();
  fs.rmSync(pasta, { recursive: true, force: true });
});

test.beforeEach(() => {
  statusDaRede = 'published';
  erroDaRede = null;
  falharProximaCriacaoDepoisDeCriar = false;
});

let n = 0;
const uid = () => `${process.pid}_${Date.now().toString(36)}_${n++}`;

async function logado() {
  const u = await createLoginableClient();
  const atuais = await painelNovo.idsLiberados();
  await settingsRepository.setValue(painelNovo.CHAVE, [...atuais, Number(u.id)]);
  const agent = createAgent(url);
  await agent.login(u.email, u.password);
  return { u, agent };
}

async function corte(userId, { segundos = 45 } = {}) {
  const { rows: v } = await pool.query(
    `INSERT INTO source_videos (input_type, client_user_id, owner_client_user_id, youtube_video_id, title, status)
     VALUES ('manual', $1, $1, $2, 'Vídeo avulso', 'ready') RETURNING id`,
    [userId, `yt_${uid()}`]
  );
  const arquivo = path.join(pasta, `${uid()}.mp4`);
  fs.writeFileSync(arquivo, `bytes do video ${uid()}`);
  const { rows } = await pool.query(
    `INSERT INTO clips (source_video_id, title, description, start_seconds, end_seconds, status, local_clip_path)
     VALUES ($1, 'Corte', 'Legenda do corte #reels', 10, $2, 'ready', $3) RETURNING id`,
    [v[0].id, 10 + segundos, arquivo]
  );
  return { id: Number(rows[0].id), arquivo };
}

async function contaSocial(userId, network = 'instagram') {
  const { rows } = await pool.query(
    `INSERT INTO social_accounts (client_user_id, network, outstand_account_id, username, display_name)
     VALUES ($1, $2, $3, 'perfil_teste', 'Perfil de teste') RETURNING id, outstand_account_id`,
    [userId, network, `acc_${uid()}`]
  );
  return { id: Number(rows[0].id), outstandId: rows[0].outstand_account_id };
}

async function postagem(socialAccountId) {
  const { rows } = await pool.query('SELECT * FROM social_postings WHERE social_account_id = $1', [socialAccountId]);
  return rows;
}

test('a conta do Instagram aparece disponível no Postar do feed, com o limite de duração', async () => {
  const { u, agent } = await logado();
  const conta = await contaSocial(u.id);
  const r = await agent.get('/api/client/feed/contexto');
  assert.equal(r.status, 200);
  const ig = r.body.contas.find((c) => c.rede === 'instagram' && c.id === conta.id);
  assert.ok(ig);
  assert.equal(ig.disponivel, true);
  assert.equal(r.body.limitesRedesSociais.duracaoMaximaS, 90);
});

test('mandar pro Instagram envia o arquivo, cria a publicação e marca publicada quando a rede confirma', async () => {
  const { u, agent } = await logado();
  const conta = await contaSocial(u.id);
  const c = await corte(u.id);

  const r = await agent.post(`/api/client/feed/cortes/youtube/${c.id}/enviar`, { socialAccountIds: [conta.id] });
  assert.equal(r.status, 200);
  assert.equal(r.body.resultados[0].rede, 'instagram');
  assert.equal(r.body.resultados[0].resultado, 'enfileirado');
  assert.equal((await postagem(conta.id))[0].status, 'pending');

  await socialPostingService.run();
  const [p] = await postagem(conta.id);
  assert.equal(p.status, 'posted', p.error_message || '');
  assert.match(p.platform_post_url, /instagram\.com\/reel\//);

  const enviado = posts.get(p.outstand_post_id);
  assert.deepEqual(enviado.corpo.accounts, [conta.outstandId]);
  assert.equal(enviado.corpo.containers[0].content, 'Legenda do corte #reels');
  assert.equal(enviado.corpo.facebook, undefined);
  // Os bytes que chegaram são os do arquivo do corte.
  const mediaId = enviado.corpo.containers[0].media[0].url.match(/\/([^/]+)\.mp4$/)[1];
  assert.deepEqual(arquivosRecebidos.get(mediaId), fs.readFileSync(c.arquivo));

  // O feed passa a mostrar onde o corte foi publicado.
  const feed = await agent.get('/api/client/feed?canal=avulsos');
  const noFeed = feed.body.cortes.find((x) => x.id === c.id);
  const pub = noFeed.postagens.find((x) => x.rede === 'instagram');
  assert.equal(pub.accountId, conta.id);
  assert.equal(pub.status, 'posted');

  // Mandar de novo não publica duas vezes.
  const de_novo = await agent.post(`/api/client/feed/cortes/youtube/${c.id}/enviar`, { socialAccountIds: [conta.id] });
  assert.equal(de_novo.body.resultados[0].resultado, 'ja_publicado');
  assert.equal((await postagem(conta.id)).length, 1);
});

test('no Facebook o vídeo vai como Reel', async () => {
  const { u, agent } = await logado();
  const conta = await contaSocial(u.id, 'facebook');
  const c = await corte(u.id);
  await agent.post(`/api/client/feed/cortes/youtube/${c.id}/enviar`, { socialAccountIds: [conta.id] });
  await socialPostingService.run();
  const [p] = await postagem(conta.id);
  assert.deepEqual(posts.get(p.outstand_post_id).corpo.facebook, { publishAsReel: true });
});

test('resposta perdida no meio da criação não publica o vídeo duas vezes', async () => {
  const { u, agent } = await logado();
  const conta = await contaSocial(u.id);
  const c = await corte(u.id);
  await agent.post(`/api/client/feed/cortes/youtube/${c.id}/enviar`, { socialAccountIds: [conta.id] });

  const antes = posts.size;
  falharProximaCriacaoDepoisDeCriar = true;
  await socialPostingService.run();
  let [p] = await postagem(conta.id);
  assert.equal(p.status, 'pending', 'falha passageira volta pra fila');
  assert.ok(p.proxima_tentativa_em);

  await pool.query('UPDATE social_postings SET proxima_tentativa_em = now() WHERE id = $1', [p.id]);
  await socialPostingService.run();
  [p] = await postagem(conta.id);
  assert.equal(p.status, 'posted');
  assert.equal(posts.size - antes, 1, 'a Outstand recebeu a mesma publicação, não duas');
});

test('a rede recusa: vira erro com mensagem que o cliente entende, e pedir de novo publica numa tentativa nova', async () => {
  const { u, agent } = await logado();
  const conta = await contaSocial(u.id);
  const c = await corte(u.id);
  await agent.post(`/api/client/feed/cortes/youtube/${c.id}/enviar`, { socialAccountIds: [conta.id] });

  statusDaRede = 'failed';
  erroDaRede = 'Instagram account is not a business or creator account';
  await socialPostingService.run();
  let [p] = await postagem(conta.id);
  assert.equal(p.status, 'error');
  assert.match(p.error_message, /conta profissional/);
  const chaveAntiga = posts.get(p.outstand_post_id).chave;

  statusDaRede = 'published';
  const r = await agent.post(`/api/client/feed/cortes/youtube/${c.id}/enviar`, { socialAccountIds: [conta.id] });
  assert.equal(r.body.resultados[0].resultado, 'enfileirado');
  await socialPostingService.run();
  [p] = await postagem(conta.id);
  assert.equal(p.status, 'posted');
  assert.notEqual(posts.get(p.outstand_post_id).chave, chaveAntiga, 'tentativa nova usa chave nova');
});

test('conta de outro cliente recusa o pedido inteiro', async () => {
  const { u, agent } = await logado();
  const outro = await createLoginableClient();
  const dele = await contaSocial(outro.id);
  const minha = await contaSocial(u.id);
  const c = await corte(u.id);
  const r = await agent.post(`/api/client/feed/cortes/youtube/${c.id}/enviar`, { socialAccountIds: [minha.id, dele.id] });
  assert.equal(r.status, 404);
  assert.equal((await postagem(minha.id)).length, 0);
  assert.equal((await postagem(dele.id)).length, 0);
});

test('corte acima de 90 s é recusado pro Instagram com o motivo', async () => {
  const { u, agent } = await logado();
  const conta = await contaSocial(u.id);
  const c = await corte(u.id, { segundos: 150 });
  const r = await agent.post(`/api/client/feed/cortes/youtube/${c.id}/enviar`, { socialAccountIds: [conta.id] });
  assert.equal(r.status, 422);
  assert.match(r.body.error, /90 s/);
  assert.equal((await postagem(conta.id)).length, 0);
});
