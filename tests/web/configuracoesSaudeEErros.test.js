// Pedidos de 12/10/2026: exclusão da própria conta, conferência das contas das
// redes sociais, encerramento automático da Flora, log de erros separado pras
// novidades em teste, e as correções achadas nos logs de produção (escolha de
// cortes que vinha fora do formato, e a rajada de posts no TikTok que fez a
// conta de um cliente ser marcada como spam).
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const pool = require('../../src/db/pool');
const config = require('../../src/config');
const settingsRepository = require('../../src/repositories/settingsRepository');
const socialAccountsRepository = require('../../src/repositories/socialAccountsRepository');
const socialPostingsRepository = require('../../src/repositories/socialPostingsRepository');
const systemErrorsRepository = require('../../src/repositories/systemErrorsRepository');
const supportRepository = require('../../src/repositories/supportRepository');
const errorReportService = require('../../src/services/errorReportService');
const saudeDasContasSociaisService = require('../../src/services/saudeDasContasSociaisService');
const suporteService = require('../../src/services/suporte/suporteService');
const claude = require('../../src/services/claudeClipSelectionService');
const tiktokPostingJob = require('../../src/worker/jobs/tiktokPostingJob');
const painelNovo = require('../../src/lib/painelNovo');
const { startServer, stopServer, createLoginableClient, createAgent } = require('../helpers/http');
const { comAsaasFalso } = require('../helpers/asaasFalso');

let url;
let outstand;
const respostaDaConta = new Map(); // outstand id -> { status, body }

test.before(async () => {
  outstand = http.createServer((req, res) => {
    req.on('data', () => {});
    req.on('end', () => {
      const m = req.url.match(/^\/v1\/social-accounts\/([^/]+)\/metrics/);
      const r = (m && respostaDaConta.get(m[1])) || { status: 200, body: { success: true, data: {} } };
      if (req.method === 'DELETE') return res.writeHead(200).end('{"success":true}');
      res.writeHead(r.status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(r.body));
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
});

let n = 0;
const uid = () => `${process.pid}_${Date.now().toString(36)}_${n++}`;

async function logado({ noPainelNovo = true, role = 'client' } = {}) {
  const u = await createLoginableClient({ role });
  if (noPainelNovo && role === 'client') {
    const atuais = await painelNovo.idsLiberados();
    await settingsRepository.setValue(painelNovo.CHAVE, [...atuais, Number(u.id)]);
  }
  const agent = createAgent(url);
  await agent.login(u.email, u.password);
  return { u, agent };
}

async function contaSocial(userId, network = 'instagram') {
  const { rows } = await pool.query(
    `INSERT INTO social_accounts (client_user_id, network, outstand_account_id, username, display_name)
     VALUES ($1, $2, $3, 'perfil', 'Perfil') RETURNING *`,
    [userId, network, `acc_${uid()}`]
  );
  return rows[0];
}

// ---------------------------------------------------------------------------
// Escolha de cortes: a IA às vezes devolve a lista como TEXTO

test('escolha de cortes aceita a lista vinda como texto e tenta de novo quando vem quebrada', async () => {
  assert.deepEqual(claude.listaDaFerramenta({ clips: '[{"title":"a"}]' }, 'clips'), [{ title: 'a' }]);
  assert.deepEqual(claude.listaDaFerramenta({ clips: { clips: [{ title: 'b' }] } }, 'clips'), [{ title: 'b' }]);
  assert.equal(claude.listaDaFerramenta({ clips: 'isso não é json' }, 'clips'), null);

  const original = global.fetch;
  let chamadas = 0;
  global.fetch = async () => {
    chamadas += 1;
    const input = chamadas === 1 ? { clips: 'quebrado' } : { clips: [{ title: 'T', description: 'D', startSeconds: 1, endSeconds: 40 }] };
    return { ok: true, json: async () => ({ content: [{ type: 'tool_use', input }], usage: { input_tokens: 10, output_tokens: 5 } }) };
  };
  try {
    const r = await claude.selectClips([{ word: 'oi', start: 0, end: 60 }]);
    assert.equal(chamadas, 2, 'perguntou de novo uma vez');
    assert.equal(r.clips.length, 1);
    assert.equal(r.inputTokens, 20, 'soma o custo das duas chamadas');

    chamadas = 0;
    global.fetch = async () => {
      chamadas += 1;
      return { ok: true, json: async () => ({ content: [{ type: 'tool_use', input: { clips: 42 } }], usage: {} }) };
    };
    await assert.rejects(() => claude.selectClips([{ word: 'oi', start: 0, end: 60 }]), /incompleta ou inválida/);
    assert.equal(chamadas, 2, 'desiste depois da segunda');
  } finally {
    global.fetch = original;
  }
});

// ---------------------------------------------------------------------------
// TikTok: limite em 24 horas corridas e nada de rajada de atrasados

async function contaTiktok(userId, porDia) {
  const { rows } = await pool.query(
    `INSERT INTO tiktok_accounts (client_user_id, tiktok_open_id, token_expires_at, display_name, access_token_encrypted, refresh_token_encrypted, auto_post_enabled)
     VALUES ($1, $2, now() + interval '1 day', 'Conta', 'x', 'x', true) RETURNING *`,
    [userId, `open_${uid()}`]
  );
  await pool.query(
    `INSERT INTO posting_schedule_settings (tiktok_account_id, mode, videos_per_day, manual_times, timezone) VALUES ($1, 'auto', $2, '{}', 'America/Sao_Paulo')`,
    [rows[0].id, porDia]
  );
  return rows[0];
}

async function postagem(userId, contaId, { status = 'pending', scheduledFor = null, queuedAt = null } = {}) {
  const { rows: sv } = await pool.query(
    `INSERT INTO source_videos (input_type, client_user_id, owner_client_user_id, youtube_video_id, title, status)
     VALUES ('manual', $1, $1, $2, 'V', 'ready') RETURNING id`,
    [userId, `yt_${uid()}`]
  );
  const { rows: c } = await pool.query(
    `INSERT INTO clips (source_video_id, title, start_seconds, end_seconds, status, local_clip_path) VALUES ($1, 'C', 0, 30, 'ready', '/tmp/x.mp4') RETURNING id`,
    [sv[0].id]
  );
  const { rows: v } = await pool.query(
    `INSERT INTO videos (source_type, clip_id, filename, mime_type) VALUES ('youtube_clip', $1, 'c', 'video/mp4') RETURNING id`,
    [c[0].id]
  );
  const { rows } = await pool.query(
    `INSERT INTO postings (video_id, tiktok_account_id, status, scheduled_for, queued_at, posted_at)
     VALUES ($1, $2, $3, $4, $5::timestamptz, CASE WHEN $3 = 'posted' THEN $5::timestamptz ELSE NULL END) RETURNING *`,
    [v[0].id, contaId, status, scheduledFor, queuedAt]
  );
  return rows[0];
}

test('TikTok: o "por dia" vale em 24 horas corridas, não só no dia do calendário', async () => {
  const u = await createLoginableClient();
  const conta = await contaTiktok(u.id, 2);
  // Duas publicações ONTEM, nos minutos antes da meia-noite de Brasília: pelo
  // dia do calendário hoje está zerado, mas pelas últimas 23 h não. É
  // exatamente o caso da rajada logo depois da meia-noite.
  const { rows: m } = await pool.query(
    `SELECT (date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo') AS meia_noite`
  );
  const meiaNoite = new Date(m[0].meia_noite);
  if (Date.now() - meiaNoite.getTime() > 22.9 * 3600e3) return; // fim da noite: a janela não distingue
  await postagem(u.id, conta.id, { status: 'posted', queuedAt: new Date(meiaNoite.getTime() - 2 * 60e3) });
  await postagem(u.id, conta.id, { status: 'posted', queuedAt: new Date(meiaNoite.getTime() - 1 * 60e3) });
  await postagem(u.id, conta.id, { scheduledFor: new Date(Date.now() - 60e3) });
  const publicados = [];
  await tiktokPostingJob.maybePublishNext(conta, { publicar: async (_a, p) => publicados.push(p.id) });
  assert.equal(publicados.length, 0, 'já bateu 2 nas últimas 23 horas');
});

test('TikTok: corte que perdeu o horário há horas é remarcado em vez de sair fora de hora', async () => {
  const u = await createLoginableClient();
  const conta = await contaTiktok(u.id, 4);
  const atrasada = await postagem(u.id, conta.id, { scheduledFor: new Date(Date.now() - 5 * 3600e3) });
  const publicados = [];
  await tiktokPostingJob.maybePublishNext(conta, { publicar: async (_a, p) => publicados.push(p.id) });
  assert.equal(publicados.length, 0);
  const { rows } = await pool.query('SELECT scheduled_for FROM postings WHERE id = $1', [atrasada.id]);
  assert.ok(new Date(rows[0].scheduled_for) > new Date(), 'remarcada pra um horário futuro');

  // Atraso pequeno (a rotina roda de 10 em 10 min) sai normalmente.
  const conta2 = await contaTiktok(u.id, 4);
  await postagem(u.id, conta2.id, { scheduledFor: new Date(Date.now() - 5 * 60e3) });
  await tiktokPostingJob.maybePublishNext(conta2, { publicar: async (_a, p) => publicados.push(p.id) });
  assert.equal(publicados.length, 1);
});

test('TikTok: "Postar agora" recusa quando a conta já publicou 10 vezes em 24 horas', async () => {
  const { u, agent } = await logado();
  const conta = await contaTiktok(u.id, 10);
  for (let i = 0; i < 10; i++) await postagem(u.id, conta.id, { status: 'posted', queuedAt: new Date(Date.now() - (i + 1) * 3600e3) });
  const p = await postagem(u.id, conta.id, { scheduledFor: new Date(Date.now() + 3600e3) });
  const r = await agent.post(`/api/client/postings/${p.id}/post-now`, {});
  assert.equal(r.status, 429);
  assert.match(r.body.error, /24 horas/);
  const { rows } = await pool.query('SELECT status FROM postings WHERE id = $1', [p.id]);
  assert.equal(rows[0].status, 'pending', 'continua na fila');
});

// ---------------------------------------------------------------------------
// Contas das redes: pedir reconexão ANTES de um corte falhar

test('conta com autorização cancelada fica marcada, a fila dela espera, e reconectar limpa', async () => {
  const { u, agent } = await logado();
  const conta = await contaSocial(u.id);
  respostaDaConta.set(conta.outstand_account_id, {
    status: 400,
    body: { success: false, error: 'Error validating access token: The session has been invalidated because the user changed their password' },
  });

  const r = await agent.post(`/api/client/social-accounts/${conta.id}/testar`, {});
  assert.equal(r.status, 200);
  assert.equal(r.body.resultado, 'reconectar');
  assert.equal(r.body.conta.precisaReconectar, true);

  // A fila da conta marcada não é chamada pra publicar.
  await pool.query(
    `INSERT INTO social_postings (client_user_id, social_account_id, clip_id, status, scheduled_for)
     SELECT $1, $2, c.id, 'pending', now() - interval '1 minute' FROM clips c LIMIT 1`,
    [u.id, conta.id]
  );
  const publicaveis = await socialPostingsRepository.contasQuePublicamSozinhas();
  assert.ok(!publicaveis.some((c) => Number(c.id) === Number(conta.id)));

  // Erro que não é de autorização (rede fora do ar) NÃO marca.
  const outra = await contaSocial(u.id, 'threads');
  respostaDaConta.set(outra.outstand_account_id, { status: 502, body: { success: false, error: 'bad gateway' } });
  assert.equal(await saudeDasContasSociaisService.conferir(outra), 'indefinido');
  assert.equal((await socialAccountsRepository.findOwned(outra.id, u.id)).precisa_reconectar_em, null);

  // Reconectar (a mesma conta volta pela Outstand) limpa a marca.
  await socialAccountsRepository.upsert({ clientUserId: u.id, network: 'instagram', outstandAccountId: conta.outstand_account_id });
  assert.equal((await socialAccountsRepository.findOwned(conta.id, u.id)).precisa_reconectar_em, null);

  // Conta de outro cliente não pode ser testada por este.
  const outro = await logado();
  assert.equal((await outro.agent.post(`/api/client/social-accounts/${conta.id}/testar`, {})).status, 404);

  // O aviso vai pro log de erros EM TESTE, não pro principal.
  const emTeste = await systemErrorsRepository.list({ grupo: 'teste', status: 'todos' });
  assert.ok(emTeste.some((e) => e.operation === 'social_conta' && Number(e.entity_id) === Number(conta.id)));
  const principal = await systemErrorsRepository.list({ grupo: 'principal', status: 'todos' });
  assert.ok(!principal.some((e) => e.operation === 'social_conta'));
});

// ---------------------------------------------------------------------------
// Log de erros separado

test('erros das novidades em teste vão pra lista própria; os de sempre continuam na principal', async () => {
  assert.deepEqual([...systemErrorsRepository.OPERACOES_EM_TESTE].sort(), [...errorReportService.OPERACOES_EM_TESTE].sort());

  await errorReportService.report({ operation: 'tiktok_posting', entityType: 'posting', entityId: 999001, error: new Error(`principal ${uid()}`) });
  await errorReportService.report({ operation: 'social_posting', entityType: 'social_posting', entityId: 999002, error: new Error(`teste ${uid()}`) });

  const admin = await logado({ role: 'admin' });
  const principal = await admin.agent.get('/api/admin/errors?status=todos');
  const emTeste = await admin.agent.get('/api/admin/errors?status=todos&grupo=teste');
  assert.ok(principal.body.errors.some((e) => e.entityId === 999001));
  assert.ok(!principal.body.errors.some((e) => e.entityId === 999002));
  assert.ok(emTeste.body.errors.some((e) => e.entityId === 999002));
  assert.ok(!emTeste.body.errors.some((e) => e.entityId === 999001));
});

test('erro de tela das páginas novas é registrado no log em teste (e só pra quem está no painel novo)', async () => {
  const { agent } = await logado();
  const marca = uid();
  const r = await agent.post('/api/client/erros-de-tela', { mensagem: `Cannot read properties of undefined ${marca}`, pagina: '/client/social?conta=1', pilha: 'at X' });
  assert.equal(r.status, 204);
  const emTeste = await systemErrorsRepository.list({ grupo: 'teste', status: 'todos' });
  const e = emTeste.find((x) => x.message.includes(marca));
  assert.ok(e);
  assert.equal(e.operation, 'painel_novo_tela');
  assert.match(e.message, /^\/client\/social: /, 'sem a parte depois do ?');

  const fora = await logado({ noPainelNovo: false });
  assert.equal((await fora.agent.post('/api/client/erros-de-tela', { mensagem: 'x' })).status, 403);
});

// ---------------------------------------------------------------------------
// Flora: encerra sozinha depois de um tempo parada

test('Flora: conversa parada há mais de 30 min se encerra e a próxima mensagem abre uma nova', async () => {
  const { u } = await logado();
  const conversa = await supportRepository.createConversation(u.id);
  await supportRepository.addMessage(conversa.id, { role: 'user', content: [{ type: 'text', text: 'oi' }], visibleText: 'oi' });
  await pool.query(`UPDATE support_conversations SET updated_at = now() - interval '45 minutes' WHERE id = $1`, [conversa.id]);

  const atual = await suporteService.conversaAtual(u.id);
  assert.equal(atual.status, 'encerrada');
  assert.equal(atual.mensagens.length, 1, 'o histórico continua visível');

  // Quem NÃO está no painel novo segue como antes.
  const fora = await createLoginableClient();
  const c2 = await supportRepository.createConversation(fora.id);
  await pool.query(`UPDATE support_conversations SET updated_at = now() - interval '45 minutes' WHERE id = $1`, [c2.id]);
  assert.equal((await suporteService.conversaAtual(fora.id)).status, 'aberta');

  // Conversa encaminhada pra equipe nunca se encerra sozinha.
  const c3 = await supportRepository.createConversation(u.id);
  await pool.query(`UPDATE support_conversations SET status = 'encaminhada', updated_at = now() - interval '5 hours' WHERE id = $1`, [c3.id]);
  await suporteService.encerrarConversasParadas();
  const { rows } = await pool.query('SELECT status FROM support_conversations WHERE id = $1', [c3.id]);
  assert.equal(rows[0].status, 'encaminhada');
});

// ---------------------------------------------------------------------------
// Exclusão da própria conta

test('excluir conta: cancela a assinatura antes, apaga o conteúdo, anonimiza e mantém o pagamento', async () => {
  const { u, agent } = await logado();
  await pool.query(
    `INSERT INTO youtube_channels (client_user_id, youtube_channel_id, channel_url, channel_name) VALUES ($1, $2, 'https://youtube.com/@x', 'Canal')`,
    [u.id, `UC_${uid()}`]
  );
  await contaSocial(u.id);
  await pool.query(
    `INSERT INTO client_subscriptions (client_user_id, status, asaas_subscription_id, asaas_card_token) VALUES ($1, 'ativo', $2, 'tok_secreto')
     ON CONFLICT (client_user_id) DO UPDATE SET status = 'ativo', asaas_subscription_id = $2, asaas_card_token = 'tok_secreto'`,
    [u.id, `sub_${uid()}`]
  );
  await pool.query(
    `INSERT INTO revenue_entries (client_user_id, provider, external_id, kind, amount_cents, paid_at) VALUES ($1, 'asaas', $2, 'recorrencia', 9990, now())`,
    [u.id, `pay_${uid()}`]
  );
  await pool.query('UPDATE users SET cpf_cnpj = $2 WHERE id = $1', [u.id, '12345678909']);

  // Senha errada e confirmação faltando: nada acontece.
  assert.equal((await agent.request('DELETE', '/api/client/conta', { confirmacao: 'EXCLUIR', senha: 'errada' })).status, 400);
  assert.equal((await agent.request('DELETE', '/api/client/conta', { confirmacao: 'sim', senha: u.password })).status, 400);

  // Asaas fora do ar: nada é excluído.
  await comAsaasFalso({ 'DELETE /subscriptions/:id': () => ({ status: 500, body: { errors: [{ description: 'fora' }] } }) }, async () => {
    const r = await agent.request('DELETE', '/api/client/conta', { confirmacao: 'EXCLUIR', senha: u.password });
    assert.equal(r.status, 502);
  });
  assert.equal((await pool.query('SELECT deleted_at FROM users WHERE id = $1', [u.id])).rows[0].deleted_at, null);
  assert.equal((await pool.query('SELECT count(*)::int n FROM youtube_channels WHERE client_user_id = $1', [u.id])).rows[0].n, 1);

  await comAsaasFalso({ 'DELETE /subscriptions/:id': () => ({ body: { deleted: true } }) }, async (chamadas) => {
    const r = await agent.request('DELETE', '/api/client/conta', { confirmacao: 'excluir', senha: u.password });
    assert.equal(r.status, 200);
    assert.ok(chamadas.some((c) => c.metodo === 'DELETE' && c.caminho.startsWith('/subscriptions/')));
  });

  const { rows: usuario } = await pool.query('SELECT * FROM users WHERE id = $1', [u.id]);
  assert.ok(usuario[0].deleted_at);
  assert.notEqual(usuario[0].email, u.email);
  assert.equal(usuario[0].cpf_cnpj, null);
  assert.equal(usuario[0].password_hash, null);
  assert.equal((await pool.query('SELECT count(*)::int n FROM youtube_channels WHERE client_user_id = $1', [u.id])).rows[0].n, 0);
  assert.equal((await pool.query('SELECT count(*)::int n FROM social_accounts WHERE client_user_id = $1', [u.id])).rows[0].n, 0);
  assert.equal((await pool.query('SELECT asaas_card_token FROM client_subscriptions WHERE client_user_id = $1', [u.id])).rows[0].asaas_card_token, null);
  assert.equal((await pool.query('SELECT count(*)::int n FROM revenue_entries WHERE client_user_id = $1', [u.id])).rows[0].n, 1, 'registro de pagamento fica');

  // A sessão acabou e o login antigo não entra mais.
  assert.equal((await agent.get('/api/auth/me')).status, 401);
  const novo = createAgent(url);
  const login = await novo.request('POST', '/api/auth/login', { email: u.email, password: u.password });
  assert.notEqual(login.status, 200);
});

test('excluir conta: admin não se exclui por aqui, e quem não está no painel novo não tem a rota', async () => {
  const admin = await logado({ role: 'admin' });
  assert.equal((await admin.agent.request('DELETE', '/api/client/conta', { confirmacao: 'EXCLUIR', senha: admin.u.password })).status, 403);
  const fora = await logado({ noPainelNovo: false });
  assert.equal((await fora.agent.request('DELETE', '/api/client/conta', { confirmacao: 'EXCLUIR', senha: fora.u.password })).status, 403);
});
