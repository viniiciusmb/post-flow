// Recuperação de senha.
//
// É o único fluxo do sistema que troca a senha de alguém SEM exigir a senha
// antiga, então cada garantia aqui é o que separa "cliente esqueceu a senha" de
// "qualquer um entra na conta de qualquer um". Os testes cobrem exatamente
// isso: uso único, expiração, token nunca em texto no banco, e o formulário não
// servir de lista de quem é cliente.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const pool = require('../../src/db/pool');
const tokensRepository = require('../../src/repositories/passwordResetTokensRepository');
const { startServer, stopServer, createLoginableClient, createAgent } = require('../helpers/http');

let baseUrl;

test.before(async () => {
  baseUrl = await startServer();
});

test.after(async () => {
  await stopServer();
  await pool.end();
});

// As telas sao React e falam com a API por JSON, sem sessao (quem esqueceu a
// senha nao esta logado).
async function postJson(caminho, corpo) {
  const response = await fetch(`${baseUrl}${caminho}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(corpo),
    redirect: 'manual',
  });
  const texto = await response.text();
  let json = null;
  try {
    json = JSON.parse(texto);
  } catch {
    /* resposta sem corpo JSON */
  }
  return { status: response.status, body: json, text: texto };
}

const pedirLink = (email) => postJson('/api/auth/forgot-password', { email });
const trocarSenha = (token, password) => postJson('/api/auth/reset-password', { token, password });

test('o banco guarda o hash do token, nunca o token em si', async () => {
  const user = await createLoginableClient();
  const { token } = await tokensRepository.create(user.id);

  const { rows } = await pool.query('SELECT token_hash FROM password_reset_tokens WHERE user_id = $1', [
    user.id,
  ]);
  assert.equal(rows.length, 1);
  assert.notEqual(rows[0].token_hash, token, 'o token não pode estar em texto no banco');
  assert.equal(rows[0].token_hash, crypto.createHash('sha256').update(token).digest('hex'));
});

test('pedir um link novo invalida o anterior', async () => {
  const user = await createLoginableClient();
  const primeiro = await tokensRepository.create(user.id);
  const segundo = await tokensRepository.create(user.id);

  assert.equal(await tokensRepository.findValidUser(primeiro.token), null);
  assert.ok(await tokensRepository.findValidUser(segundo.token));
});

test('token expirado não vale', async () => {
  const user = await createLoginableClient();
  const { token } = await tokensRepository.create(user.id);
  await pool.query(
    "UPDATE password_reset_tokens SET expires_at = now() - interval '1 minute' WHERE user_id = $1",
    [user.id]
  );
  assert.equal(await tokensRepository.findValidUser(token), null);
});

test('cliente desativado não consegue redefinir a senha', async () => {
  const user = await createLoginableClient();
  const { token } = await tokensRepository.create(user.id);
  await pool.query('UPDATE users SET is_active = false WHERE id = $1', [user.id]);
  assert.equal(await tokensRepository.findValidUser(token), null);
});

test('o link troca a senha de verdade e só funciona uma vez', async () => {
  const user = await createLoginableClient();
  const { token } = await tokensRepository.create(user.id);

  const primeira = await trocarSenha(token, 'senha-nova-do-cliente');
  assert.equal(primeira.status, 200);

  const { rows } = await pool.query('SELECT password_hash FROM users WHERE id = $1', [user.id]);
  assert.ok(
    await bcrypt.compare('senha-nova-do-cliente', rows[0].password_hash),
    'a senha nova tem que valer'
  );
  assert.ok(
    !(await bcrypt.compare(user.password, rows[0].password_hash)),
    'a senha antiga tem que parar de valer'
  );

  // Reutilizar o mesmo link (e-mail encaminhado, histórico do navegador) não
  // pode trocar a senha de novo.
  const segunda = await trocarSenha(token, 'tentativa-de-reuso-12345');
  assert.equal(segunda.status, 400);
  const depois = await pool.query('SELECT password_hash FROM users WHERE id = $1', [user.id]);
  assert.ok(
    await bcrypt.compare('senha-nova-do-cliente', depois.rows[0].password_hash),
    'o reuso não pode ter trocado a senha'
  );
});

test('trocar a senha derruba as sessões abertas dessa conta', async () => {
  const user = await createLoginableClient();
  const agente = createAgent(baseUrl);
  await agente.login(user.email, user.password);
  assert.equal((await agente.get('/api/auth/me')).status, 200, 'sessão deveria estar valendo');

  const { token } = await tokensRepository.create(user.id);
  await trocarSenha(token, 'outra-senha-boa-4321');

  const depois = await agente.get('/api/auth/me');
  assert.notEqual(depois.status, 200, 'quem estava logado com a senha antiga tem que cair');
});

test('token inventado é recusado', async () => {
  const r = await trocarSenha(crypto.randomBytes(32).toString('base64url'), 'senha-qualquer-123');
  assert.equal(r.status, 400);
  // expired: true e o que faz a tela trocar o formulario por "peca um link
  // novo" em vez de deixar a pessoa tentando de novo no mesmo lugar.
  assert.equal(r.body.expired, true);
});

test('senha curta é recusada e o link continua valendo', async () => {
  const user = await createLoginableClient();
  const { token } = await tokensRepository.create(user.id);

  const r = await trocarSenha(token, 'curta');
  assert.equal(r.status, 400);
  assert.ok(!r.body.expired, 'senha curta não é link vencido - a tela não pode mandar pedir outro');

  // Errar a digitação não pode queimar o link: senão o cliente teria que pedir
  // outro e-mail a cada tropeço.
  assert.ok(await tokensRepository.findValidUser(token), 'o token tem que continuar valendo');
});

test('a tela consegue conferir o link antes de mostrar o formulário', async () => {
  const user = await createLoginableClient();
  const { token } = await tokensRepository.create(user.id);

  const valido = await fetch(`${baseUrl}/api/auth/reset-password?token=${encodeURIComponent(token)}`);
  assert.deepEqual(await valido.json(), { valid: true });

  const inventado = await fetch(`${baseUrl}/api/auth/reset-password?token=nao-existe`);
  assert.deepEqual(await inventado.json(), { valid: false });
});

test('o formulário não revela quem tem conta', async () => {
  const user = await createLoginableClient();

  const existe = await pedirLink(user.email);
  const naoExiste = await pedirLink(`nao-existe-${Date.now()}@teste.local`);

  assert.equal(existe.status, naoExiste.status);
  assert.equal(existe.status, 200);
  assert.deepEqual(existe.body, naoExiste.body, 'a resposta tem que ser IDÊNTICA nos dois casos');
});

test('limite de pedidos por hora, sem revelar que a conta existe', async () => {
  const user = await createLoginableClient();
  for (let i = 0; i < 5; i += 1) await tokensRepository.create(user.id);

  const r = await pedirLink(user.email);
  assert.equal(r.status, 200);
  assert.ok(r.body.message.includes('Se existir uma conta'));

  // Nenhum token novo pode ter sido criado no sexto pedido.
  const { rows } = await pool.query(
    'SELECT count(*)::int AS total FROM password_reset_tokens WHERE user_id = $1',
    [user.id]
  );
  assert.equal(rows[0].total, 5);
});
