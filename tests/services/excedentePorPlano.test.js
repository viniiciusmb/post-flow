// O minuto excedente custa diferente em cada plano — e é cobrado pelo Asaas.
//
// Antes a taxa era uma constante única no código (25/15 centavos). Agora vem
// do plano, e "quanto maior o plano, mais barato o minuto" é uma promessa
// feita na tela de vendas: se ela quebrar, o cliente que pagou mais caro passa
// a ser cobrado mais caro pelo excedente também.
//
// O que estes testes travam:
//   - a taxa cobrada é a do plano do cliente, não uma constante;
//   - a taxa fica GRAVADA na cobrança (snapshot) — reajuste futuro não pode
//     mudar o valor de uma cobrança antiga;
//   - cliente sem plano cai no piso, nunca em zero (zero seria processamento
//     de graça);
//   - havendo cartão do Asaas, é ele que cobra, e o id fica na coluna do Asaas
//     (procurar um id do Asaas na Stripe não acha nada, e o extrato mostraria
//     a cobrança sem origem).
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const pool = require('../../src/db/pool');
const creditsService = require('../../src/services/creditsService');
const clientSubscriptionsRepository = require('../../src/repositories/clientSubscriptionsRepository');
const subscriptionPlansRepository = require('../../src/repositories/subscriptionPlansRepository');
const overageChargesRepository = require('../../src/repositories/overageChargesRepository');
const checkoutService = require('../../src/services/checkoutService');
const { comAsaasFalso, respostasPadrao } = require('../helpers/asaasFalso');
const { createClient, createSourceVideo, giveCredits } = require('../helpers/db');

test.after(async () => {
  await pool.end();
});

const CARTAO = { number: '5162306219378829', expiryMonth: '05', expiryYear: '2030', ccv: '318', holderName: 'M H A' };
const TITULAR = { nome: 'Marcelo Almeida', documento: '52998224725', email: 'm@t.local', cep: '89223005', numeroEndereco: '277' };

test('a taxa do excedente vem do plano do cliente', async () => {
  const planos = await subscriptionPlansRepository.listActive();
  for (const p of planos) {
    const taxas = creditsService.taxasDoPlano(p);
    assert.equal(taxas.normal, p.overage_cents_normal);
    assert.equal(taxas.bonus, p.overage_cents_bonus);
  }
});

test('cliente sem plano cai no piso, nunca em zero', () => {
  const semNada = creditsService.taxasDoPlano(null);
  assert.equal(semNada.normal, creditsService.TAXA_PADRAO_CENTS_PER_MIN.normal);
  assert.equal(semNada.bonus, creditsService.TAXA_PADRAO_CENTS_PER_MIN.bonus);
  assert.ok(semNada.normal > 0, 'taxa zero seria processar de graça sem ninguém decidir isso');

  // Linha de plano sem as colunas preenchidas (banco antigo) também cai no piso.
  const incompleto = creditsService.taxasDoPlano({ plan_id: 9, overage_cents_normal: null });
  assert.equal(incompleto.normal, creditsService.TAXA_PADRAO_CENTS_PER_MIN.normal);
});

test('o piso é o do plano MENOR — errar tem que ser para o lado caro', async () => {
  const planos = await subscriptionPlansRepository.listActive();
  const maisBarato = planos[0];
  assert.equal(creditsService.TAXA_PADRAO_CENTS_PER_MIN.normal, maisBarato.overage_cents_normal);
});

async function cobrarExcedente(planKey, duracaoMin) {
  const cliente = await createClient();
  const plano = await subscriptionPlansRepository.findByKey(planKey);
  await clientSubscriptionsRepository.setPlan(cliente.id, plano.id);
  await giveCredits(cliente.id, { quotaNormal: 0, quotaBonus: 0 });
  await checkoutService.salvarCartao({
    clientUserId: cliente.id,
    dadosDoTitular: TITULAR,
    cartao: CARTAO,
    remoteIp: '1.2.3.4',
    email: cliente.email,
  });
  const video = await createSourceVideo(cliente.id, { durationSeconds: duracaoMin * 60 });
  const r = await creditsService.reserveBeforeDownload(video, cliente.id);
  return { cliente, plano, video, r };
}

test('o mesmo vídeo custa menos no plano maior, e a taxa fica gravada na cobrança', async () => {
  await comAsaasFalso(respostasPadrao(), async () => {
    const pequeno = await cobrarExcedente('starter', 20);
    const grande = await cobrarExcedente('max', 20);

    assert.equal(pequeno.r.outcome, 'charged');
    assert.equal(grande.r.outcome, 'charged');
    assert.equal(pequeno.r.amountCents, 20 * pequeno.plano.overage_cents_normal);
    assert.equal(grande.r.amountCents, 20 * grande.plano.overage_cents_normal);
    assert.ok(
      grande.r.amountCents < pequeno.r.amountCents,
      'o plano maior tem que sair mais barato — é o que foi prometido na tela'
    );

    // Snapshot: reajustar o plano depois não pode mudar o valor de uma
    // cobrança que já aconteceu.
    const cobranca = await overageChargesRepository.findBySourceVideoId(grande.video.id);
    assert.equal(cobranca.rate_cents_per_min, grande.plano.overage_cents_normal);
    assert.equal(cobranca.amount_cents, grande.r.amountCents);
    assert.equal(cobranca.status, 'pago');
  });
});

test('com cartão do Asaas, quem cobra é o Asaas e o id fica na coluna dele', async () => {
  await comAsaasFalso(respostasPadrao(), async (chamadas) => {
    const { video } = await cobrarExcedente('pro', 10);

    const cobrancasNoAsaas = chamadas.filter((c) => c.metodo === 'POST' && c.caminho === '/payments');
    assert.equal(cobrancasNoAsaas.length, 1, 'o excedente saiu da Stripe e passou a ser cobrado no Asaas');
    assert.ok(cobrancasNoAsaas[0].corpo.creditCardToken, 'a cobrança usa o cartão tokenizado');
    assert.equal(cobrancasNoAsaas[0].corpo.billingType, 'CREDIT_CARD');
    // Amarra a cobrança ao vídeo: sem isso não dá para dizer, no painel do
    // Asaas, de onde veio cada valor.
    assert.match(cobrancasNoAsaas[0].corpo.externalReference, /^excedente:\d+:\d+$/);

    const registro = await overageChargesRepository.findBySourceVideoId(video.id);
    assert.ok(registro.asaas_payment_id, 'o id do Asaas tem que ficar na coluna do Asaas');
    assert.equal(registro.stripe_payment_intent_id, null);
  });
});

test('cobrança não aprovada NÃO deixa o vídeo processar, e devolve o crédito consumido', async () => {
  await comAsaasFalso(respostasPadrao({ paymentStatus: 'PENDING' }), async () => {
    const cliente = await createClient();
    const plano = await subscriptionPlansRepository.findByKey('pro');
    await clientSubscriptionsRepository.setPlan(cliente.id, plano.id);
    await giveCredits(cliente.id, { quotaNormal: 5 });
    await checkoutService.salvarCartao({
      clientUserId: cliente.id,
      dadosDoTitular: TITULAR,
      cartao: CARTAO,
      remoteIp: '1.2.3.4',
      email: cliente.email,
    });
    const video = await createSourceVideo(cliente.id, { durationSeconds: 20 * 60 });

    const r = await creditsService.reserveBeforeDownload(video, cliente.id);
    assert.equal(r.outcome, 'charge_failed', 'cartão em análise não pode liberar processamento caro');

    const { rows } = await pool.query('SELECT * FROM client_credits WHERE client_user_id = $1', [cliente.id]);
    assert.equal(rows[0].used_normal, 0, 'os minutos consumidos têm que voltar: nada foi processado');
  });
});
