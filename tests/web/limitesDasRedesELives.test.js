// Limites por plano das novidades (12/10/2026) e o registro completo dos erros.
//
// Redes sociais: 1 / 3 / 6 contas em CADA rede (Starter / Pro / Max). Lives:
// 1 / 2 / 3 canais acompanhados e 1 live clipada por vez. Os testes conferem
// as três pontas de cada limite: ele barra na entrada, não barra a reconexão
// da mesma conta, e quem passou do limite depois (trocou pra um plano menor)
// fica parado sem perder nada.
//
// E o pedido do fundador: "qualquer erro precisa ser registrado, com todas as
// informações". Os últimos testes provam que a falha ao conectar e ao publicar
// vira uma ocorrência com o contexto inteiro - e sem senha nem token dentro.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const pool = require('../../src/db/pool');
const config = require('../../src/config');
const settingsRepository = require('../../src/repositories/settingsRepository');
const socialPostingsRepository = require('../../src/repositories/socialPostingsRepository');
const systemErrorsRepository = require('../../src/repositories/systemErrorsRepository');
const livesRepository = require('../../src/repositories/livesRepository');
const limitesDasLivesService = require('../../src/services/lives/limitesDasLivesService');
const planLimitsService = require('../../src/services/planLimitsService');
const errorReportService = require('../../src/services/errorReportService');
const socialPostingService = require('../../src/services/socialPostingService');
const errorHandler = require('../../src/web/middleware/errorHandler');
const painelNovo = require('../../src/lib/painelNovo');
const { startServer, stopServer, createLoginableClient, createAgent } = require('../helpers/http');
const { darPlano } = require('../helpers/plano');

let url;
let outstand;
const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'limites-'));
const contasNaOutstand = new Map();
const chamadas = [];
let falharEnvioDeMidia = false;

test.before(async () => {
  outstand = http.createServer((req, res) => {
    let bruto = '';
    req.on('data', (c) => (bruto += c));
    req.on('end', () => {
      const [caminho, query] = req.url.split('?');
      chamadas.push({ metodo: req.method, caminho });
      const responde = (status, body) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(body));
      };
      let m;
      if (req.method === 'POST' && (m = caminho.match(/^\/v1\/social-networks\/(\w+)\/auth-url$/))) {
        return responde(200, { success: true, data: { auth_url: `https://outstand.test/${m[1]}` } });
      }
      if (req.method === 'GET' && caminho === '/v1/social-accounts') {
        const id = new URLSearchParams(query).get('id');
        return responde(200, { success: true, data: contasNaOutstand.has(id) ? [contasNaOutstand.get(id)] : [] });
      }
      if (req.method === 'POST' && /\/finalize$/.test(caminho)) {
        return responde(200, { success: true, connectedAccounts: [] });
      }
      if (req.method === 'DELETE' && caminho.startsWith('/v1/social-accounts/')) return responde(200, { success: true });
      if (req.method === 'POST' && caminho === '/v1/media/upload') {
        if (falharEnvioDeMidia) return responde(503, { success: false, error: 'armazenamento indisponivel agora', request_id: 'req-123' });
        return responde(200, { success: true, data: { id: 'm1', upload_url: `http://127.0.0.1:${outstand.address().port}/arm/m1` } });
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
  await new Promise((r) => outstand.close(r));
  await pool.end();
  fs.rmSync(pasta, { recursive: true, force: true });
});

let n = 0;
const uid = () => `${process.pid}_${Date.now().toString(36)}_${n++}`;

// Sem login: o limitador de força bruta do /login conta todas as entradas do
// arquivo, e a maioria dos testes não precisa da tela.
async function cliente(plano = 'starter') {
  const u = await createLoginableClient();
  if (plano) await darPlano(u.id, plano);
  const atuais = await painelNovo.idsLiberados();
  await settingsRepository.setValue(painelNovo.CHAVE, [...atuais, Number(u.id)]);
  return u;
}

async function logado(plano = 'starter') {
  const u = await cliente(plano);
  const agent = createAgent(url);
  await agent.login(u.email, u.password);
  return { u, agent };
}

async function contaSocial(userId, network = 'instagram', { minutosAtras = 0 } = {}) {
  const { rows } = await pool.query(
    `INSERT INTO social_accounts (client_user_id, network, outstand_account_id, username, connected_at)
     VALUES ($1, $2, $3, 'perfil', now() - make_interval(mins => $4::int)) RETURNING id, outstand_account_id`,
    [userId, network, `acc_${uid()}`, minutosAtras]
  );
  return { id: Number(rows[0].id), outstandId: rows[0].outstand_account_id };
}

async function corte(userId) {
  const arquivo = path.join(pasta, `${uid()}.mp4`);
  fs.writeFileSync(arquivo, 'bytes');
  const { rows: v } = await pool.query(
    `INSERT INTO source_videos (input_type, client_user_id, owner_client_user_id, youtube_video_id, title, status)
     VALUES ('manual', $1, $1, $2, 'v', 'ready') RETURNING id`,
    [userId, `yt_${uid()}`]
  );
  const { rows: c } = await pool.query(
    `INSERT INTO clips (source_video_id, title, start_seconds, end_seconds, status, local_clip_path)
     VALUES ($1, 't', 0, 30, 'ready', $2) RETURNING id`,
    [v[0].id, arquivo]
  );
  return Number(c[0].id);
}

// O registro do erro é gravado sem segurar a resposta (de propósito), então o
// teste espera ele aparecer em vez de conferir na hora.
async function ultimasOcorrencias(operation, filtro) {
  for (let i = 0; i < 40; i += 1) {
    const erros = await systemErrorsRepository.list({ status: 'todos', limit: 500 });
    const e = erros.find((x) => x.operation === operation && filtro(x));
    if (e) {
      const ocorrencias = await systemErrorsRepository.listEvents(e.id);
      if (ocorrencias.length) return { erro: e, ocorrencias };
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  return { erro: null, ocorrencias: [] };
}

// O mesmo erro de clientes diferentes vira UMA linha agrupada (que mostra o
// primeiro cliente); cada ocorrência guarda o cliente dela. Busca por ela.
async function ocorrenciasDoCliente(operation, userId) {
  for (let i = 0; i < 40; i += 1) {
    const { rows } = await pool.query(
      `SELECT ev.* FROM system_error_events ev JOIN system_errors e ON e.id = ev.error_id
        WHERE e.operation = $1 AND ev.client_user_id = $2 ORDER BY ev.occurred_at DESC, ev.id DESC`,
      [operation, userId]
    );
    if (rows.length) return rows;
    await new Promise((r) => setTimeout(r, 50));
  }
  return [];
}

// ---------------------------------------------------------------- redes

test('os números de cada plano: 1 / 3 / 6 contas por rede; sem plano e cancelado = 0; admin sem limite', async () => {
  const caso = async (plano, naRede) => planLimitsService.checkSocialAccountLimit((await cliente(plano)).id, 'Instagram', naRede);
  assert.equal((await caso('starter', 0)).allowed, true);
  assert.equal((await caso('starter', 1)).allowed, false);
  assert.equal((await caso('pro', 2)).allowed, true);
  assert.equal((await caso('pro', 3)).allowed, false);
  assert.equal((await caso('max', 5)).allowed, true);
  assert.equal((await caso('max', 6)).allowed, false);
  assert.equal((await caso(null, 0)).allowed, false, 'sem plano não conecta nada');

  const u = await cliente('max');
  await pool.query("UPDATE client_subscriptions SET status = 'cancelado' WHERE client_user_id = $1", [u.id]);
  assert.equal((await planLimitsService.checkSocialAccountLimit(u.id, 'Instagram', 0)).allowed, false, 'cancelado conta como sem plano');

  const admin = await createLoginableClient({ role: 'admin' });
  assert.equal((await planLimitsService.checkSocialAccountLimit(admin.id, 'Instagram', 50, { admin: true })).allowed, true);
});

test('Starter: a 2ª conta do Instagram é barrada antes de abrir a autorização, mas o Facebook (outra rede) entra', async () => {
  const { u, agent } = await logado('starter');
  await contaSocial(u.id, 'instagram');

  const ig = await agent.post('/api/client/social-accounts/instagram/conectar', {});
  assert.equal(ig.status, 403);
  assert.equal(ig.body.limite, true);
  assert.match(ig.body.error, /1 conta em cada rede social/);

  const fb = await agent.post('/api/client/social-accounts/facebook/conectar', {});
  assert.equal(fb.status, 200, 'o limite é POR rede');

  const lista = await agent.get('/api/client/social-accounts');
  assert.equal(lista.body.limites.contasPorRede, 1);

  const ocorrencias = await ocorrenciasDoCliente('limite_do_plano', u.id);
  assert.ok(ocorrencias.length >= 1, 'quem bateu no limite fica registrado');
  assert.equal(ocorrencias[0].contexto.rede, 'instagram');
});

test('reconectar a MESMA conta não passa pelo limite (o login venceu, não é conta nova)', async () => {
  const { u, agent } = await logado('starter');
  const conta = await contaSocial(u.id, 'instagram');
  const r = await agent.post('/api/client/social-accounts/instagram/conectar', { reconectar: conta.id });
  assert.equal(r.status, 200);
});

test('duas abas: a conta que volta além do limite não é vinculada e é removida da Outstand', async () => {
  const { u, agent } = await logado('starter');
  assert.equal((await agent.post('/api/client/social-accounts/instagram/conectar', {})).status, 200);
  // Enquanto a autorização estava aberta, outra aba conectou um Instagram.
  await contaSocial(u.id, 'instagram');
  const id = `acc_${uid()}`;
  contasNaOutstand.set(id, { id, network: 'instagram', tenant_id: `pf_${u.id}`, username: 'segunda' });

  const r = await agent.get(`/client/social/retorno/instagram?account_id=${id}`);
  assert.match(r.headers.get('location'), /erro=limite/);
  const { rows } = await pool.query('SELECT 1 FROM social_accounts WHERE outstand_account_id = $1', [id]);
  assert.equal(rows.length, 0);
  assert.ok(chamadas.some((c) => c.metodo === 'DELETE' && c.caminho.endsWith(id)), 'não fica conta órfã na Outstand');
});

test('Facebook: escolher mais páginas do que cabem é recusado ANTES de pedir à Outstand', async () => {
  const { agent } = await logado('starter');
  assert.equal((await agent.post('/api/client/social-accounts/facebook/conectar', {})).status, 200);
  await agent.get('/client/social/retorno/facebook?session=tok-qualquer');
  const antes = chamadas.filter((c) => /finalize$/.test(c.caminho)).length;
  const r = await agent.post('/api/client/social-accounts/pendente', { pageIds: ['a', 'b'] });
  assert.equal(r.status, 403);
  assert.match(r.body.error, /no máximo 1 página/);
  assert.equal(chamadas.filter((c) => /finalize$/.test(c.caminho)).length, antes);
});

test('trocou pra um plano menor: as contas além do limite ficam com a fila parada, nada é apagado', async () => {
  const { u, agent } = await logado('pro');
  const antiga = await contaSocial(u.id, 'instagram', { minutosAtras: 60 });
  const nova = await contaSocial(u.id, 'instagram', { minutosAtras: 1 });
  for (const c of [antiga, nova]) {
    await pool.query(
      `INSERT INTO social_postings (client_user_id, social_account_id, clip_id, caption, status, scheduled_for)
       VALUES ($1, $2, $3, 'x', 'pending', now() - interval '1 minute')`,
      [u.id, c.id, await corte(u.id)]
    );
  }
  await darPlano(u.id, 'starter');

  const lista = (await agent.get('/api/client/social-accounts')).body.contas;
  assert.equal(lista.find((c) => c.id === antiga.id).foraDoPlano, false, 'a mais antiga continua valendo');
  assert.equal(lista.find((c) => c.id === nova.id).foraDoPlano, true);

  const publicam = (await socialPostingsRepository.contasQuePublicamSozinhas()).map((c) => Number(c.id));
  assert.ok(publicam.includes(antiga.id));
  assert.ok(!publicam.includes(nova.id), 'a fila da conta fora do plano não anda');

  const { rows } = await pool.query('SELECT id FROM social_postings WHERE social_account_id = $1', [nova.id]);
  const r = await agent.post(`/api/client/social-postings/${rows[0].id}/postar-agora`, {});
  assert.equal(r.status, 403, '"Postar agora" também não fura o limite');

  // Voltou pro plano maior: libera na hora.
  await darPlano(u.id, 'pro');
  const depois = (await socialPostingsRepository.contasQuePublicamSozinhas()).map((c) => Number(c.id));
  assert.ok(depois.includes(nova.id));
});

// ---------------------------------------------------------------- lives

async function canal({ aoVivo = true } = {}) {
  const c = await livesRepository.upsertChannel({ login: `lim_${uid()}`, displayName: 'Canal', platformUserId: '1', profileImageUrl: null });
  await pool.query("UPDATE live_channels SET is_live = $2, live_started_at = now(), last_checked_at = now() + interval '1 hour' WHERE id = $1", [c.id, aoVivo]);
  return Number(c.id);
}

test('lives: os números de cada plano (1 / 2 / 3 canais), e o limite barra ao acompanhar um canal novo', async () => {
  const caso = async (plano, n) => planLimitsService.checkLiveChannelLimit((await cliente(plano)).id, n);
  assert.equal((await caso('starter', 1)).allowed, false);
  assert.equal((await caso('pro', 1)).allowed, true);
  assert.equal((await caso('pro', 2)).allowed, false);
  assert.equal((await caso('max', 2)).allowed, true);
  assert.equal((await caso('max', 3)).allowed, false);
  assert.equal((await caso(null, 0)).allowed, false);
});

test('lives: 1 por vez - com dois canais ao vivo, só um é clipado; quando ele acaba, o outro começa sozinho', async () => {
  const u = await cliente('pro');
  const a = await canal();
  const b = await canal();
  await livesRepository.follow(u.id, a);
  await livesRepository.follow(u.id, b);
  await limitesDasLivesService.recalcular();

  const recebe = async (id) => (await livesRepository.activeFollowerIds(id)).includes(Number(u.id));
  assert.equal((await recebe(a)) !== (await recebe(b)), true, 'exatamente um dos dois');
  const clipado = (await recebe(a)) ? a : b;
  const outro = clipado === a ? b : a;
  assert.equal(await livesRepository.followBlock(u.id, outro), 'outra_live');

  await livesRepository.updateChannelStatus(clipado, { isLive: false });
  await limitesDasLivesService.recalcular();
  assert.equal(await recebe(outro), true);
});

test('lives: "Clipar esta live" com a vaga ocupada por uma live JÁ sendo clipada é recusado e diz qual é', async () => {
  const { u, agent } = await logado('pro');
  const a = await canal();
  const b = await canal();
  await livesRepository.follow(u.id, a);
  await livesRepository.follow(u.id, b);
  await livesRepository.setPaused(u.id, b, true);
  const sessao = await livesRepository.createSession({ channelId: a, dirPath: 'pendente' });
  await pool.query(
    'INSERT INTO live_credit_usage (session_id, user_id, live_channel_id, paid_until_seconds, last_seen_seconds) VALUES ($1, $2, $3, 0, 0)',
    [sessao.id, u.id, a]
  );
  const r = await agent.post(`/api/client/lives/canais/${b}/clipar-esta-live`);
  assert.equal(r.status, 409);
  assert.match(r.body.error, /1 live por vez/);
  assert.equal((await livesRepository.activeFollowerIds(a)).includes(Number(u.id)), true, 'a que já estava sendo clipada continua');
  await livesRepository.endSession(sessao.id, { status: 'encerrada', motivo: 'teste' });
});

test('lives: trocou pra um plano menor - os canais além do limite param, os mais antigos continuam', async () => {
  const u = await cliente('max');
  const ids = [await canal({ aoVivo: false }), await canal({ aoVivo: false }), await canal({ aoVivo: false })];
  for (const id of ids) await livesRepository.follow(u.id, id);
  await darPlano(u.id, 'starter');
  await limitesDasLivesService.recalcular();
  assert.equal(await livesRepository.followBlock(u.id, ids[0]), null);
  assert.equal(await livesRepository.followBlock(u.id, ids[1]), 'fora_do_plano');
  assert.equal(await livesRepository.followBlock(u.id, ids[2]), 'fora_do_plano');
});

test('lives: o motivo de não gravar é guardado e só "muda" uma vez por live (registro único no painel)', async () => {
  const id = await canal();
  assert.equal(await livesRepository.setNotRecordingReason(id, 'servidor_cheio'), true);
  assert.equal(await livesRepository.setNotRecordingReason(id, 'servidor_cheio'), false);
  assert.equal(await livesRepository.setNotRecordingReason(id, null), true);
});

// ---------------------------------------------------------------- erros

test('cada ocorrência é guardada com o contexto, e segredo não entra (token, senha, URL assinada)', async () => {
  const marca = uid();
  const contexto = {
    rede: 'instagram',
    accessToken: 'abc-secreto',
    senha: '123456',
    urlDeEnvio: 'https://armazenamento.test/up/1?X-Amz-Signature=segredo&exp=1',
    tentativa: 2,
  };
  await errorReportService.report({ operation: 'outro', entityType: 'teste', error: new Error(`falhou ${marca}`), contexto });
  await errorReportService.report({ operation: 'outro', entityType: 'teste', error: new Error(`falhou ${marca}`), contexto: { ...contexto, tentativa: 3 } });

  const { erro, ocorrencias } = await ultimasOcorrencias('outro', (e) => e.message.includes(marca));
  assert.equal(erro.occurrences, 2, 'o mesmo erro continua sendo UMA linha com contador');
  assert.equal(ocorrencias.length, 2, 'mas cada vez fica guardada');
  assert.equal(ocorrencias[0].contexto.tentativa, 3, 'a mais recente primeiro');
  const texto = JSON.stringify(ocorrencias);
  assert.ok(!texto.includes('abc-secreto') && !texto.includes('123456') && !texto.includes('segredo'));
  assert.equal(ocorrencias[0].contexto.accessToken, '[omitido]');
  assert.match(ocorrencias[0].contexto.urlDeEnvio, /\?\[parametros omitidos\]$/);
});

test('conexão: voltar da autorização sem sessão é registrado com a etapa e os parâmetros (token omitido)', async () => {
  const { u, agent } = await logado('starter');
  await agent.get('/client/social/retorno/instagram?error=access_denied&session=tok-secreto');
  const ocorrencias = await ocorrenciasDoCliente('social_conexao', u.id);
  assert.ok(ocorrencias.length >= 1);
  const c = ocorrencias[0].contexto;
  assert.equal(c.rede, 'instagram');
  assert.equal(c.etapa, 'voltar');
  assert.equal(c.parametros.error, 'access_denied');
  assert.equal(c.parametros.session, '[omitido]');
});

test('TikTok: a pessoa cancelar a autorização também fica registrado', async () => {
  const { u, agent } = await logado('starter');
  await agent.get('/auth/tiktok/callback?error=access_denied&error_description=User+canceled');
  const ocorrencias = await ocorrenciasDoCliente('tiktok_conexao', u.id);
  assert.ok(ocorrencias.length >= 1);
  assert.equal(ocorrencias[0].contexto.etapa, 'autorizar');
  assert.equal(ocorrencias[0].contexto.erroDaTiktok, 'access_denied');
});

test('publicação: falha passageira (que vai tentar de novo sozinha) é registrada com etapa e resposta crua da rede', async () => {
  const u = await cliente('max');
  const conta = await contaSocial(u.id, 'instagram');
  const { rows: p } = await pool.query(
    `INSERT INTO social_postings (client_user_id, social_account_id, clip_id, caption, status, scheduled_for, ignora_limite_diario)
     VALUES ($1, $2, $3, 'legenda', 'pending', now() - interval '1 minute', true) RETURNING id`,
    [u.id, conta.id, await corte(u.id)]
  );
  falharEnvioDeMidia = true;
  try {
    await socialPostingService.publicarVencidos();
  } finally {
    falharEnvioDeMidia = false;
  }
  const { rows: depois } = await pool.query('SELECT status FROM social_postings WHERE id = $1', [p[0].id]);
  assert.equal(depois[0].status, 'pending', 'falha passageira volta pra fila');

  const { ocorrencias } = await ultimasOcorrencias('social_posting', (e) => Number(e.entity_id) === Number(p[0].id));
  assert.ok(ocorrencias.length >= 1, 'mesmo tentando de novo sozinha, a falha é registrada');
  const ctx = ocorrencias[0].contexto;
  assert.equal(ctx.rede, 'instagram');
  assert.equal(ctx.etapa, 'pedir_url_de_envio');
  assert.equal(ctx.falhaPassageira, true);
  assert.equal(ctx.arquivoBytes, 5);
  assert.equal(ctx.erro.status, 503);
  assert.match(ctx.erro.resposta, /armazenamento indisponivel agora/);
});

test('erro 500 em qualquer rota (não só nas em teste) vai pro painel, com método e rota mas sem o corpo', async () => {
  const marca = uid();
  const req = {
    method: 'POST',
    path: '/api/client/billing/123/qualquer',
    originalUrl: '/api/client/billing/123/qualquer?x=1',
    query: { x: '1' },
    body: { senha: 'nao-pode-aparecer', valor: 10 },
    session: { user: { id: null, role: 'client' } },
    get: () => 'navegador-de-teste',
  };
  const res = { status: () => res, json: () => res, render: () => res };
  errorHandler(new Error(`quebrou ${marca}`), req, res, () => {});
  await new Promise((r) => setTimeout(r, 200));
  const { erro, ocorrencias } = await ultimasOcorrencias('erro_servidor', (e) => e.message.includes(marca));
  assert.ok(erro);
  assert.match(erro.message, /\/api\/client\/billing\/:id\/qualquer/);
  assert.deepEqual(ocorrencias[0].contexto.camposEnviados, ['senha', 'valor']);
  assert.ok(!JSON.stringify(ocorrencias[0]).includes('nao-pode-aparecer'));
});
