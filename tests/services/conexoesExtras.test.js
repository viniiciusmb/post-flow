// Conexões extras: mais um canal do YouTube, ou mais uma conta do TikTok.
//
// Até 01/09/2026 era um pacote fechado — 1 canal E 1 conta, indivisível — e
// quem só queria mais um canal pagava pelos dois. Agora são dois produtos:
//
//   canal do YouTube ....... R$ 14,90
//   conta do TikTok ........ R$ 29,90
//   os dois juntos ......... R$ 39,90
//
// O que estes testes travam:
//   - canal e conta são contadores INDEPENDENTES (comprar canal não dá conta);
//   - o desconto do par vale por par, e o preço vem do plano, nunca do cliente;
//   - o limite EFETIVO é plano + comprado, e é o mesmo número que o servidor
//     usa para barrar (mostrar um e barrar por outro faz o cliente achar que
//     pagou por algo que não veio);
//   - quem não tem plano continua barrado, com ou sem extras;
//   - só o plano que vende extras pode comprar;
//   - a cobrança de agora é avulsa e a recorrência nasce ALINHADA ao ciclo do
//     plano, um ciclo depois — a regra de junção que o fundador pediu;
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

test('canal e conta são contadores independentes', async () => {
  await comAsaasFalso(respostasPadrao(), async (chamadas) => {
    const { cliente, plano } = await clientePronto('max', chamadas);

    const antes = await planLimitsService.checkChannelLimit(cliente.id, plano.max_youtube_channels);
    assert.equal(antes.allowed, false, 'no limite do plano, tem que barrar');

    // Compra SÓ canal: a conta do TikTok não pode subir junto.
    await checkoutService.comprarExtras({ clientUserId: cliente.id, canais: 2, contas: 0, remoteIp: '1.2.3.4' });

    const sub = await clientSubscriptionsRepository.getOrCreate(cliente.id);
    assert.equal(Number(sub.extra_channels), 2);
    assert.equal(Number(sub.extra_tiktok_accounts), 0, 'comprar canal deu conta do TikTok de brinde');

    const limites = planLimitsService.limitesDe(sub);
    assert.equal(limites.canais, plano.max_youtube_channels + 2);
    assert.equal(limites.contas, plano.max_tiktok_accounts, 'o limite de contas não podia ter mudado');

    // O limite que a tela mostra tem que ser o mesmo que o servidor aplica.
    const depois = await planLimitsService.checkChannelLimit(cliente.id, plano.max_youtube_channels);
    assert.equal(depois.allowed, true);
    const noNovoTeto = await planLimitsService.checkTiktokAccountLimit(cliente.id, limites.contas);
    assert.equal(noNovoTeto.allowed, false, 'o teto novo também é um teto');

    // E agora só conta: o canal fica onde está.
    await checkoutService.comprarExtras({ clientUserId: cliente.id, canais: 0, contas: 1, remoteIp: '1.2.3.4' });
    const depoisDaConta = await clientSubscriptionsRepository.getOrCreate(cliente.id);
    assert.equal(Number(depoisDaConta.extra_channels), 2, 'comprar conta mexeu no número de canais');
    assert.equal(Number(depoisDaConta.extra_tiktok_accounts), 1);
  });
});

test('o par sai mais barato que os dois separados, e o preço vem do plano', async () => {
  await comAsaasFalso(respostasPadrao(), async (chamadas) => {
    const { cliente, plano } = await clientePronto('max', chamadas);

    await checkoutService.comprarExtras({ clientUserId: cliente.id, canais: 1, contas: 1, remoteIp: '1.2.3.4' });

    const cobranca = chamadas.find((c) => c.metodo === 'POST' && c.caminho === '/payments');
    assert.equal(cobranca.corpo.value, plano.extra_both_price_cents / 100, 'o par tem que sair pelo preço do par');
    assert.ok(
      plano.extra_both_price_cents < plano.extra_channel_price_cents + plano.extra_tiktok_price_cents,
      'o par precisa ser mais barato que comprar separado, senão o desconto não existe'
    );

    const assinatura = chamadas.find((c) => c.metodo === 'POST' && c.caminho === '/subscriptions');
    assert.equal(assinatura.corpo.value, plano.extra_both_price_cents / 100, 'a mensalidade segue a mesma conta da compra');

    // Comprando mais um canal: a recorrência passa a valer o TOTAL.
    chamadas.length = 0;
    await checkoutService.comprarExtras({ clientUserId: cliente.id, canais: 1, contas: 0, remoteIp: '1.2.3.4' });

    const cobranca2 = chamadas.find((c) => c.metodo === 'POST' && c.caminho === '/payments');
    assert.equal(cobranca2.corpo.value, plano.extra_channel_price_cents / 100, 'canal sozinho é preço de canal');

    const ajuste = chamadas.find((c) => c.metodo === 'POST' && c.caminho.startsWith('/subscriptions/'));
    assert.ok(ajuste, 'a assinatura existente tem que ser ajustada, não duplicada');
    // 2 canais + 1 conta = 1 par + 1 canal solto.
    assert.equal(ajuste.corpo.value, (plano.extra_both_price_cents + plano.extra_channel_price_cents) / 100);
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
    await checkoutService.comprarExtras({ clientUserId: cliente.id, canais: 1, contas: 0, remoteIp: '1.2.3.4' });

    chamadas.length = 0;
    const totais = await checkoutService.removerExtras({ clientUserId: cliente.id, canais: 1 });
    assert.deepEqual(totais, { canais: 0, contas: 0 });

    assert.ok(
      chamadas.some((c) => c.metodo === 'DELETE' && c.caminho.startsWith('/subscriptions/')),
      'sem cancelar, o cliente continuaria pagando por conexão que não tem mais'
    );

    const sub = await clientSubscriptionsRepository.getOrCreate(cliente.id);
    assert.equal(Number(sub.extra_channels), 0);
    assert.equal(Number(sub.extra_tiktok_accounts), 0);
    assert.equal(sub.asaas_extra_slots_subscription_id, null);
  });
});

test('plano que não vende conexão extra recusa a compra', async () => {
  await comAsaasFalso(respostasPadrao(), async (chamadas) => {
    const { cliente } = await clientePronto('starter', chamadas);

    await assert.rejects(
      () => checkoutService.comprarExtras({ clientUserId: cliente.id, canais: 1, remoteIp: '1.2.3.4' }),
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
      () => checkoutService.comprarExtras({ clientUserId: cliente.id, canais: 1, remoteIp: '1.2.3.4' }),
      /Assine um plano/
    );

    // Mesmo forçando slots no banco: sem plano, o limite continua zero. Slot
    // não pode virar uma porta lateral para usar o sistema sem assinatura.
    await pool.query(
      'UPDATE client_subscriptions SET extra_channels = 5, extra_tiktok_accounts = 5 WHERE client_user_id = $1',
      [cliente.id]
    );
    const sub = await clientSubscriptionsRepository.getOrCreate(cliente.id);
    assert.deepEqual(planLimitsService.limitesDe(sub), { canais: 0, contas: 0, extras: 0, semPlano: true });
    const check = await planLimitsService.checkChannelLimit(cliente.id, 0);
    assert.equal(check.allowed, false);
  });
});

test('aviso repetido do Asaas não dobra as conexões', async () => {
  await comAsaasFalso(respostasPadrao(), async (chamadas) => {
    const { cliente } = await clientePronto('max', chamadas);
    const r = await checkoutService.comprarExtras({ clientUserId: cliente.id, canais: 1, contas: 1, remoteIp: '1.2.3.4' });

    const registro = await asaasPaymentsRepository.findByAsaasId(r.paymentId);
    await checkoutService.aplicarPagamentoConfirmado(registro);
    await checkoutService.aplicarPagamentoConfirmado(registro);

    const sub = await clientSubscriptionsRepository.getOrCreate(cliente.id);
    assert.equal(Number(sub.extra_channels), 1, 'o Asaas entrega "pelo menos uma vez" — repetir é o normal');
    assert.equal(Number(sub.extra_tiktok_accounts), 1);
  });
});
