// Excedente proporcional.
//
// Antes era tudo-ou-nada: com 10 min de cota sobrando e um vídeo de 30, o
// vídeo INTEIRO ia pro cartão (R$ 7,50) e os 10 minutos ficavam parados sem
// uso. O cliente pagava a mais e ainda ficava com crédito preso que já tinha
// pago. Agora usa os 10 e cobra só os 20 (R$ 5,00).
//
// Isto é código de cobrança: errar aqui tira dinheiro a mais de alguém, ou
// deixa o cliente sem o crédito e sem o vídeo. Os casos que mais importam são
// os de FALHA no meio (sem cartão, cartão recusado): o crédito já consumido
// tem que voltar inteiro.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../../src/db/pool');
const clientCreditsRepository = require('../../src/repositories/clientCreditsRepository');
const creditTransactionsRepository = require('../../src/repositories/creditTransactionsRepository');
const overageChargesRepository = require('../../src/repositories/overageChargesRepository');
const creditsService = require('../../src/services/creditsService');
const stripeService = require('../../src/services/stripeService');

let contador = 0;

async function cenario({ quota, used, extra, duracaoMin, cartao = true }) {
  contador += 1;
  const { rows: [user] } = await pool.query(
    `INSERT INTO users (email, password_hash, role) VALUES ($1, 'x', 'client') RETURNING *`,
    [`exc${contador}_${Date.now()}@teste.local`]
  );
  await pool.query(
    `INSERT INTO client_credits (client_user_id, quota_normal, used_normal, extra_normal)
     VALUES ($1, $2, $3, $4)`,
    [user.id, quota, used, extra]
  );
  const { rows: [plano] } = await pool.query(`SELECT id FROM subscription_plans WHERE key = 'pro'`);
  await pool.query(
    `INSERT INTO client_subscriptions
       (client_user_id, plan_id, status, overage_card_enabled, stripe_customer_id, stripe_default_payment_method_id)
     VALUES ($1, $2, 'ativo', $3, 'cus_teste', 'pm_teste')`,
    [user.id, plano.id, cartao]
  );
  const { rows: [video] } = await pool.query(
    `INSERT INTO source_videos
       (client_user_id, owner_client_user_id, input_type, youtube_video_id, title, status, duration_seconds)
     VALUES ($1, $1, 'manual', $2, 'v', 'detected', $3) RETURNING *`,
    [user.id, `exc${contador}_${Date.now()}`.slice(0, 30), duracaoMin * 60]
  );
  return { user, video };
}

async function saldo(clientUserId) {
  const { rows } = await pool.query(`SELECT * FROM client_credits WHERE client_user_id = $1`, [clientUserId]);
  const c = rows[0];
  return {
    cotaSobrando: Math.max(c.quota_normal - c.used_normal, 0),
    avulso: c.extra_normal,
    disponivel: Math.max(c.quota_normal - c.used_normal, 0) + c.extra_normal,
  };
}

// Stripe de mentira: o que se testa aqui é a nossa divisão entre crédito e
// cartão, não o comportamento da Stripe (esse está em stripeFlows.test.js,
// contra a API de verdade).
function comStripe(resultado, fn) {
  const original = { isConfigured: stripeService.isConfigured, chargeNow: stripeService.chargeNow };
  const cobrancas = [];
  stripeService.isConfigured = () => true;
  stripeService.chargeNow = async (args) => {
    cobrancas.push(args);
    return resultado;
  };
  return fn(cobrancas).finally(() => Object.assign(stripeService, original));
}

test('o caso do dono: 10 min de cota sobrando, vídeo de 30 → usa os 10 e cobra 20', async () => {
  const { user, video } = await cenario({ quota: 150, used: 140, extra: 0, duracaoMin: 30 });

  await comStripe({ ok: true, id: 'pi_1' }, async (cobrancas) => {
    const r = await creditsService.reserveBeforeDownload(video, user.id);

    assert.equal(r.outcome, 'reserved_and_charged');
    assert.equal(r.minutesFromCredit, 10, 'os 10 minutos já pagos têm que ser usados');
    assert.equal(r.minutesUncovered, 20, 'só os 20 que passaram vão pro cartão');
    // R$0,25/min no bolso normal: 20 x 25 = 500 centavos.
    assert.equal(r.amountCents, 500, 'antes cobrava 750 (o vídeo inteiro)');
    assert.equal(cobrancas.length, 1);
    assert.equal(cobrancas[0].amountCents, 500);
  });

  const s = await saldo(user.id);
  assert.equal(s.disponivel, 0, 'o crédito que existia foi todo consumido');

  // O que saiu do crédito precisa de registro próprio, senão some sem rastro.
  const tx = await creditTransactionsRepository.findBySourceVideoId(video.id);
  assert.ok(tx, 'a parte paga com crédito tem que virar transação');
  assert.equal(tx.minutes_charged, 10);
  assert.equal(tx.minutes_from_quota, 10);

  const overage = await overageChargesRepository.findBySourceVideoId(video.id);
  assert.equal(overage.minutes, 20, 'a cobrança registrada é só do que passou');
  assert.equal(overage.amount_cents, 500);
});

test('gasta a cota primeiro e o avulso comprado depois, antes de tocar no cartão', async () => {
  // 10 de cota + 25 avulsos = 35 disponíveis; vídeo de 50 → 15 vão pro cartão.
  const { user, video } = await cenario({ quota: 150, used: 140, extra: 25, duracaoMin: 50 });

  await comStripe({ ok: true, id: 'pi_2' }, async () => {
    const r = await creditsService.reserveBeforeDownload(video, user.id);
    assert.equal(r.minutesFromCredit, 35);
    assert.equal(r.minutesUncovered, 15);
    assert.equal(r.amountCents, 375);
  });

  const tx = await creditTransactionsRepository.findBySourceVideoId(video.id);
  assert.equal(tx.minutes_from_quota, 10, 'a cota do plano sai primeiro');
  assert.equal(tx.minutes_from_extra, 25, 'o avulso comprado sai depois');
});

test('vídeo que cabe no crédito continua sem gerar cobrança nenhuma', async () => {
  const { user, video } = await cenario({ quota: 150, used: 140, extra: 25, duracaoMin: 30 });

  await comStripe({ ok: true, id: 'pi_nao_deveria' }, async (cobrancas) => {
    const r = await creditsService.reserveBeforeDownload(video, user.id);
    assert.equal(r.outcome, 'reserved');
    assert.equal(cobrancas.length, 0, 'não pode encostar no cartão quando cabe no crédito');
  });

  const s = await saldo(user.id);
  assert.equal(s.disponivel, 5, '35 disponíveis − 30 do vídeo');
  const overage = await overageChargesRepository.findBySourceVideoId(video.id);
  assert.ok(!overage, 'não pode existir cobrança de excedente quando coube tudo no crédito');
});

test('SEM cartão: devolve o crédito consumido em vez de comer parte dele', async () => {
  // O vídeo não vai rodar. Se os 10 minutos ficassem consumidos, o cliente
  // teria perdido crédito sem receber absolutamente nada em troca.
  const { user, video } = await cenario({ quota: 150, used: 140, extra: 0, duracaoMin: 30, cartao: false });

  const r = await creditsService.reserveBeforeDownload(video, user.id);
  assert.equal(r.outcome, 'blocked');

  const s = await saldo(user.id);
  assert.equal(s.disponivel, 10, 'os 10 minutos têm que voltar intactos');
  assert.equal(await creditTransactionsRepository.findBySourceVideoId(video.id), null);
});

test('cartão RECUSADO: devolve o crédito consumido', async () => {
  const { user, video } = await cenario({ quota: 150, used: 140, extra: 25, duracaoMin: 60 });

  await comStripe({ ok: false, motivo: 'Cartão recusado.' }, async () => {
    const r = await creditsService.reserveBeforeDownload(video, user.id);
    assert.equal(r.outcome, 'charge_failed');
    // 60 − 35 de crédito = 25 min a cobrar.
    assert.equal(r.amountCents, 625);
  });

  const s = await saldo(user.id);
  assert.equal(s.disponivel, 35, 'crédito intacto: nada foi processado');
  assert.equal(s.cotaSobrando, 10);
  assert.equal(s.avulso, 25);
});

test('sem nenhum crédito, cobra o vídeo inteiro e não cria transação de crédito', async () => {
  const { user, video } = await cenario({ quota: 150, used: 150, extra: 0, duracaoMin: 20 });

  await comStripe({ ok: true, id: 'pi_3' }, async () => {
    const r = await creditsService.reserveBeforeDownload(video, user.id);
    assert.equal(r.outcome, 'charged');
    assert.equal(r.minutes, 20);
    assert.equal(r.amountCents, 500);
  });

  assert.equal(await creditTransactionsRepository.findBySourceVideoId(video.id), null);
});

test('consumeUpTo nunca entrega mais crédito do que existe, com 10 chamadas ao mesmo tempo', async () => {
  // Mesma prova do reserve(): a divisão entre crédito e cartão só é confiável
  // se o consumo for atômico. Duas chamadas simultâneas não podem gastar o
  // mesmo minuto e mandar menos do que devem pro cartão.
  const { user } = await cenario({ quota: 100, used: 0, extra: 0, duracaoMin: 1 });

  const resultados = await Promise.all(
    Array.from({ length: 10 }, () => clientCreditsRepository.consumeUpTo(user.id, 'normal', 30))
  );

  const totalConsumido = resultados.reduce((s, r) => s + r.minutesFromQuota + r.minutesFromExtra, 0);
  assert.equal(totalConsumido, 100, 'a soma do consumido é exatamente o que havia — nem mais, nem menos');

  const s = await saldo(user.id);
  assert.equal(s.disponivel, 0);
  assert.ok(s.cotaSobrando >= 0, 'o saldo nunca pode ficar negativo');

  const totalDescoberto = resultados.reduce((s2, r) => s2 + r.minutesUncovered, 0);
  assert.equal(totalConsumido + totalDescoberto, 300, 'todo minuto pedido foi ou coberto ou reportado como faltante');
});
