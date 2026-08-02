// Paginas publicas e cadastro. Sao a porta de entrada do produto E o que o
// Google e o TikTok olham durante a revisao do app - se qualquer uma delas
// quebrar, o dono do sistema so descobre quando alguem reclama (ou quando a
// aprovacao e negada).
'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { startServer, stopServer, createAgent } = require('../helpers/http');
const { pool } = require('../helpers/db');
const { CONTACT } = require('../../src/config/constants');

let url;

test.before(async () => {
  url = await startServer();
});

test.after(async () => {
  await stopServer();
  await pool.end();
});

test('as paginas publicas abrem SEM login', async () => {
  const anonimo = createAgent(url);
  for (const rota of ['/', '/termos', '/privacidade', '/contato', '/register']) {
    const r = await anonimo.get(rota);
    assert.strictEqual(r.status, 200, `${rota} deveria abrir pra qualquer um, veio ${r.status}`);
  }
});

test('a landing mostra os planos que estao no banco (nao valores escritos na pagina)', async () => {
  const anonimo = createAgent(url);
  const r = await anonimo.get('/');
  const { rows: planos } = await pool.query('SELECT name, price_cents FROM subscription_plans WHERE is_active = true');

  assert.ok(planos.length > 0, 'o seed dos planos precisa existir pro teste valer');
  for (const plano of planos) {
    assert.ok(r.text.includes(plano.name), `o plano "${plano.name}" deveria aparecer na landing`);
    const preco = (plano.price_cents / 100).toFixed(2).replace('.', ',');
    assert.ok(r.text.includes(preco), `o preco ${preco} do plano "${plano.name}" deveria aparecer na landing`);
  }
});

test('as paginas legais e de contato mostram o e-mail de suporte de verdade', async () => {
  // O Google e o TikTok reprovam app cujo contato nao existe ou esta vago
  // ("fale com o administrador"). Este teste garante que o e-mail real
  // aparece nas 3 paginas.
  const anonimo = createAgent(url);
  for (const rota of ['/termos', '/privacidade', '/contato']) {
    const r = await anonimo.get(rota);
    assert.ok(r.text.includes(CONTACT.supportEmail), `${rota} precisa mostrar ${CONTACT.supportEmail}`);
  }
});

test('nenhuma pagina publica carrega CSS/script de servidor de terceiro', async () => {
  // As paginas publicas puxavam CSS de um CDN, o que manda o IP de quem visita
  // pra um terceiro (coisa que a politica de privacidade teria que declarar) e
  // faz a pagina depender de um servidor de fora pra renderizar.
  const anonimo = createAgent(url);
  for (const rota of ['/', '/termos', '/privacidade', '/contato', '/register']) {
    const r = await anonimo.get(rota);
    const externos = [...r.text.matchAll(/(?:src|href)="(https?:\/\/[^"]+)"/g)]
      .map((m) => m[1])
      // Link pro usuario clicar e outra coisa - o problema e o que o navegador
      // BAIXA sozinho pra montar a pagina.
      .filter((u) => !/myaccount\.google\.com|postflowtiktok\.com/.test(u));
    assert.deepStrictEqual(externos, [], `${rota} esta carregando recurso externo: ${externos.join(', ')}`);
  }
});

test('cadastro SEM aceitar os termos e recusado pelo servidor', async () => {
  // O "required" do checkbox so vale dentro do navegador - um POST direto
  // (curl, script) passaria por cima se o servidor nao checasse.
  const anonimo = createAgent(url);
  await anonimo.get('/register');
  const email = `semaceite_${Date.now()}@teste.local`;

  const response = await fetch(`${url}/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ email, password: 'senha-longa-123' }),
    redirect: 'manual',
  });

  assert.strictEqual(response.status, 400);
  const { rows } = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
  assert.strictEqual(rows.length, 0, 'a conta NAO pode ter sido criada sem aceite');
});

test('cadastro COM aceite grava quando e qual versao foi aceita', async () => {
  const email = `comaceite_${Date.now()}@teste.local`;

  const response = await fetch(`${url}/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ email, password: 'senha-longa-123', acceptedTerms: '1' }),
    redirect: 'manual',
  });

  assert.strictEqual(response.status, 302, 'cadastro valido deveria criar a conta e redirecionar');
  const { rows } = await pool.query(
    'SELECT terms_accepted_at, terms_version FROM users WHERE email = $1',
    [email]
  );
  assert.strictEqual(rows.length, 1);
  assert.ok(rows[0].terms_accepted_at, 'precisa registrar QUANDO aceitou');
  assert.ok(rows[0].terms_version, 'precisa registrar QUAL versao aceitou');
});
