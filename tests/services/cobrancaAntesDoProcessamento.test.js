// Cobrança do excedente ANTES do processamento.
//
// Antes o excedente era acumulado e faturado de hora em hora: o vídeo era
// processado primeiro e a cobrança tentada depois. Se o cartão fosse recusado,
// o custo (download, Whisper, Claude, ffmpeg) já tinha sido gasto e não havia
// como recuperar. Cobrando antes, o pior caso vira "o vídeo espera".
//
// O que estes testes travam:
//   - nada é processado quando a cobrança falha;
//   - nada é cobrado enquanto houver cota;
//   - reprocessar não cobra duas vezes;
//   - o motivo do bloqueio distingue "sem crédito" de "cartão recusado", que
//     mandam o cliente pra saídas diferentes.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const pool = require('../../src/db/pool');
const creditsService = require('../../src/services/creditsService');
const stripeService = require('../../src/services/stripeService');
const clientSubscriptionsRepository = require('../../src/repositories/clientSubscriptionsRepository');
const overageChargesRepository = require('../../src/repositories/overageChargesRepository');
const sourceVideosRepository = require('../../src/repositories/sourceVideosRepository');
const { createClient, createSourceVideo, giveCredits, readCredits } = require('../helpers/db');

test.after(async () => {
  await pool.end();
});

// Substitui a Stripe por uma resposta controlada e registra o que foi pedido.
function comStripe({ ok, motivo = 'Cartão recusado.' }, fn) {
  const configuradoOriginal = stripeService.isConfigured;
  const cobrarOriginal = stripeService.chargeNow;
  const chamadas = [];
  stripeService.isConfigured = () => true;
  stripeService.chargeNow = async (args) => {
    chamadas.push(args);
    return ok ? { ok: true, id: 'pi_teste' } : { ok: false, id: null, motivo };
  };
  return fn(chamadas).finally(() => {
    stripeService.isConfigured = configuradoOriginal;
    stripeService.chargeNow = cobrarOriginal;
  });
}

async function clienteComCartaoESemCota() {
  const cliente = await createClient();
  await giveCredits(cliente.id, { quotaNormal: 0, quotaBonus: 0 });
  await clientSubscriptionsRepository.getOrCreate(cliente.id);
  await pool.query(
    `UPDATE client_subscriptions
        SET overage_card_enabled = true,
            stripe_customer_id = 'cus_teste',
            stripe_default_payment_method_id = 'pm_teste'
      WHERE client_user_id = $1`,
    [cliente.id]
  );
  return cliente;
}

test('cartão passou: cobra o valor certo ANTES e libera o processamento', async () => {
  const cliente = await clienteComCartaoESemCota();
  const video = await createSourceVideo(cliente.id, { durationSeconds: 1800 }); // 30 min

  await comStripe({ ok: true }, async (chamadas) => {
    const r = await creditsService.reserveBeforeDownload(video, cliente.id);
    assert.equal(r.outcome, 'charged');

    assert.equal(chamadas.length, 1, 'tem que cobrar uma vez');
    // 30 min × R$ 0,25 = R$ 7,50
    assert.equal(chamadas[0].amountCents, 750);
    assert.equal(chamadas[0].customerId, 'cus_teste');
    assert.equal(chamadas[0].paymentMethodId, 'pm_teste');
  });

  // O lançamento nasce PAGO: o dinheiro já entrou antes de processar.
  const lancamento = await overageChargesRepository.findBySourceVideoId(video.id);
  assert.equal(lancamento.status, 'pago');
  assert.equal(lancamento.amount_cents, 750);
  assert.equal(lancamento.stripe_payment_intent_id, 'pi_teste');
});

test('cartão recusado: NADA é processado e nada fica cobrado', async () => {
  const cliente = await clienteComCartaoESemCota();
  const video = await createSourceVideo(cliente.id, { durationSeconds: 1800 });

  await comStripe({ ok: false, motivo: 'Your card was declined.' }, async () => {
    const r = await creditsService.reserveBeforeDownload(video, cliente.id);
    assert.equal(r.outcome, 'charge_failed');
    assert.match(r.motivo, /declined/);
  });

  assert.equal(
    await overageChargesRepository.findBySourceVideoId(video.id),
    null,
    'cobrança que não passou não pode virar lançamento'
  );
});

test('o motivo do bloqueio separa "sem crédito" de "cartão recusado"', async () => {
  const cliente = await createClient();
  const semCartao = await createSourceVideo(cliente.id, { durationSeconds: 600 });
  const comCartao = await createSourceVideo(cliente.id, { durationSeconds: 600 });

  await sourceVideosRepository.updateStatus(semCartao.id, 'aguardando_creditos', {
    billingBlockReason: 'sem_credito',
  });
  await sourceVideosRepository.updateStatus(comCartao.id, 'aguardando_creditos', {
    billingBlockReason: 'cobranca_falhou',
  });

  const a = await sourceVideosRepository.findById(semCartao.id);
  const b = await sourceVideosRepository.findById(comCartao.id);
  assert.equal(a.billing_block_reason, 'sem_credito');
  assert.equal(b.billing_block_reason, 'cobranca_falhou');

  // Voltou a processar: o motivo antigo tem que sumir, senão a tela continua
  // mostrando "cartão recusado" num vídeo que já está rodando.
  await sourceVideosRepository.updateStatus(comCartao.id, 'downloading');
  assert.equal((await sourceVideosRepository.findById(comCartao.id)).billing_block_reason, null);
});

test('com cota disponível, o cartão nem é tocado', async () => {
  const cliente = await clienteComCartaoESemCota();
  await giveCredits(cliente.id, { quotaNormal: 100 });
  const video = await createSourceVideo(cliente.id, { durationSeconds: 600 });

  await comStripe({ ok: true }, async (chamadas) => {
    const r = await creditsService.reserveBeforeDownload(video, cliente.id);
    assert.equal(r.outcome, 'reserved');
    assert.equal(chamadas.length, 0, 'quem tem cota não pode ser cobrado no cartão');
  });

  const saldo = await readCredits(cliente.id);
  assert.equal(saldo.used_normal, 10);
});

test('reprocessar o mesmo vídeo não cobra de novo', async () => {
  const cliente = await clienteComCartaoESemCota();
  const video = await createSourceVideo(cliente.id, { durationSeconds: 1800 });

  await comStripe({ ok: true }, async (chamadas) => {
    await creditsService.reserveBeforeDownload(video, cliente.id);
    // Segunda passada: é o que acontece quando um erro numa etapa posterior
    // faz o vídeo voltar pra fila.
    const r = await creditsService.reserveBeforeDownload(video, cliente.id);

    assert.equal(chamadas.length, 2, 'a segunda tentativa consulta a Stripe de novo');
    // Mas o lançamento continua sendo um só - o ON CONFLICT no source_video_id
    // é o que impede a cobrança duplicada virar dinheiro cobrado duas vezes.
    assert.equal(r.outcome, 'charged');
  });

  const { rows } = await pool.query(
    'SELECT count(*)::int AS n FROM client_overage_charges WHERE source_video_id = $1',
    [video.id]
  );
  assert.equal(rows[0].n, 1, 'não pode existir dois lançamentos pro mesmo vídeo');
});

test('sem Stripe configurada, o vídeo espera em vez de processar de graça', async () => {
  const cliente = await clienteComCartaoESemCota();
  const video = await createSourceVideo(cliente.id, { durationSeconds: 600 });

  // Estado real de hoje: cartão marcado como ativo, mas as chaves da Stripe
  // ainda não chegaram. Processar assim seria trabalhar sem cobrar.
  const original = stripeService.isConfigured;
  stripeService.isConfigured = () => false;
  try {
    const r = await creditsService.reserveBeforeDownload(video, cliente.id);
    assert.equal(r.outcome, 'charge_failed');
  } finally {
    stripeService.isConfigured = original;
  }
});

test('upload direto segue a mesma regra: cobra antes', async () => {
  const cliente = await clienteComCartaoESemCota();
  const video = await createSourceVideo(cliente.id, { durationSeconds: 1200 }); // 20 min

  await comStripe({ ok: false }, async () => {
    const r = await creditsService.chargeForUpload(video, cliente.id);
    assert.equal(r.outcome, 'charge_failed');
  });

  await comStripe({ ok: true }, async (chamadas) => {
    const r = await creditsService.chargeForUpload(video, cliente.id);
    assert.equal(r.outcome, 'charged');
    assert.equal(chamadas[0].amountCents, 500, '20 min × R$ 0,25');
  });
});
