// Conexões extras: comprar mais 1 canal do YouTube + 1 conta do TikTok.
//
// O que estes testes travam:
//   - o limite EFETIVO é plano + conexões compradas, e é o mesmo número que o
//     servidor usa para barrar (mostrar um e barrar por outro faz o cliente
//     achar que pagou por algo que não veio);
//   - quem não tem plano continua barrado, com ou sem slot;
//   - só o plano que vende slot pode comprar;
//   - a cobrança do mês corrente é avulsa e a recorrência nasce depois, com o
//     valor do TOTAL de slots (não só dos que acabaram de ser comprados);
//   - liberar duas vezes o mesmo pagamento não dobra as conexões.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const pool = require('../../src/db/pool');
const checkoutService = require('../../src/services/checkoutService');
const planLimitsService = require('../../src/services/planLimitsService');
const clientSubscriptionsRepository = require('../../src/repositories/clientSubscriptionsRepository');
const subscriptionPlansRepository = require('../../src/repositories/subscriptionPlansRepository');
const asaasPaymentsRepository = require('../../src/repositories/asaasPaymentsRepository');
const { comAsaasFalso, respostasPadrao } = require('../helpers/asaasFalso');
const { createClient } = require('../helpers/db');

test.after(async () => {
  await pool.end();
});

const CARTAO = {
  number: '5162306219378829',
  expiryMonth: '05',
  expiryYear: '2030',
  ccv: '318',
  holderName: 'MARCELO H ALMEIDA',
};
const TITULAR = {
  nome: 'Marcelo Henrique Almeida',
  documento: '52998224725',
  email: 'm@teste.local',
  cep: '89223005',
  numeroEndereco: '277',
};

async function clientePronto(planKey, chamadas) {
  const cliente = await createClient();
  const plano = await subscriptionPlansRepository.findByKey(planKey);
  await clientSubscriptionsRepository.setPlan(cliente.id, plano.id);
  await checkoutService.salvarCartao({
    clientUserId: cliente.id,
    dadosDoTitular: TITULAR,
    cartao: CARTAO,
    remoteIp: '1.2.3.4',
    email: cliente.email,
  });
  if (chamadas) chamadas.length = 0;
  return { cliente, plano };
}

test('cada conexão extra vale 1 canal E 1 conta a mais', async () => {
  await comAsaasFalso(respostasPadrao(), async (chamadas) => {
    const { cliente, plano } = await clientePronto('max', chamadas);

    const antes = await planLimitsService.checkChannelLimit(cliente.id, plano.max_youtube_channels);
    assert.equal(antes.allowed, false, 'no limite do plano, tem que barrar');

    await checkoutService.comprarSlotsExtras({ clientUserId: cliente.id, quantidade: 2, remoteIp: '1.2.3.4' });

    const sub = await clientSubscriptionsRepository.getOrCreate(cliente.id);
    assert.equal(Number(sub.extra_slots), 2);

    const limites = planLimitsService.limitesDe(sub);
    assert.equal(limites.canais, plano.max_youtube_channels + 2);
    assert.equal(limites.contas, plano.max_tiktok_accounts + 2);

    // O limite que a tela mostra tem que ser o mesmo que o servidor aplica.
    const depois = await planLimitsService.checkChannelLimit(cliente.id, plano.max_youtube_channels);
    assert.equal(depois.allowed, true);
    const noNovoTeto = await planLimitsService.checkTiktokAccountLimit(cliente.id, limites.contas);
    assert.equal(noNovoTeto.allowed, false, 'o teto novo também é um teto');
  });
});

test('cobra o mês corrente à vista e deixa a recorrência com o valor do TOTAL de slots', async () => {
  await comAsaasFalso(respostasPadrao(), async (chamadas) => {
    const { cliente, plano } = await clientePronto('max', chamadas);

    await checkoutService.comprarSlotsExtras({ clientUserId: cliente.id, quantidade: 1, remoteIp: '1.2.3.4' });

    const cobranca = chamadas.find((c) => c.metodo === 'POST' && c.caminho === '/payments');
    assert.equal(cobranca.corpo.value, plano.extra_slot_price_cents / 100, 'o mês corrente sai à vista');

    const assinatura = chamadas.find((c) => c.metodo === 'POST' && c.caminho === '/subscriptions');
    assert.equal(assinatura.corpo.value, plano.extra_slot_price_cents / 100);

    // Comprando mais uma: a recorrência passa a valer 2 slots, não 1.
    chamadas.length = 0;
    await checkoutService.comprarSlotsExtras({ clientUserId: cliente.id, quantidade: 1, remoteIp: '1.2.3.4' });

    const ajuste = chamadas.find((c) => c.metodo === 'POST' && c.caminho.startsWith('/subscriptions/'));
    assert.ok(ajuste, 'a assinatura existente tem que ser ajustada, não duplicada');
    assert.equal(ajuste.corpo.value, (plano.extra_slot_price_cents * 2) / 100);
    assert.equal(ajuste.corpo.updatePendingPayments, true);

    assert.ok(
      !chamadas.some((c) => c.metodo === 'POST' && c.caminho === '/subscriptions'),
      'duas assinaturas de extras cobrariam o cliente duas vezes'
    );
  });
});

test('devolver a última conexão cancela a assinatura de extras', async () => {
  await comAsaasFalso(respostasPadrao(), async (chamadas) => {
    const { cliente } = await clientePronto('max', chamadas);
    await checkoutService.comprarSlotsExtras({ clientUserId: cliente.id, quantidade: 1, remoteIp: '1.2.3.4' });

    chamadas.length = 0;
    const total = await checkoutService.removerSlotsExtras({ clientUserId: cliente.id, quantidade: 1 });
    assert.equal(total, 0);

    assert.ok(
      chamadas.some((c) => c.metodo === 'DELETE' && c.caminho.startsWith('/subscriptions/')),
      'sem cancelar, o cliente continuaria pagando por conexão que não tem mais'
    );

    const sub = await clientSubscriptionsRepository.getOrCreate(cliente.id);
    assert.equal(Number(sub.extra_slots), 0);
    assert.equal(sub.asaas_extra_slots_subscription_id, null);
  });
});

test('plano que não vende conexão extra recusa a compra', async () => {
  await comAsaasFalso(respostasPadrao(), async (chamadas) => {
    const { cliente } = await clientePronto('starter', chamadas);

    await assert.rejects(
      () => checkoutService.comprarSlotsExtras({ clientUserId: cliente.id, quantidade: 1, remoteIp: '1.2.3.4' }),
      (err) => {
        assert.equal(err.name, 'DadosInvalidosError');
        assert.match(err.message, /não vende conexões extras/);
        return true;
      }
    );
    assert.equal(chamadas.length, 0, 'nada pode ser cobrado numa compra que o plano não permite');
  });
});

test('sem plano, conexão extra não existe — nem para comprar, nem para liberar limite', async () => {
  await comAsaasFalso(respostasPadrao(), async () => {
    const cliente = await createClient();
    await clientSubscriptionsRepository.getOrCreate(cliente.id);

    await assert.rejects(
      () => checkoutService.comprarSlotsExtras({ clientUserId: cliente.id, quantidade: 1, remoteIp: '1.2.3.4' }),
      /Assine um plano/
    );

    // Mesmo forçando slots no banco: sem plano, o limite continua zero. Slot
    // não pode virar uma porta lateral para usar o sistema sem assinatura.
    await pool.query('UPDATE client_subscriptions SET extra_slots = 5 WHERE client_user_id = $1', [cliente.id]);
    const sub = await clientSubscriptionsRepository.getOrCreate(cliente.id);
    assert.deepEqual(planLimitsService.limitesDe(sub), { canais: 0, contas: 0, extras: 0, semPlano: true });
    const check = await planLimitsService.checkChannelLimit(cliente.id, 0);
    assert.equal(check.allowed, false);
  });
});

test('aviso repetido do Asaas não dobra as conexões', async () => {
  await comAsaasFalso(respostasPadrao(), async (chamadas) => {
    const { cliente } = await clientePronto('max', chamadas);
    const r = await checkoutService.comprarSlotsExtras({ clientUserId: cliente.id, quantidade: 1, remoteIp: '1.2.3.4' });

    const registro = await asaasPaymentsRepository.findByAsaasId(r.paymentId);
    await checkoutService.aplicarPagamentoConfirmado(registro);
    await checkoutService.aplicarPagamentoConfirmado(registro);

    const sub = await clientSubscriptionsRepository.getOrCreate(cliente.id);
    assert.equal(Number(sub.extra_slots), 1, 'o Asaas entrega "pelo menos uma vez" — repetir é o normal');
  });
});
