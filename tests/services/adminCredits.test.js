// O dono do sistema não gasta crédito.
//
// Isto veio de uma trava real em produção: a conta de admin, com plano Pro,
// gastou a cota da semana testando o próprio sistema e ficou sem conseguir
// processar nada. Cobrar cota de quem é dono do servidor não mede nem cobra
// coisa nenhuma - só cria um jeito de o sistema se travar sozinho.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const pool = require('../../src/db/pool');
const creditsService = require('../../src/services/creditsService');
const clientCreditsRepository = require('../../src/repositories/clientCreditsRepository');
const creditTransactionsRepository = require('../../src/repositories/creditTransactionsRepository');
const { createClient, createSourceVideo, giveCredits, readCredits } = require('../helpers/db');
const { startServer, stopServer, createLoginableClient, createAgent } = require('../helpers/http');

let baseUrl;

test.before(async () => {
  baseUrl = await startServer();
});

test.after(async () => {
  await stopServer();
  await pool.end();
});

async function criarAdmin() {
  const { rows } = await pool.query(
    `INSERT INTO users (email, password_hash, role, business_name)
     VALUES ($1, 'hash', 'admin', 'Dono') RETURNING *`,
    [`admin${Date.now()}_${Math.random()}@teste.local`]
  );
  return rows[0];
}

test('admin com a cota zerada continua processando', async () => {
  const admin = await criarAdmin();
  // Sem nenhum minuto: é exatamente o estado que travou a produção.
  await giveCredits(admin.id, { quotaNormal: 0, quotaBonus: 0 });
  const video = await createSourceVideo(admin.id, { durationSeconds: 3600 });

  const r = await creditsService.reserveBeforeDownload(video, admin.id);
  assert.equal(r.outcome, 'isento');
  assert.notEqual(r.outcome, 'blocked', 'o dono do sistema nunca pode ser barrado por crédito');
});

test('processar como admin não debita nada nem cria cobrança', async () => {
  const admin = await criarAdmin();
  await giveCredits(admin.id, { quotaNormal: 150 });
  const video = await createSourceVideo(admin.id, { durationSeconds: 1800 });

  const reserva = await creditsService.reserveBeforeDownload(video, admin.id);
  await creditsService.confirmAfterDownload(video, admin.id, reserva, {
    egressType: 'founder_tunnel',
    bytes: 1000,
  });

  const saldo = await readCredits(admin.id);
  assert.equal(saldo.used_normal, 0, 'nada pode ser descontado da cota');
  assert.equal(
    await creditTransactionsRepository.findBySourceVideoId(video.id),
    null,
    'não pode existir lançamento de crédito pro dono do sistema'
  );

  const { rows } = await pool.query('SELECT count(*)::int AS n FROM client_overage_charges WHERE client_user_id = $1', [
    admin.id,
  ]);
  assert.equal(rows[0].n, 0, 'nem cobrança de excedente');
});

test('cliente comum continua sendo barrado sem crédito', async () => {
  const cliente = await createClient();
  await giveCredits(cliente.id, { quotaNormal: 0, quotaBonus: 0 });
  const video = await createSourceVideo(cliente.id, { durationSeconds: 600 });

  const r = await creditsService.reserveBeforeDownload(video, cliente.id);
  assert.equal(r.outcome, 'blocked', 'a isenção não pode vazar pra cliente comum');
});

test('cliente comum com saldo continua debitando normalmente', async () => {
  const cliente = await createClient();
  await giveCredits(cliente.id, { quotaNormal: 100 });
  const video = await createSourceVideo(cliente.id, { durationSeconds: 600 });

  const r = await creditsService.reserveBeforeDownload(video, cliente.id);
  assert.equal(r.outcome, 'reserved');
  const saldo = await clientCreditsRepository.getOrCreate(cliente.id);
  assert.equal(saldo.used_normal, 10, '600s = 10 minutos');
});

test('a tela "Plano e uso" abre pro admin, não só pro cliente', async () => {
  const admin = await createLoginableClient({ role: 'admin' });
  const agente = createAgent(baseUrl);
  await agente.login(admin.email, admin.password);

  // Antes esta era a ÚNICA rota /api/client/* que recusava admin: a página
  // abria e não carregava nada.
  const r = await agente.get('/api/client/billing/overview');
  assert.equal(r.status, 200);
  assert.equal(r.body.isExempt, true, 'a tela precisa saber que essa conta não gasta crédito');
});

test('a tela "Plano e uso" continua abrindo pro cliente, sem isenção', async () => {
  const cliente = await createLoginableClient({ role: 'client' });
  const agente = createAgent(baseUrl);
  await agente.login(cliente.email, cliente.password);

  const r = await agente.get('/api/client/billing/overview');
  assert.equal(r.status, 200);
  assert.equal(r.body.isExempt, false);
});
