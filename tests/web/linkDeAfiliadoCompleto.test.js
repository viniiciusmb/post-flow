// Link de divulgação do admin: a tela precisa entregar o endereço PRONTO pra
// colar, não só o código.
//
// Relato do fundador em 22/08/2026: criou um link para usar em outro sistema
// dele e a tela mostrou só o código, deixando pra ele montar o endereço na
// mão — que é justamente onde se erra o domínio ou a forma do parâmetro e o
// link deixa de dar comissão sem ninguém perceber.
//
// O que estes testes travam:
//   - criar e listar devolvem a URL completa;
//   - a URL usa o domínio configurado, não um chute;
//   - a base vem mesmo sem nenhum link criado (é a primeira vez que se usa);
//   - o endereço gerado REALMENTE atribui a indicação.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const pool = require('../../src/db/pool');
const { startServer, stopServer, createLoginableClient, createAgent } = require('../helpers/http');
const { CONTACT } = require('../../src/config/constants');

let baseUrl;

test.before(async () => {
  baseUrl = await startServer();
});

test.after(async () => {
  await stopServer();
  await pool.end();
});

async function adminLogado() {
  const admin = await createLoginableClient({ role: 'admin' });
  const agente = createAgent(baseUrl);
  await agente.login(admin.email, admin.password);
  return { admin, agente };
}

test('criar um link devolve o endereço completo, pronto pra colar', async () => {
  const { agente } = await adminLogado();
  const codigo = `campanha${Date.now().toString().slice(-6)}`;

  const criado = await agente.post('/api/admin/commissions/links', { code: codigo, label: 'Instagram' });
  assert.equal(criado.status, 200, criado.text);
  assert.equal(
    criado.body.link.url,
    `${CONTACT.siteUrl}/?ref=${codigo}`,
    'o endereço tem que vir montado — mandar só o código obriga o admin a adivinhar o resto'
  );
});

test('a listagem traz o endereço de cada link', async () => {
  const { agente } = await adminLogado();
  const codigo = `lista${Date.now().toString().slice(-6)}`;
  await agente.post('/api/admin/commissions/links', { code: codigo, label: 'Curso' });

  const { body } = await agente.get('/api/admin/commissions/links');
  const meu = body.links.find((l) => l.code === codigo);
  assert.ok(meu, 'o link criado precisa aparecer na lista');
  assert.equal(meu.url, `${CONTACT.siteUrl}/?ref=${codigo}`);
  assert.equal(meu.label, 'Curso');
});

test('a base vem mesmo sem nenhum link criado', async () => {
  // É exatamente a primeira vez que alguém usa a tela: sem isso, a prévia do
  // endereço só apareceria depois do primeiro link existir.
  const { agente } = await adminLogado();
  const { body } = await agente.get('/api/admin/commissions/links');
  assert.equal(body.links.length, 0, 'admin novo não deveria ter link nenhum');
  assert.equal(body.baseUrl, CONTACT.siteUrl);
});

test('o endereço gerado realmente atribui a indicação', async () => {
  // O teste que importa de verdade: um link bonito que não credita comissão
  // seria pior que nenhum link. Percorre o caminho inteiro — abrir o endereço
  // como visitante e criar conta.
  const { agente: admin } = await adminLogado();
  const codigo = `real${Date.now().toString().slice(-6)}`;
  const criado = await admin.post('/api/admin/commissions/links', { code: codigo, label: 'Teste' });
  const url = criado.body.link.url;

  // Usa só o caminho do endereço gerado, apontando pro servidor de teste.
  const caminho = url.slice(CONTACT.siteUrl.length);
  assert.equal(caminho, `/?ref=${codigo}`);

  const visitante = createAgent(baseUrl);
  await visitante.get(caminho);

  const email = `indicado${Date.now()}@teste.local`;
  const cadastro = await visitante.post('/register', {
    email,
    password: 'senha-de-teste-123',
    businessName: 'Empresa indicada',
    acceptedTerms: true,
  });
  assert.equal(cadastro.status, 302, `cadastro falhou: ${cadastro.status} ${cadastro.text}`);

  const { rows } = await pool.query(
    `SELECT r.id FROM referrals r
     JOIN affiliate_links al ON al.id = r.affiliate_link_id
     JOIN users u ON u.id = r.referred_user_id
     WHERE al.code = $1 AND u.email = $2`,
    [codigo, email]
  );
  assert.equal(rows.length, 1, 'o link gerado não atribuiu a indicação — ele não geraria comissão');
});
