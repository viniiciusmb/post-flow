// Entrar com Google.
//
// Este é um caminho de autenticação: quem passa por aqui entra numa conta. Os
// testes abaixo cobrem as três decisões que, se estiverem erradas, deixam
// alguém entrar na conta de outra pessoa:
//
//   1. e-mail não confirmado pelo Google não pode ligar a conta;
//   2. quem identifica é o `sub`, não o e-mail (e-mail de conta Google muda);
//   3. o `state` amarra o retorno ao navegador que começou o pedido.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const pool = require('../../src/db/pool');
const usersRepository = require('../../src/repositories/usersRepository');
const googleService = require('../../src/services/googleService');
const { startServer, stopServer, createAgent } = require('../helpers/http');

let baseUrl;

test.before(async () => {
  baseUrl = await startServer();
});

test.after(async () => {
  await stopServer();
  await pool.end();
});

// Troca as chamadas ao Google por respostas controladas. Bater no Google de
// verdade deixaria o teste dependente de credencial e de rede.
function comGoogle(perfil, fn) {
  const trocaOriginal = googleService.exchangeLoginCode;
  const perfilOriginal = googleService.getLoginProfile;
  googleService.exchangeLoginCode = async () => ({ access_token: 'token-de-mentira' });
  googleService.getLoginProfile = async () => perfil;
  return fn().finally(() => {
    googleService.exchangeLoginCode = trocaOriginal;
    googleService.getLoginProfile = perfilOriginal;
  });
}

// Faz o caminho inteiro: pede o login (pra ganhar o state na sessão), lê o
// state que foi guardado e volta no callback com ele.
async function entrarComGoogle(perfil) {
  const agente = createAgent(baseUrl);
  await agente.get('/auth/google/login');

  const { rows } = await pool.query(
    "SELECT sess FROM session WHERE sess::text LIKE '%googleLoginState%' ORDER BY expire DESC LIMIT 1"
  );
  const state = rows[0]?.sess?.googleLoginState;
  assert.ok(state, 'o pedido de login precisa guardar um state na sessão');

  const r = await comGoogle(perfil, () => agente.get(`/auth/google/login/callback?code=abc&state=${state}`));
  return { agente, resposta: r };
}

const sufixo = () => `${Date.now()}${Math.floor(Math.random() * 1000)}`;

test('primeira vez com Google cria a conta e já entra', async () => {
  const email = `novo${sufixo()}@teste.local`;
  const { agente, resposta } = await entrarComGoogle({
    sub: `sub-${sufixo()}`,
    email,
    emailVerified: true,
    name: 'Fulano',
  });

  assert.equal(resposta.status, 302);
  assert.equal(resposta.text.includes('/login?erro'), false, `não deveria voltar com erro: ${resposta.text}`);

  const criado = await usersRepository.findByEmail(email);
  assert.ok(criado, 'a conta precisa existir depois');
  assert.equal(criado.role, 'client', 'conta criada por login nunca pode nascer admin');
  assert.equal(criado.password_hash, null, 'sem senha: não há o que vazar');
  assert.ok(criado.terms_accepted_at, 'o aceite dos termos tem que ficar gravado');

  // E a sessão realmente vale.
  const me = await agente.get('/api/auth/me');
  assert.equal(me.status, 200);
});

test('e-mail NÃO confirmado pelo Google é recusado', async () => {
  const email = `naoconfirmado${sufixo()}@teste.local`;
  const { resposta } = await entrarComGoogle({
    sub: `sub-${sufixo()}`,
    email,
    emailVerified: false,
    name: 'Suspeito',
  });

  assert.ok(resposta.text.includes('/login?erro'), 'tem que voltar pro login com erro');
  assert.equal(await usersRepository.findByEmail(email), null, 'não pode ter criado conta nenhuma');
});

test('quem já tem conta com senha passa a poder entrar pelo Google, sem virar conta nova', async () => {
  const email = `existente${sufixo()}@teste.local`;
  const antes = await usersRepository.create({
    email,
    passwordHash: 'hash-existente',
    role: 'client',
    businessName: 'Empresa',
  });

  const sub = `sub-${sufixo()}`;
  await entrarComGoogle({ sub, email, emailVerified: true, name: 'Fulano' });

  const depois = await usersRepository.findByGoogleSub(sub);
  assert.ok(depois, 'a conta Google tem que ficar ligada');
  assert.equal(Number(depois.id), Number(antes.id), 'tem que ser a MESMA conta, não uma nova');
  assert.equal(depois.password_hash, 'hash-existente', 'a senha que já existia continua valendo');

  const { rows } = await pool.query('SELECT count(*)::int AS n FROM users WHERE email = $1', [email]);
  assert.equal(rows[0].n, 1, 'não pode existir conta duplicada com o mesmo e-mail');
});

test('e-mail da conta Google mudou: continua entrando na mesma conta', async () => {
  const sub = `sub-${sufixo()}`;
  const emailAntigo = `antigo${sufixo()}@teste.local`;
  await entrarComGoogle({ sub, email: emailAntigo, emailVerified: true, name: 'Fulano' });
  const original = await usersRepository.findByGoogleSub(sub);

  // Mesma pessoa, mesmo `sub`, e-mail novo. Se a identificação fosse pelo
  // e-mail, isto não acharia a conta: ou criaria uma segunda (e a pessoa
  // perderia tudo), ou esbarraria no índice único e devolveria erro.
  const { agente, resposta } = await entrarComGoogle({
    sub,
    email: `novo${sufixo()}@teste.local`,
    emailVerified: true,
    name: 'Fulano',
  });
  assert.equal(resposta.text.includes('/login?erro'), false, `a entrada tem que dar certo: ${resposta.text}`);

  const me = await agente.get('/api/auth/me');
  assert.equal(me.status, 200, 'a pessoa precisa entrar de verdade');
  assert.equal(Number(me.body.user.id), Number(original.id), 'tem que ser a MESMA conta de antes');

  const { rows } = await pool.query('SELECT count(*)::int AS n FROM users WHERE google_sub = $1', [sub]);
  assert.equal(rows[0].n, 1, 'não pode ter criado uma segunda conta');
});

test('conta desativada não entra pelo Google', async () => {
  const email = `desativado${sufixo()}@teste.local`;
  const user = await usersRepository.create({ email, passwordHash: 'x', role: 'client' });
  await pool.query('UPDATE users SET is_active = false WHERE id = $1', [user.id]);

  const { resposta } = await entrarComGoogle({
    sub: `sub-${sufixo()}`,
    email,
    emailVerified: true,
    name: 'Fulano',
  });
  assert.ok(resposta.text.includes('/login?erro'));
});

test('retorno sem state válido é recusado', async () => {
  const agente = createAgent(baseUrl);
  await agente.get('/auth/google/login');

  // É assim que um site de terceiro tentaria: mandar o navegador direto pro
  // callback com um code qualquer, sem o state que saiu daqui.
  const r = await comGoogle({ sub: 'sub-invasor', email: 'invasor@teste.local', emailVerified: true }, () =>
    agente.get('/auth/google/login/callback?code=abc&state=inventado')
  );
  assert.ok(r.text.includes('/login?erro'));
  assert.equal(await usersRepository.findByGoogleSub('sub-invasor'), null);
});

test('a rota de login com Google é pública (quem entra ainda não tem sessão)', async () => {
  const anonimo = createAgent(baseUrl);
  const r = await anonimo.get('/auth/google/login');
  assert.equal(r.status, 302);
  assert.ok(r.text.includes('accounts.google.com'), `deveria mandar pro Google: ${r.text}`);
});

test('o endereço de retorno do login é diferente do endereço do Drive', async () => {
  // São dois consentimentos com escopos diferentes. Compartilhar o mesmo
  // endereço faria um handler ter que adivinhar de qual fluxo é o retorno.
  assert.notEqual(googleService.loginRedirectUri(), require('../../src/config').google.redirectUri);
  assert.match(googleService.loginRedirectUri(), /\/auth\/google\/login\/callback$/);
});

test('o login só pede identidade, nunca acesso a arquivo', async () => {
  const url = googleService.buildLoginUrl('estado');
  const scope = new URL(url).searchParams.get('scope');
  assert.equal(scope, 'openid email profile');
  assert.ok(!scope.includes('drive'), 'entrar não pode pedir acesso ao Drive');
});
