// Registro de atividade (migration 114): cada página aberta e cada ação de
// quem usa o painel, com o resultado, pro admin acompanhar se está tudo
// funcionando. E o plano no rodapé do menu, no lugar de "Cliente".
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const pool = require('../../src/db/pool');
const { startServer, stopServer, createLoginableClient, createAgent } = require('../helpers/http');
const { darPlano } = require('../helpers/plano');

let url;

test.before(async () => {
  url = await startServer();
});

test.after(async () => {
  await stopServer();
  await pool.end();
});

async function logado({ role = 'client', plano = null } = {}) {
  const u = await createLoginableClient({ role });
  if (plano) await darPlano(u.id, plano);
  const agent = createAgent(url);
  await agent.login(u.email, u.password);
  return { u, agent };
}

// A gravação é solta (o cliente não espera por ela): espera ela aparecer.
async function atividadesDe(userId, filtro = () => true, minimo = 1) {
  for (let i = 0; i < 40; i += 1) {
    const { rows } = await pool.query('SELECT * FROM user_activity WHERE user_id = $1 ORDER BY id', [userId]);
    const achadas = rows.filter(filtro);
    if (achadas.length >= minimo) return achadas;
    await new Promise((r) => setTimeout(r, 50));
  }
  return [];
}

test('ação que deu certo: rota sem os números, resultado e tempo - e nada do que foi enviado', async () => {
  const { u, agent } = await logado();
  const r = await agent.put('/api/client/profile', { businessName: 'Nome secreto que não pode ser guardado', email: u.email });
  assert.equal(r.status, 200);
  const [a] = await atividadesDe(u.id, (x) => x.rota === '/api/client/profile');
  assert.ok(a, 'a ação foi registrada');
  assert.equal(a.tipo, 'acao');
  assert.equal(a.metodo, 'PUT');
  assert.equal(a.resultado, 'ok');
  assert.ok(a.duracao_ms >= 0);
  assert.ok(!JSON.stringify(a).includes('Nome secreto'));
});

test('ação recusada guarda a mensagem que o cliente viu', async () => {
  const { u, agent } = await logado();
  const r = await agent.put('/api/client/password', { currentPassword: 'senha-errada', newPassword: 'nova-senha-123' });
  assert.equal(r.status, 400);
  const [a] = await atividadesDe(u.id, (x) => x.rota === '/api/client/password');
  assert.equal(a.resultado, 'recusada');
  assert.equal(a.mensagem, r.body.error);
  assert.ok(!JSON.stringify(a).includes('senha-errada'), 'a senha digitada nunca entra');
});

test('página aberta é registrada; leitura da API e rota barulhenta não', async () => {
  const { u, agent } = await logado();
  assert.equal((await agent.get('/client/billing')).status, 200);
  await agent.get('/api/client/billing');
  await agent.post('/api/client/feed/vistos', { cortes: [] });
  const linhas = await atividadesDe(u.id, (x) => x.tipo === 'pagina');
  assert.equal(linhas[0].rota, '/client/billing');
  const { rows } = await pool.query('SELECT rota FROM user_activity WHERE user_id = $1', [u.id]);
  assert.ok(!rows.some((x) => x.rota === '/api/client/billing'), 'GET de API não entra');
  assert.ok(!rows.some((x) => x.rota === '/api/client/feed/vistos'), 'marcar visto no feed não entra');
});

test('id na rota vira :id e fica guardado à parte', async () => {
  const { u, agent } = await logado();
  await agent.post('/api/client/source-videos/987654/enqueue', {});
  const [a] = await atividadesDe(u.id, (x) => x.rota === '/api/client/source-videos/:id/enqueue');
  assert.ok(a);
  assert.equal(Number(a.recurso_id), 987654);
  assert.equal(a.resultado, 'recusada');
});

test('volta de conexão que não deu certo vira ação recusada, com o motivo', async () => {
  const { u, agent } = await logado({ plano: 'max' });
  await pool.query(
    `INSERT INTO settings (key, value) VALUES ('painel_novo_user_ids', $1::jsonb)
     ON CONFLICT (key) DO UPDATE SET value = settings.value || $1::jsonb`,
    [JSON.stringify([Number(u.id)])]
  );
  await agent.get('/client/social/retorno/instagram?error=access_denied');
  const [a] = await atividadesDe(u.id, (x) => x.rota === '/client/social/retorno/instagram');
  assert.equal(a.tipo, 'acao');
  assert.equal(a.resultado, 'recusada');
  assert.match(a.mensagem, /sessao/);
});

test('admin: vê funcionalidades, pessoas e a linha do tempo; cliente não abre', async () => {
  const cliente = await logado({ plano: 'starter' });
  await cliente.agent.put('/api/client/profile', { businessName: 'Loja', email: cliente.u.email });
  await atividadesDe(cliente.u.id);
  assert.equal((await cliente.agent.get('/api/admin/atividade')).status, 403);

  const admin = await logado({ role: 'admin' });
  const r = await admin.agent.get('/api/admin/atividade?range=today');
  assert.equal(r.status, 200);
  const perfil = r.body.acoes.find((a) => a.rota === '/api/client/profile');
  assert.ok(perfil, 'a ação aparece no resumo');
  assert.equal(perfil.nome, 'Mudou o perfil');
  const pessoa = r.body.pessoas.find((p) => p.id === Number(cliente.u.id));
  assert.equal(pessoa.plano, 'Starter');
  assert.ok(!r.body.pessoas.some((p) => p.id === Number(admin.u.id)), 'o admin fica de fora por padrão');
  assert.ok(Array.isArray(r.body.sistema) && r.body.sistema.length === 4);

  const linha = await admin.agent.get(`/api/admin/atividade/pessoas/${cliente.u.id}?range=today`);
  assert.ok(linha.body.eventos.some((e) => e.nome === 'Mudou o perfil'));

  const agora = await admin.agent.get('/api/admin/atividade/agora');
  assert.ok(agora.body.eventos.some((e) => e.pessoaId === Number(cliente.u.id)));
});

test('tentativa de entrar com senha errada é registrada sem dono e sem e-mail', async () => {
  const antes = (await pool.query("SELECT count(*)::int AS n FROM user_activity WHERE rota = '/api/auth/login' AND user_id IS NULL")).rows[0].n;
  const agent = createAgent(url);
  const r = await agent.post('/api/auth/login', { email: 'ninguem@teste.local', password: 'errada' });
  assert.ok(r.status >= 400);
  let depois = antes;
  for (let i = 0; i < 40 && depois === antes; i += 1) {
    await new Promise((res) => setTimeout(res, 50));
    depois = (await pool.query("SELECT count(*)::int AS n FROM user_activity WHERE rota = '/api/auth/login' AND user_id IS NULL")).rows[0].n;
  }
  assert.equal(depois, antes + 1);
  const { rows } = await pool.query("SELECT * FROM user_activity WHERE rota = '/api/auth/login' AND user_id IS NULL ORDER BY id DESC LIMIT 1");
  assert.ok(!JSON.stringify(rows[0]).includes('ninguem@teste.local'));
});

test('rodapé do menu: o plano do cliente no lugar de "Cliente"', async () => {
  const comPlano = await logado({ plano: 'pro' });
  assert.deepEqual((await comPlano.agent.get('/api/auth/me')).body.ui.plano, { nome: 'Pro', situacao: 'ativo' });
  const semPlano = await logado();
  assert.equal((await semPlano.agent.get('/api/auth/me')).body.ui.plano, null);
});
