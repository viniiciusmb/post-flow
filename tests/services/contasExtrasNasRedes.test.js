// Conta extra nas redes sociais (12/10/2026): R$ 9,90 por conta por mês, a rede
// escolhida na compra, em TODOS os planos. Soma ao limite do plano só naquela
// rede. Mesmo mecanismo dos extras de canal/TikTok: cobrança avulsa agora e a
// mensalidade junto com a do plano.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const pool = require('../../src/db/pool');
const checkoutService = require('../../src/services/checkoutService');
const planLimitsService = require('../../src/services/planLimitsService');
const clientSubscriptionsRepository = require('../../src/repositories/clientSubscriptionsRepository');
const subscriptionPlansRepository = require('../../src/repositories/subscriptionPlansRepository');
const asaasPaymentsRepository = require('../../src/repositories/asaasPaymentsRepository');
const socialPostingsRepository = require('../../src/repositories/socialPostingsRepository');
const { precoDosExtras } = require('../../src/lib/precoDasConexoesExtras');
const { comAsaasFalso, respostasPadrao } = require('../helpers/asaasFalso');
const { createClient } = require('../helpers/db');

test.after(async () => {
  await pool.end();
});

const CARTAO = { number: '5162306219378829', expiryMonth: '05', expiryYear: '2030', ccv: '318', holderName: 'MARCELO H ALMEIDA' };
const TITULAR = { nome: 'Marcelo Henrique Almeida', documento: '52998224725', email: 'm@teste.local', cep: '89223005', numeroEndereco: '277' };

async function clientePronto(planKey, chamadas) {
  const cliente = await createClient();
  const plano = await subscriptionPlansRepository.findByKey(planKey);
  await clientSubscriptionsRepository.setPlan(cliente.id, plano.id);
  await checkoutService.salvarCartao({ clientUserId: cliente.id, dadosDoTitular: TITULAR, cartao: CARTAO, remoteIp: '1.2.3.4', email: cliente.email });
  if (chamadas) chamadas.length = 0;
  return { cliente, plano };
}

let n = 0;
async function contaSocial(userId, network, minutosAtras = 0) {
  const { rows } = await pool.query(
    `INSERT INTO social_accounts (client_user_id, network, outstand_account_id, username, connected_at)
     VALUES ($1, $2, $3, 'p', now() - make_interval(mins => $4::int)) RETURNING id`,
    [userId, network, `acc_extra_${process.pid}_${Date.now()}_${n++}`, minutosAtras]
  );
  return Number(rows[0].id);
}

test('os três planos vendem a conta extra nas redes, a R$ 9,90', async () => {
  for (const key of ['starter', 'pro', 'max']) {
    const p = await subscriptionPlansRepository.findByKey(key);
    assert.equal(Number(p.extra_rede_price_cents), 990, key);
  }
});

test('Starter compra +1 Instagram: cobra R$ 9,90, o limite sobe só no Instagram, e a mensalidade nasce junto', async () => {
  await comAsaasFalso(respostasPadrao(), async (chamadas) => {
    const { cliente } = await clientePronto('starter', chamadas);
    assert.equal((await planLimitsService.checkSocialAccountLimit(cliente.id, 'instagram', 1)).allowed, false);

    const r = await checkoutService.comprarExtras({ clientUserId: cliente.id, redes: { instagram: 1 }, remoteIp: '1.2.3.4' });
    assert.equal(r.pago, true);

    const cobranca = chamadas.find((c) => c.metodo === 'POST' && c.caminho === '/payments');
    assert.equal(cobranca.corpo.value, 9.9);
    assert.match(cobranca.corpo.description, /1 conta\(s\) do Instagram/);
    const assinatura = chamadas.find((c) => c.metodo === 'POST' && c.caminho === '/subscriptions');
    assert.equal(assinatura.corpo.value, 9.9, 'a mensalidade usa a mesma conta da compra');

    const sub = await clientSubscriptionsRepository.getOrCreate(cliente.id);
    assert.deepEqual(sub.extra_redes, { instagram: 1 });
    assert.equal((await planLimitsService.checkSocialAccountLimit(cliente.id, 'instagram', 1)).allowed, true, 'agora cabem 2 Instagrams');
    assert.equal((await planLimitsService.checkSocialAccountLimit(cliente.id, 'instagram', 2)).allowed, false);
    assert.equal((await planLimitsService.checkSocialAccountLimit(cliente.id, 'facebook', 1)).allowed, false, 'as outras redes não mudam');
  });
});

test('a conta que estava fora do plano volta a publicar quando o extra é comprado', async () => {
  await comAsaasFalso(respostasPadrao(), async (chamadas) => {
    const { cliente } = await clientePronto('starter', chamadas);
    await contaSocial(cliente.id, 'instagram', 60);
    const segunda = await contaSocial(cliente.id, 'instagram', 1);
    await pool.query(
      `INSERT INTO social_postings (client_user_id, social_account_id, clip_id, caption, status, scheduled_for)
       SELECT $1, $2, c.id, 'x', 'pending', now() - interval '1 minute' FROM clips c LIMIT 0`,
      [cliente.id, segunda]
    );
    const dentro = async () =>
      (await pool.query(`SELECT ${require('../../src/repositories/socialAccountsRepository').dentroDoPlanoSql('sa')} AS ok FROM social_accounts sa WHERE sa.id = $1`, [segunda])).rows[0].ok;
    assert.equal(await dentro(), false);
    await checkoutService.comprarExtras({ clientUserId: cliente.id, redes: { instagram: 1 }, remoteIp: '1.2.3.4' });
    assert.equal(await dentro(), true);
    assert.ok(Array.isArray(await socialPostingsRepository.contasQuePublicamSozinhas()));
  });
});

test('Max mistura canal do YouTube com contas nas redes: cada uma pelo seu preço', async () => {
  await comAsaasFalso(respostasPadrao(), async (chamadas) => {
    const { cliente, plano } = await clientePronto('max', chamadas);
    await checkoutService.comprarExtras({ clientUserId: cliente.id, canais: 1, redes: { facebook: 2 }, remoteIp: '1.2.3.4' });
    const cobranca = chamadas.find((c) => c.metodo === 'POST' && c.caminho === '/payments');
    assert.equal(Math.round(cobranca.corpo.value * 100), Number(plano.extra_channel_price_cents) + 2 * 990);
  });
});

test('Starter compra conta do TikTok por R$ 9,90 e canal do YouTube pelo preço do canal', async () => {
  await comAsaasFalso(respostasPadrao(), async (chamadas) => {
    const { cliente, plano } = await clientePronto('starter', chamadas);
    await checkoutService.comprarExtras({ clientUserId: cliente.id, contas: 1, remoteIp: '1.2.3.4' });
    let cobranca = chamadas.filter((c) => c.metodo === 'POST' && c.caminho === '/payments').at(-1);
    assert.equal(Math.round(cobranca.corpo.value * 100), 990);
    await checkoutService.comprarExtras({ clientUserId: cliente.id, canais: 1, remoteIp: '1.2.3.4' });
    cobranca = chamadas.filter((c) => c.metodo === 'POST' && c.caminho === '/payments').at(-1);
    assert.equal(Math.round(cobranca.corpo.value * 100), Number(plano.extra_channel_price_cents));
    const limites = planLimitsService.limitesDe(await clientSubscriptionsRepository.getOrCreate(cliente.id));
    assert.equal(limites.contas, plano.max_tiktok_accounts + 1);
    assert.equal(limites.canais, plano.max_youtube_channels + 1);
  });
});

test('YouTube Shorts não vende conta extra; rede inventada não vira compra; nada é cobrado', async () => {
  await comAsaasFalso(respostasPadrao(), async (chamadas) => {
    const { cliente } = await clientePronto('max', chamadas);
    await assert.rejects(
      () => checkoutService.comprarExtras({ clientUserId: cliente.id, redes: { youtube: 1 }, remoteIp: '1.2.3.4' }),
      /YouTube Shorts não está à venda/
    );
    await assert.rejects(
      () => checkoutService.comprarExtras({ clientUserId: cliente.id, redes: { youtube: 1, instagram: 1 }, remoteIp: '1.2.3.4' }),
      /YouTube Shorts não está à venda/,
      'misturar o YouTube com outra rede não pode passar'
    );
    await assert.rejects(() => checkoutService.comprarExtras({ clientUserId: cliente.id, redes: { orkut: 3 }, remoteIp: '1.2.3.4' }), /pelo menos uma conexão/);
    assert.equal(chamadas.filter((c) => c.metodo === 'POST' && c.caminho === '/payments').length, 0);
  });
});

test('estorno e devolução tiram só o que foi comprado, e a mensalidade acompanha', async () => {
  await comAsaasFalso(respostasPadrao(), async (chamadas) => {
    const { cliente } = await clientePronto('pro', chamadas);
    const r1 = await checkoutService.comprarExtras({ clientUserId: cliente.id, redes: { instagram: 1 }, remoteIp: '1.2.3.4' });
    await checkoutService.comprarExtras({ clientUserId: cliente.id, redes: { instagram: 1, threads: 1 }, remoteIp: '1.2.3.4' });
    let sub = await clientSubscriptionsRepository.getOrCreate(cliente.id);
    assert.deepEqual(sub.extra_redes, { instagram: 2, threads: 1 });

    const registro = await asaasPaymentsRepository.findByAsaasId(r1.paymentId);
    await checkoutService.aplicarEstorno(registro, 'PAYMENT_REFUNDED');
    sub = await clientSubscriptionsRepository.getOrCreate(cliente.id);
    assert.deepEqual(sub.extra_redes, { instagram: 1, threads: 1 }, 'o estorno tira só a compra estornada');

    chamadas.length = 0;
    await checkoutService.removerExtras({ clientUserId: cliente.id, redes: { instagram: 1, threads: 1 } });
    sub = await clientSubscriptionsRepository.getOrCreate(cliente.id);
    assert.deepEqual(sub.extra_redes, {});
    assert.ok(chamadas.some((c) => c.metodo === 'DELETE' && c.caminho.startsWith('/subscriptions/')), 'sem extras, a mensalidade dos extras é cancelada');
  });
});

test('preço: sem par, cada item sai pelo seu preço; com par (se um dia voltar), o desconto vale por par', () => {
  const hoje = { canal: 1490, conta: 990, ambos: null, rede: 990 };
  assert.equal(precoDosExtras({ canais: 1, contas: 1, redes: { instagram: 1, bluesky: 2 } }, hoje).totalCents, 1490 + 990 + 3 * 990);
  const comPar = { canal: 1490, conta: 2990, ambos: 3990, rede: 990 };
  assert.equal(precoDosExtras({ canais: 1, contas: 1, redes: { instagram: 1, bluesky: 2 } }, comPar).totalCents, 3990 + 3 * 990);
  assert.equal(precoDosExtras({ redes: { instagram: 1 } }, { canal: null, conta: null, ambos: null, rede: 990 }).totalCents, 990);
});
