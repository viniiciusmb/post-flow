// Fluxo ponta a ponta de atribuicao: visitar a landing com ?ref=codigo (ou
// UTM), cadastrar, e confirmar que a indicacao foi gravada certinho - exatamente
// o caminho que um cliente de verdade percorre ao clicar no link de um
// afiliado. Roda contra o app Express de verdade (mesma tecnica de
// tests/services/adminCredits.test.js), nao contra funcao isolada, porque o
// que mais importa aqui e a sessao sobreviver entre a visita e o POST /register.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const pool = require('../../src/db/pool');
const affiliateLinksRepository = require('../../src/repositories/affiliateLinksRepository');
const referralsRepository = require('../../src/repositories/referralsRepository');
const usersRepository = require('../../src/repositories/usersRepository');
const { startServer, stopServer, createLoginableClient, createAgent } = require('../helpers/http');
const { createClient } = require('../helpers/db');

let baseUrl;

test.before(async () => {
  baseUrl = await startServer();
});

test.after(async () => {
  await stopServer();
  await pool.end();
});

test('cadastro depois de visitar ?ref=codigo grava a indicacao certa', async () => {
  const referente = await createClient();
  const link = await affiliateLinksRepository.getOrCreateDefault(referente.id);

  const visitante = createAgent(baseUrl);
  await visitante.get(`/?ref=${link.code}`);

  const email = `indicado-${Date.now()}@teste.local`;
  const cadastro = await visitante.post('/register', {
    email,
    password: 'senha-de-teste-123',
    businessName: 'Empresa indicada',
    acceptedTerms: true,
  });
  assert.equal(cadastro.status, 302, `cadastro deveria redirecionar, veio ${cadastro.status}: ${cadastro.text}`);

  const novoUsuario = await usersRepository.findByEmail(email);
  assert.ok(novoUsuario, 'usuario deveria ter sido criado');

  const referral = await referralsRepository.findByReferredUserId(novoUsuario.id);
  assert.ok(referral, 'deveria ter gravado a indicacao');
  assert.equal(referral.affiliate_link_id, link.id);
  assert.equal(referral.referrer_user_id, referente.id);
});

test('cadastro sem visitar nenhum link nao gera indicacao nenhuma', async () => {
  const visitante = createAgent(baseUrl);
  const email = `organico-${Date.now()}@teste.local`;
  const cadastro = await visitante.post('/register', {
    email,
    password: 'senha-de-teste-123',
    businessName: 'Empresa organica',
    acceptedTerms: true,
  });
  assert.equal(cadastro.status, 302);

  const novoUsuario = await usersRepository.findByEmail(email);
  const referral = await referralsRepository.findByReferredUserId(novoUsuario.id);
  assert.equal(referral, null, 'cadastro direto nao pode virar indicacao');
});

test('UTM sozinha (sem codigo de afiliado) tambem fica registrada', async () => {
  const visitante = createAgent(baseUrl);
  await visitante.get('/?utm_source=instagram&utm_campaign=bio-agosto');

  const email = `utm-${Date.now()}@teste.local`;
  await visitante.post('/register', {
    email,
    password: 'senha-de-teste-123',
    businessName: 'Empresa via UTM',
    acceptedTerms: true,
  });

  const novoUsuario = await usersRepository.findByEmail(email);
  const referral = await referralsRepository.findByReferredUserId(novoUsuario.id);
  assert.ok(referral, 'UTM sozinha ja deveria bastar pra registrar a origem');
  assert.equal(referral.affiliate_link_id, null, 'sem codigo de afiliado, nao ha link');
  assert.equal(referral.utm_source, 'instagram');
  assert.equal(referral.utm_campaign, 'bio-agosto');
});

test('painel do cliente mostra o proprio link e reflete a indicacao', async () => {
  const referente = await createLoginableClient({ role: 'client' });
  await affiliateLinksRepository.getOrCreateDefault(referente.id);

  const agente = createAgent(baseUrl);
  await agente.login(referente.email, referente.password);

  const r = await agente.get('/api/client/commissions/overview');
  assert.equal(r.status, 200);
  assert.ok(r.body.link.url.includes('?ref='), 'link precisa ter o parametro ref');
  assert.equal(typeof r.body.balance.availableCents, 'number');
});

test('solicitar saque abaixo do minimo e recusado com erro claro', async () => {
  const referente = await createLoginableClient({ role: 'client' });
  const agente = createAgent(baseUrl);
  await agente.login(referente.email, referente.password);

  await agente.put('/api/client/commissions/pix-key', { pixKey: 'teste@example.com', pixKeyType: 'email' });
  const r = await agente.post('/api/client/commissions/withdraw');
  assert.equal(r.status, 400);
  assert.ok(r.body.error, 'deveria devolver uma mensagem de erro');
});

test('admin ve o afiliado na lista depois de uma indicacao', async () => {
  const referente = await createClient();
  const link = await affiliateLinksRepository.getOrCreateDefault(referente.id);
  const visitante = createAgent(baseUrl);
  await visitante.get(`/?ref=${link.code}`);
  await visitante.post('/register', {
    email: `admin-lista-${Date.now()}@teste.local`,
    password: 'senha-de-teste-123',
    businessName: 'Empresa X',
    acceptedTerms: true,
  });

  const admin = await createLoginableClient({ role: 'admin' });
  const agenteAdmin = createAgent(baseUrl);
  await agenteAdmin.login(admin.email, admin.password);

  const r = await agenteAdmin.get('/api/admin/commissions/affiliates');
  assert.equal(r.status, 200);
  const encontrado = r.body.affiliates.find((a) => a.userId === referente.id);
  assert.ok(encontrado, 'o afiliado com indicacao nova precisa aparecer na lista do admin');
  assert.ok(encontrado.referralCount >= 1);
});
