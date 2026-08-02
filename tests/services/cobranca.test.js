// Regras de cobrança por vídeo processado.
//
// É a parte do sistema onde um erro custa dinheiro de verdade: processar de
// graça, cobrar duas vezes, ou cobrar o valor errado. Cada caso aqui é um
// caminho que o cliente percorre de fato.
'use strict';

const test = require('node:test');
const assert = require('node:assert');

const creditos = require('../../src/services/creditsService');
const saldoRepo = require('../../src/repositories/clientCreditsRepository');
const excedenteRepo = require('../../src/repositories/overageChargesRepository');
const assinaturaRepo = require('../../src/repositories/clientSubscriptionsRepository');
const { pool, createClient, closePool } = require('../helpers/db');

test.after(() => closePool());

async function videoDe(clientUserId, minutos) {
  const { rows } = await pool.query(
    `INSERT INTO source_videos (title, status, input_type, client_user_id, owner_client_user_id, duration_seconds)
     VALUES ('video de teste', 'detected', 'manual', $1, $1, $2) RETURNING *`,
    [clientUserId, minutos * 60]
  );
  return rows[0];
}

async function comCartaoDeExcedente(clientUserId) {
  await assinaturaRepo.getOrCreate(clientUserId);
  await pool.query(
    `UPDATE client_subscriptions
     SET overage_card_enabled = true, stripe_customer_id = 'cus_teste',
         stripe_default_payment_method_id = 'pm_teste'
     WHERE client_user_id = $1`,
    [clientUserId]
  );
}

test('com saldo, o vídeo debita crédito e não gera cobrança no cartão', async () => {
  const cliente = await createClient();
  await saldoRepo.getOrCreate(cliente.id);
  await pool.query('UPDATE client_credits SET quota_normal = 100, used_normal = 0 WHERE client_user_id = $1', [
    cliente.id,
  ]);

  const video = await videoDe(cliente.id, 12);
  const reserva = await creditos.reserveBeforeDownload(video, cliente.id);
  await creditos.confirmAfterDownload(video, cliente.id, reserva, { egressType: 'proxy' });

  const saldo = await saldoRepo.getOrCreate(cliente.id);
  assert.strictEqual(Number(saldo.used_normal), 12, 'tem que debitar os minutos do vídeo');
  assert.strictEqual((await excedenteRepo.listPendingByClient(cliente.id)).length, 0);
});

test('sem saldo e sem cartão, o vídeo é bloqueado (não processa de graça)', async () => {
  const cliente = await createClient();
  await saldoRepo.getOrCreate(cliente.id);

  const reserva = await creditos.reserveBeforeDownload(await videoDe(cliente.id, 10), cliente.id);
  assert.strictEqual(reserva.outcome, 'blocked');
});

test('sem saldo e com cartão, cobra minutos x valor por minuto', async () => {
  const cliente = await createClient();
  await saldoRepo.getOrCreate(cliente.id);
  await comCartaoDeExcedente(cliente.id);

  const video = await videoDe(cliente.id, 8);
  const reserva = await creditos.reserveBeforeDownload(video, cliente.id);
  await creditos.confirmAfterDownload(video, cliente.id, reserva, { egressType: 'proxy' });

  const [cobranca] = await excedenteRepo.listPendingByClient(cliente.id);
  assert.ok(cobranca, 'deveria ter gerado uma cobrança de excedente');
  assert.strictEqual(Number(cobranca.minutes), 8);
  assert.strictEqual(Number(cobranca.rate_cents_per_min), 25, 'saindo pela nossa internet, R$0,25/min');
  assert.strictEqual(
    Number(cobranca.amount_cents),
    8 * 25,
    'o valor tem que ser exatamente minutos x tarifa'
  );
});

test('saindo pela internet do cliente, a tarifa é a menor', async () => {
  // É a contrapartida de quem instala o programa: baixa o nosso custo, então
  // o excedente dele é mais barato.
  const cliente = await createClient();
  await saldoRepo.getOrCreate(cliente.id);
  await comCartaoDeExcedente(cliente.id);

  const video = await videoDe(cliente.id, 8);
  const reserva = await creditos.reserveBeforeDownload(video, cliente.id);
  await creditos.confirmAfterDownload(video, cliente.id, reserva, { egressType: 'client_tunnel' });

  const [cobranca] = await excedenteRepo.listPendingByClient(cliente.id);
  assert.strictEqual(cobranca.bucket, 'bonus');
  assert.strictEqual(Number(cobranca.rate_cents_per_min), 15, 'pela internet do cliente, R$0,15/min');
  assert.strictEqual(Number(cobranca.amount_cents), 8 * 15);
});

test('reprocessar um vídeo já cobrado não cobra de novo, e não quebra o vídeo', async () => {
  // O UNIQUE(source_video_id) sempre impediu a cobrança dupla, mas a segunda
  // tentativa lançava erro de constraint: a exceção subia até o processVideoJob
  // e o vídeo era marcado como ERRO. A proteção funcionava e o reprocessamento
  // quebrava junto.
  const cliente = await createClient();
  await saldoRepo.getOrCreate(cliente.id);
  await comCartaoDeExcedente(cliente.id);

  const video = await videoDe(cliente.id, 8);
  const primeira = await creditos.reserveBeforeDownload(video, cliente.id);
  await creditos.confirmAfterDownload(video, cliente.id, primeira, { egressType: 'proxy' });

  // Não pode lançar.
  const segunda = await creditos.reserveBeforeDownload(video, cliente.id);
  await creditos.confirmAfterDownload(video, cliente.id, segunda, { egressType: 'proxy' });

  const { rows } = await pool.query(
    'SELECT count(*)::int AS total FROM client_overage_charges WHERE source_video_id = $1',
    [video.id]
  );
  assert.strictEqual(rows[0].total, 1, 'continua sendo uma cobrança só');
});

test('o pacote avulso entra como crédito extra e é consumido normalmente', async () => {
  const cliente = await createClient();
  await saldoRepo.getOrCreate(cliente.id);

  await saldoRepo.addExtra(cliente.id, 'normal', 100);
  const depoisDaCompra = await saldoRepo.getOrCreate(cliente.id);
  assert.strictEqual(Number(depoisDaCompra.extra_normal), 100);

  const reserva = await creditos.reserveBeforeDownload(await videoDe(cliente.id, 10), cliente.id);
  assert.strictEqual(reserva.outcome, 'reserved', 'com pacote avulso o vídeo pode processar');

  const depoisDoUso = await saldoRepo.getOrCreate(cliente.id);
  assert.strictEqual(Number(depoisDoUso.extra_normal), 90, 'consome do avulso quando a cota acabou');
});

test('crédito avulso não é zerado pelo reset semanal', async () => {
  // Cota renova, avulso comprado não expira: foi pago à parte.
  const cliente = await createClient();
  const { rows: [plano] } = await pool.query("SELECT id FROM subscription_plans WHERE key = 'pro'");
  await assinaturaRepo.getOrCreate(cliente.id);
  await assinaturaRepo.setPlan(cliente.id, plano.id);
  await pool.query("UPDATE client_subscriptions SET status = 'ativo' WHERE client_user_id = $1", [cliente.id]);

  await saldoRepo.getOrCreate(cliente.id);
  await saldoRepo.addExtra(cliente.id, 'normal', 50);
  await pool.query(
    `UPDATE client_credits SET used_normal = 40, cycle_start_at = now() - interval '8 days'
     WHERE client_user_id = $1`,
    [cliente.id]
  );

  await saldoRepo.resetDueCycles();

  const depois = await saldoRepo.getOrCreate(cliente.id);
  assert.strictEqual(Number(depois.used_normal), 0, 'o ciclo zera o que foi usado');
  assert.strictEqual(Number(depois.extra_normal), 50, 'o avulso comprado tem que sobreviver ao reset');
});
