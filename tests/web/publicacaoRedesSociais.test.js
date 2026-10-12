// Publicação de cortes no Instagram, Facebook, Threads, LinkedIn, Pinterest,
// Bluesky e YouTube pela Outstand (10-11/10/2026), com fila igual à do TikTok.
//
// Os testes cobrem o caminho inteiro contra uma Outstand falsa (envio do
// arquivo, criação da publicação, resultado da rede) e as travas que importam:
// horário e "quantos por dia", conta de outro cliente, limite de duração de
// cada rede, nunca publicar o mesmo vídeo duas vezes quando a chamada falha no
// meio, limite compartilhado do YouTube, e o arquivo do corte não ser apagado
// enquanto ele ainda espera na fila de alguma rede.
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
const postingsRepository = require('../../src/repositories/postingsRepository');
const socialPostingsRepository = require('../../src/repositories/socialPostingsRepository');
const postingScheduleSettingsRepository = require('../../src/repositories/postingScheduleSettingsRepository');
const painelNovo = require('../../src/lib/painelNovo');
const socialPostingService = require('../../src/services/socialPostingService');
const filaSocialService = require('../../src/services/filaSocialService');
const { startServer, stopServer, createLoginableClient, createAgent } = require('../helpers/http');
const { darPlano } = require('../helpers/plano');

let url;
let outstand;
const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'social-pub-'));

// Estado da Outstand falsa.
const arquivosRecebidos = new Map(); // mediaId -> bytes
const posts = new Map(); // postId -> { corpo, chave }
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
      if (req.method === 'GET' && (m = caminho.match(/^\/v1\/pinterest\/accounts\/(.+)\/boards$/))) {
        return responde(200, { success: true, data: [{ id: '111', name: 'Cortes', privacy: 'PUBLIC' }, { id: '222', name: 'Outra' }] });
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
              platformPostUrl: statusDaRede === 'published' ? `https://rede.test/p/${m[1]}/` : null,
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
  await darPlano(u.id);
  const atuais = await painelNovo.idsLiberados();
  await settingsRepository.setValue(painelNovo.CHAVE, [...atuais, Number(u.id)]);
  const agent = createAgent(url);
  await agent.login(u.email, u.password);
  return { u, agent };
}

async function canal(userId) {
  const { rows } = await pool.query(
    `INSERT INTO youtube_channels (client_user_id, youtube_channel_id, channel_url, channel_name)
     VALUES ($1, $2, 'https://www.youtube.com/@redes', 'Canal das redes') RETURNING id`,
    [userId, `UCredes_${uid()}`]
  );
  return Number(rows[0].id);
}

async function corte(userId, { segundos = 45, canalId = null } = {}) {
  const { rows: v } = canalId
    ? await pool.query(
        `INSERT INTO source_videos (youtube_channel_id, input_type, owner_client_user_id, youtube_video_id, title, status)
         VALUES ($1, 'channel', $2, $3, 'Vídeo do canal', 'ready') RETURNING id`,
        [canalId, userId, `yt_${uid()}`]
      )
    : await pool.query(
        `INSERT INTO source_videos (input_type, client_user_id, owner_client_user_id, youtube_video_id, title, status)
         VALUES ('manual', $1, $1, $2, 'Vídeo avulso', 'ready') RETURNING id`,
        [userId, `yt_${uid()}`]
      );
  const arquivo = path.join(pasta, `${uid()}.mp4`);
  fs.writeFileSync(arquivo, `bytes do video ${uid()}`);
  const { rows } = await pool.query(
    `INSERT INTO clips (source_video_id, title, description, start_seconds, end_seconds, status, local_clip_path)
     VALUES ($1, 'Título do corte', 'Legenda do corte #reels', 10, $2, 'ready', $3) RETURNING *`,
    [v[0].id, 10 + segundos, arquivo]
  );
  return { ...rows[0], id: Number(rows[0].id), arquivo, sourceVideoId: Number(v[0].id) };
}

async function contaSocial(userId, network = 'instagram') {
  const { rows } = await pool.query(
    `INSERT INTO social_accounts (client_user_id, network, outstand_account_id, username, display_name)
     VALUES ($1, $2, $3, 'perfil_teste', 'Perfil de teste') RETURNING id, outstand_account_id, network`,
    [userId, network, `acc_${uid()}`]
  );
  return { id: Number(rows[0].id), outstandId: rows[0].outstand_account_id, network };
}

async function contaTiktok(userId) {
  const { rows } = await pool.query(
    `INSERT INTO tiktok_accounts (client_user_id, tiktok_open_id, token_expires_at, display_name, access_token_encrypted, refresh_token_encrypted)
     VALUES ($1, $2, now() + interval '1 day', 'Conta TikTok', 'x', 'x') RETURNING id`,
    [userId, `open_${uid()}`]
  );
  return Number(rows[0].id);
}

async function postagens(socialAccountId) {
  const { rows } = await pool.query('SELECT * FROM social_postings WHERE social_account_id = $1 ORDER BY id', [socialAccountId]);
  return rows;
}

async function vencer(socialAccountId) {
  await pool.query(
    `UPDATE social_postings SET scheduled_for = now() - interval '1 minute' - (id * interval '1 second')
      WHERE social_account_id = $1 AND status = 'pending'`,
    [socialAccountId]
  );
}

const enviar = (agent, clipId, socialAccountIds) => agent.post(`/api/client/feed/cortes/youtube/${clipId}/enviar`, { socialAccountIds });

test('cada conta aparece no Postar do feed com o limite de duração da rede', async () => {
  const { u, agent } = await logado();
  const ig = await contaSocial(u.id);
  const th = await contaSocial(u.id, 'threads');
  const r = await agent.get('/api/client/feed/contexto');
  assert.equal(r.status, 200);
  const doIg = r.body.contas.find((c) => c.rede === 'instagram' && c.id === ig.id);
  const doTh = r.body.contas.find((c) => c.rede === 'threads' && c.id === th.id);
  assert.equal(doIg.disponivel, true);
  assert.equal(doIg.duracaoMaximaS, 90);
  assert.equal(doTh.duracaoMaximaS, 300);
});

test('o corte entra na fila no próximo horário e só sai quando o horário chega', async () => {
  const { u, agent } = await logado();
  const conta = await contaSocial(u.id);
  const c = await corte(u.id);

  const r = await enviar(agent, c.id, [conta.id]);
  assert.equal(r.status, 200);
  assert.equal(r.body.resultados[0].resultado, 'enfileirado');
  const [p0] = await postagens(conta.id);
  assert.equal(p0.status, 'pending');
  assert.ok(new Date(p0.scheduled_for) > new Date(), 'marcado pra um horário futuro');

  await socialPostingService.run();
  assert.equal((await postagens(conta.id))[0].status, 'pending', 'antes do horário não sai');

  await vencer(conta.id);
  await socialPostingService.run();
  const [p] = await postagens(conta.id);
  assert.equal(p.status, 'posted', p.error_message || '');
  assert.match(p.platform_post_url, /rede\.test/);
  const enviado = posts.get(p.outstand_post_id);
  assert.deepEqual(enviado.corpo.accounts, [conta.outstandId]);
  assert.equal(enviado.corpo.containers[0].content, 'Legenda do corte #reels');
  const mediaId = enviado.corpo.containers[0].media[0].url.match(/\/([^/]+)\.mp4$/)[1];
  assert.deepEqual(arquivosRecebidos.get(mediaId), fs.readFileSync(c.arquivo));

  // O feed mostra onde o corte foi publicado, e mandar de novo não duplica.
  const feed = await agent.get('/api/client/feed?canal=avulsos&vistos=1');
  const pub = feed.body.cortes.find((x) => x.id === c.id).postagens.find((x) => x.rede === 'instagram');
  assert.equal(pub.status, 'posted');
  const de_novo = await enviar(agent, c.id, [conta.id]);
  assert.equal(de_novo.body.resultados[0].resultado, 'ja_publicado');
  assert.equal((await postagens(conta.id)).length, 1);
});

test('"quantos por dia" segura o resto da fila; Postar agora passa na frente e não conta no limite', async () => {
  const { u, agent } = await logado();
  const conta = await contaSocial(u.id);
  assert.equal((await agent.put(`/api/client/social-accounts/${conta.id}/horarios`, { mode: 'auto', videosPerDay: 1, manualTimes: [] })).status, 200);
  const a = await corte(u.id);
  const b = await corte(u.id);
  const c = await corte(u.id);
  for (const x of [a, b, c]) await enviar(agent, x.id, [conta.id]);
  await vencer(conta.id);

  await socialPostingService.run();
  await socialPostingService.run();
  let lista = await postagens(conta.id);
  assert.equal(lista.filter((p) => p.status === 'posted').length, 1, 'só 1 por dia');

  const pendente = lista.find((p) => p.status === 'pending');
  assert.equal((await agent.post(`/api/client/social-postings/${pendente.id}/postar-agora`, {})).status, 200);
  await socialPostingService.run();
  lista = await postagens(conta.id);
  assert.equal(lista.find((p) => p.id === pendente.id).status, 'posted', 'Postar agora sai mesmo com o limite do dia batido');
  assert.equal(lista.filter((p) => p.status === 'pending').length, 1);
});

test('publicação automática desligada ou fila pausada não publica, mas Postar agora sim', async () => {
  const { u, agent } = await logado();
  const conta = await contaSocial(u.id);
  const c = await corte(u.id);
  await enviar(agent, c.id, [conta.id]);
  await vencer(conta.id);

  await agent.put(`/api/client/social-accounts/${conta.id}/pausa`, { paused: true });
  await socialPostingService.run();
  assert.equal((await postagens(conta.id))[0].status, 'pending');

  await agent.put(`/api/client/social-accounts/${conta.id}/pausa`, { paused: false });
  await agent.put(`/api/client/social-accounts/${conta.id}/auto-post`, { enabled: false });
  await socialPostingService.run();
  assert.equal((await postagens(conta.id))[0].status, 'pending');

  await agent.post(`/api/client/social-postings/${(await postagens(conta.id))[0].id}/postar-agora`, {});
  await socialPostingService.run();
  assert.equal((await postagens(conta.id))[0].status, 'posted');
});

test('Facebook vai como Reel; YouTube leva título, Short e privacidade escolhida', async () => {
  const { u, agent } = await logado();
  const fb = await contaSocial(u.id, 'facebook');
  const yt = await contaSocial(u.id, 'youtube');
  assert.equal((await agent.put(`/api/client/social-accounts/${yt.id}/opcoes`, { youtubePrivacidade: 'unlisted' })).status, 200);
  const c = await corte(u.id);
  await enviar(agent, c.id, [fb.id, yt.id]);
  await vencer(fb.id);
  await vencer(yt.id);
  await socialPostingService.run();
  const [pf] = await postagens(fb.id);
  const [py] = await postagens(yt.id);
  assert.deepEqual(posts.get(pf.outstand_post_id).corpo.facebook, { publishAsReel: true });
  const cfg = posts.get(py.outstand_post_id).corpo.youtube;
  assert.equal(cfg.title, 'Título do corte');
  assert.equal(cfg.isShort, true);
  assert.equal(cfg.privacyStatus, 'unlisted');
  assert.equal(cfg.madeForKids, false);
});

test('Pinterest sem pasta escolhida vira erro explicado; com pasta, publica nela', async () => {
  const { u, agent } = await logado();
  const pin = await contaSocial(u.id, 'pinterest');
  const c = await corte(u.id);
  await enviar(agent, c.id, [pin.id]);
  await vencer(pin.id);
  await socialPostingService.run();
  let [p] = await postagens(pin.id);
  assert.equal(p.status, 'error');
  assert.match(p.error_message, /pasta do Pinterest/);

  assert.equal((await agent.put(`/api/client/social-accounts/${pin.id}/opcoes`, { pinterestPasta: '999' })).status, 400, 'pasta que a conta não tem');
  assert.equal((await agent.put(`/api/client/social-accounts/${pin.id}/opcoes`, { pinterestPasta: '111' })).status, 200);
  assert.equal((await agent.post(`/api/client/social-postings/${p.id}/tentar-de-novo`, {})).status, 200);
  await vencer(pin.id);
  await socialPostingService.run();
  [p] = await postagens(pin.id);
  assert.equal(p.status, 'posted');
  assert.equal(posts.get(p.outstand_post_id).corpo.pinterest.board_id, '111');
});

test('YouTube sem vaga no limite do dia: o corte espera a vaga e tenta de novo numa publicação nova', async () => {
  const { u, agent } = await logado();
  const yt = await contaSocial(u.id, 'youtube');
  const c = await corte(u.id);
  await enviar(agent, c.id, [yt.id]);
  await vencer(yt.id);

  statusDaRede = 'failed';
  erroDaRede = 'YouTube upload denied: daily_limit_reached (retryAt 2099-01-01T08:00:00Z)';
  await socialPostingService.run();
  let [p] = await postagens(yt.id);
  assert.equal(p.status, 'pending', 'não vira erro: espera vaga');
  assert.equal(new Date(p.scheduled_for).toISOString(), '2099-01-01T08:00:00.000Z');
  assert.equal(Number(p.tentativa), 2);
  const chaveAntiga = posts.get([...porChave.entries()].find(([k]) => k.startsWith(`pf-social-${p.id}-1`))[1]).chave;

  statusDaRede = 'published';
  await vencer(yt.id);
  await socialPostingService.run();
  [p] = await postagens(yt.id);
  assert.equal(p.status, 'posted');
  assert.notEqual(posts.get(p.outstand_post_id).chave, chaveAntiga);
});

test('resposta perdida no meio da criação não publica o vídeo duas vezes', async () => {
  const { u, agent } = await logado();
  const conta = await contaSocial(u.id);
  const c = await corte(u.id);
  await enviar(agent, c.id, [conta.id]);
  await vencer(conta.id);

  const antes = posts.size;
  falharProximaCriacaoDepoisDeCriar = true;
  await socialPostingService.run();
  let [p] = await postagens(conta.id);
  assert.equal(p.status, 'pending', 'falha passageira volta pra fila');

  await vencer(conta.id);
  await socialPostingService.run();
  [p] = await postagens(conta.id);
  assert.equal(p.status, 'posted');
  assert.equal(posts.size - antes, 1, 'a Outstand recebeu a mesma publicação, não duas');
});

test('a rede recusa: erro com mensagem que o cliente entende, e tentar de novo usa chave nova', async () => {
  const { u, agent } = await logado();
  const conta = await contaSocial(u.id);
  const c = await corte(u.id);
  await enviar(agent, c.id, [conta.id]);
  await vencer(conta.id);

  statusDaRede = 'failed';
  erroDaRede = 'Instagram account is not a business or creator account';
  await socialPostingService.run();
  let [p] = await postagens(conta.id);
  assert.equal(p.status, 'error');
  assert.match(p.error_message, /conta profissional/);
  const chaveAntiga = posts.get(p.outstand_post_id).chave;

  statusDaRede = 'published';
  const r = await enviar(agent, c.id, [conta.id]);
  assert.equal(r.body.resultados[0].resultado, 'enfileirado');
  await vencer(conta.id);
  await socialPostingService.run();
  [p] = await postagens(conta.id);
  assert.equal(p.status, 'posted');
  assert.notEqual(posts.get(p.outstand_post_id).chave, chaveAntiga);
});

test('Instagram recusa corte acima de 90 s com o aviso combinado; o Threads aceita', async () => {
  const { u, agent } = await logado();
  const ig = await contaSocial(u.id);
  const th = await contaSocial(u.id, 'threads');
  const c = await corte(u.id, { segundos: 150 });
  const r = await enviar(agent, c.id, [ig.id]);
  assert.equal(r.status, 422);
  assert.equal(
    r.body.error,
    'O Instagram só aceita vídeos com menos de 90 segundos, esse vídeo não será publicado no Instagram.'
  );
  assert.equal((await postagens(ig.id)).length, 0);
  assert.equal((await enviar(agent, c.id, [th.id])).status, 200);
});

test('conta ou postagem de outro cliente: recusado, nada criado', async () => {
  const { u, agent } = await logado();
  const outro = await logado();
  const dele = await contaSocial(outro.u.id);
  const minha = await contaSocial(u.id);
  const c = await corte(u.id);
  assert.equal((await enviar(agent, c.id, [minha.id, dele.id])).status, 404);
  assert.equal((await postagens(minha.id)).length, 0);

  const cDele = await corte(outro.u.id);
  await enviar(outro.agent, cDele.id, [dele.id]);
  const [pDele] = await postagens(dele.id);
  for (const rota of ['postar-agora', 'cancelar', 'tentar-de-novo']) {
    assert.ok([404, 409].includes((await agent.post(`/api/client/social-postings/${pDele.id}/${rota}`, {})).status), rota);
  }
  assert.equal((await postagens(dele.id))[0].status, 'pending');
  assert.equal((await agent.get(`/api/client/social-accounts/${dele.id}/fila`)).status, 404);
  assert.equal((await agent.put(`/api/client/social-accounts/${dele.id}/horarios`, { mode: 'auto', videosPerDay: 1 })).status, 404);
});

test('canal ligado a contas: cortes prontos entram; corte novo longo demais fica registrado com o motivo', async () => {
  const { u, agent } = await logado();
  const ig = await contaSocial(u.id);
  const canalId = await canal(u.id);
  const curto = await corte(u.id, { canalId, segundos: 40 });
  await corte(u.id, { canalId, segundos: 140 });

  const r = await agent.put(`/api/client/social-accounts/canais/${canalId}`, { socialAccountIds: [ig.id] });
  assert.equal(r.status, 200);
  assert.equal(r.body.enfileirados, 1);
  assert.equal(r.body.longos, 1);
  assert.equal((await postagens(ig.id))[0].clip_id, String(curto.id));

  // Corte novo do canal (pipeline): curto entra, longo vira erro explicado.
  const novo = await corte(u.id, { canalId, segundos: 120 });
  const { rows: sv } = await pool.query('SELECT * FROM source_videos WHERE id = $1', [novo.sourceVideoId]);
  await filaSocialService.corteFicouPronto({ sourceVideo: sv[0], clip: novo });
  const p = (await postagens(ig.id)).find((x) => x.clip_id === String(novo.id));
  assert.equal(p.status, 'error');
  assert.equal(p.erro_tipo, 'duracao');
  assert.match(p.error_message, /menos de 90 segundos/);
  // Erro de duração não oferece "tentar de novo": daria o mesmo resultado.
  assert.equal((await agent.post(`/api/client/social-postings/${p.id}/tentar-de-novo`, {})).status, 409);

  // Canal de outro cliente e conta de outro cliente são recusados.
  const outro = await logado();
  const canalDele = await canal(outro.u.id);
  assert.equal((await agent.put(`/api/client/social-accounts/canais/${canalDele}`, { socialAccountIds: [ig.id] })).status, 404);
  const contaDele = await contaSocial(outro.u.id);
  assert.equal((await agent.put(`/api/client/social-accounts/canais/${canalId}`, { socialAccountIds: [contaDele.id] })).status, 404);
});

test('"usar esta configuração em todas" copia horários pra todas as contas, TikTok incluído', async () => {
  const { u, agent } = await logado();
  const ig = await contaSocial(u.id);
  const fb = await contaSocial(u.id, 'facebook');
  const tk = await contaTiktok(u.id);
  await agent.put(`/api/client/social-accounts/${ig.id}/horarios`, { mode: 'manual', videosPerDay: 2, manualTimes: ['09:00', '18:30'] });
  await agent.put(`/api/client/social-accounts/${ig.id}/auto-post`, { enabled: true });

  const r = await agent.post('/api/client/social-accounts/aplicar-em-todas', { origem: { rede: 'social', id: ig.id } });
  assert.equal(r.status, 200);
  assert.equal(r.body.contas, 3);
  const doFb = (await agent.get(`/api/client/social-accounts/${fb.id}/publicacao`)).body;
  assert.equal(doFb.mode, 'manual');
  assert.deepEqual(doFb.manualTimes, ['09:00', '18:30']);
  assert.equal(doFb.videosPerDay, 2);
  const doTk = await postingScheduleSettingsRepository.findByTiktokAccountId(tk);
  assert.equal(doTk.mode, 'manual');
  assert.deepEqual(doTk.manual_times, ['09:00', '18:30']);
  const { rows } = await pool.query('SELECT auto_post_enabled FROM tiktok_accounts WHERE id = $1', [tk]);
  assert.equal(rows[0].auto_post_enabled, true);

  // Conta de origem de outro cliente: recusado.
  const outro = await logado();
  const dele = await contaSocial(outro.u.id);
  assert.equal((await agent.post('/api/client/social-accounts/aplicar-em-todas', { origem: { rede: 'social', id: dele.id } })).status, 404);
});

test('a limpeza de disco não apaga corte que ainda espera na fila de outra rede', async () => {
  const { u, agent } = await logado();
  const ig = await contaSocial(u.id);
  const tk = await contaTiktok(u.id);
  const c = await corte(u.id);
  const { rows: v } = await pool.query(
    `INSERT INTO videos (source_type, clip_id, filename, mime_type) VALUES ('youtube_clip', $1, 'x', 'video/mp4') RETURNING id`,
    [c.id]
  );
  await pool.query(
    `INSERT INTO postings (video_id, tiktok_account_id, status, posted_at) VALUES ($1, $2, 'posted', now() - interval '10 days')`,
    [v[0].id, tk]
  );
  await enviar(agent, c.id, [ig.id]);

  const doTiktok = await postingsRepository.listPostedOlderThan(72);
  assert.ok(!doTiktok.some((p) => String(p.clip_id) === String(c.id)), 'ainda na fila do Instagram: não apaga');

  await pool.query(`UPDATE social_postings SET status = 'posted', posted_at = now() - interval '10 days' WHERE social_account_id = $1`, [ig.id]);
  assert.ok((await postingsRepository.listPostedOlderThan(72)).some((p) => String(p.clip_id) === String(c.id)));
  assert.ok((await socialPostingsRepository.publicadosParaLimpar(72)).some((p) => String(p.clip_id) === String(c.id)));
});

test('feed sem repetição: corte assistido some, "vistos=1" mostra de novo, corte de outro cliente não é marcado', async () => {
  const { u, agent } = await logado();
  const a = await corte(u.id);
  const b = await corte(u.id);
  const outro = await logado();
  const deOutro = await corte(outro.u.id);

  let feed = await agent.get('/api/client/feed?canal=avulsos');
  assert.deepEqual(feed.body.cortes.map((x) => x.id).sort(), [a.id, b.id].sort());

  assert.equal(
    (await agent.post('/api/client/feed/vistos', { cortes: [{ tipo: 'youtube', id: a.id }, { tipo: 'youtube', id: deOutro.id }] })).status,
    200
  );
  feed = await agent.get('/api/client/feed?canal=avulsos');
  assert.deepEqual(feed.body.cortes.map((x) => x.id), [b.id]);
  assert.equal(feed.body.assistidos, 1);
  const tudo = await agent.get('/api/client/feed?canal=avulsos&vistos=1');
  assert.equal(tudo.body.cortes.length, 2);
  const { rows } = await pool.query('SELECT count(*)::int AS n FROM clip_views WHERE clip_id = $1', [deOutro.id]);
  assert.equal(rows[0].n, 0, 'não marca corte de outro cliente');

  await agent.delete('/api/client/feed/vistos');
  feed = await agent.get('/api/client/feed?canal=avulsos');
  assert.equal(feed.body.cortes.length, 2);
});
