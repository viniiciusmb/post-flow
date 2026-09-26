// A venda do PIX Automático na Utmify, no mesmo desenho do Interactive Live.
//
// Até 26/09/2026 o PIX Automático só avisava a Utmify quando a autorização
// ativava - e nem isso funcionava (o webhook lia o campo errado). Quem gerava o
// QR e não pagava nunca aparecia no funil, e quem pagava surgia já como paga.
//
// O que estes testes travam:
//   - gerar o QR anuncia "aguardando pagamento";
//   - gerar outro QR do mesmo plano logo depois é o MESMO pedido, sem aviso
//     repetido (três QR em cinco minutos viravam três vendas pendentes no
//     Interactive Live);
//   - o pagamento fecha esse mesmo pedido como pago;
//   - QR que morre sem pagamento vira "recusado" - exceto quando a pessoa já
//     gerou outro, porque aí ela ainda está tentando.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const pool = require('../../src/db/pool');
const asaasBillingService = require('../../src/services/asaasBillingService');
const utmifyService = require('../../src/services/utmifyService');
const clientSubscriptionsRepository = require('../../src/repositories/clientSubscriptionsRepository');
const subscriptionPlansRepository = require('../../src/repositories/subscriptionPlansRepository');
const webhook = require('../../src/web/controllers/api/asaasWebhookApiController');
const { comAsaasFalso, respostasPadrao } = require('../helpers/asaasFalso');
const { comUtmifyFalsa } = require('../helpers/utmifyFalsa');
const { createClient } = require('../helpers/db');

test.after(async () => {
  await pool.end();
});

async function cenario() {
  const cliente = await createClient();
  await clientSubscriptionsRepository.getOrCreate(cliente.id);
  const planos = await subscriptionPlansRepository.listActive();
  return { cliente, plano: planos[0] };
}

function gerarQr(cliente, plano) {
  return asaasBillingService.createPixAutomaticSubscription({
    clientUserId: cliente.id,
    plan: plano,
    customerId: 'cus_falso',
    primeiraCobrancaCents: 5990,
    remoteIp: '200.1.2.3',
  });
}

test('gerar o QR anuncia pendente; gerar de novo é o mesmo pedido, sem aviso repetido', async () => {
  await comAsaasFalso(respostasPadrao(), async () => {
    await comUtmifyFalsa(async (pedidos) => {
      const { cliente, plano } = await cenario();

      const primeiro = await gerarQr(cliente, plano);
      await utmifyService.aguardarEnvios();
      const segundo = await gerarQr(cliente, plano);
      await utmifyService.aguardarEnvios();

      const { rows } = await pool.query(
        'SELECT asaas_authorization_id, utmify_order_id, customer_ip FROM asaas_pix_authorizations WHERE client_user_id = $1 ORDER BY id',
        [cliente.id]
      );
      assert.equal(rows.length, 2);
      assert.equal(rows[0].asaas_authorization_id, primeiro.authorizationId);
      assert.equal(rows[1].asaas_authorization_id, segundo.authorizationId);
      assert.equal(rows[1].utmify_order_id, rows[0].utmify_order_id, 'duas tentativas da mesma compra são UM pedido');
      assert.equal(rows[0].customer_ip, '200.1.2.3');

      const doCliente = pedidos.filter((p) => p.corpo.orderId === rows[0].utmify_order_id);
      assert.equal(doCliente.length, 1, 'o segundo QR não pode anunciar a mesma venda de novo');
      assert.equal(doCliente[0].corpo.status, 'waiting_payment');
      assert.equal(doCliente[0].corpo.paymentMethod, 'pix');
      assert.equal(doCliente[0].corpo.customer.ip, '200.1.2.3');
    });
  });
});

test('o pagamento fecha como pago o MESMO pedido que foi anunciado pendente', async () => {
  await comUtmifyFalsa(async (pedidos) => {
    const { cliente, plano } = await cenario();
    let authId;
    await comAsaasFalso(respostasPadrao(), async () => {
      authId = (await gerarQr(cliente, plano)).authorizationId;
      await utmifyService.aguardarEnvios();
    });

    await comAsaasFalso(
      {
        'GET /pix/automatic/authorizations/:id': () => ({
          body: { id: authId, status: 'ACTIVE', subscriptionId: `sub_${authId}`, immediateQrCode: { conciliationIdentifier: `C_${authId}` } },
        }),
        'GET /payments': () => ({
          body: { data: [{ id: `pay_${authId}`, pixQrCodeId: `C_${authId}`, status: 'RECEIVED', value: 59.9, paymentDate: '2026-09-26' }] },
        }),
      },
      async () => {
        await webhook.handlePixAuthorizationActivated({ id: authId });
        await utmifyService.aguardarEnvios();
      }
    );

    const { rows } = await pool.query('SELECT utmify_order_id FROM asaas_pix_authorizations WHERE asaas_authorization_id = $1', [authId]);
    const doPedido = pedidos.filter((p) => p.corpo.orderId === rows[0].utmify_order_id).map((p) => p.corpo.status);
    assert.deepEqual(doPedido, ['waiting_payment', 'paid'], 'pendente e pago precisam ser o mesmo pedido');

    const pago = pedidos.find((p) => p.corpo.status === 'paid' && p.corpo.orderId === rows[0].utmify_order_id);
    assert.equal(pago.corpo.customer.ip, '200.1.2.3', 'o IP vem da hora do QR - o webhook não tem ele');
    assert.equal(pago.corpo.commission.totalPriceInCents, 5990);
  });
});

test('QR que morre sem pagamento vira recusado', async () => {
  await comUtmifyFalsa(async (pedidos) => {
    const { cliente, plano } = await cenario();
    let authId;
    await comAsaasFalso(respostasPadrao(), async () => {
      authId = (await gerarQr(cliente, plano)).authorizationId;
      await utmifyService.aguardarEnvios();
    });

    await webhook.handlePixAuthorizationEncerrada(authId, 'expirada');
    await utmifyService.aguardarEnvios();

    const { rows } = await pool.query('SELECT utmify_order_id FROM asaas_pix_authorizations WHERE asaas_authorization_id = $1', [authId]);
    const status = pedidos.filter((p) => p.corpo.orderId === rows[0].utmify_order_id).map((p) => p.corpo.status);
    assert.deepEqual(status, ['waiting_payment', 'refused']);
  });
});

test('QR antigo que morre enquanto a pessoa já gerou outro NÃO vira recusado', async () => {
  await comUtmifyFalsa(async (pedidos) => {
    const { cliente, plano } = await cenario();
    let primeiro;
    await comAsaasFalso(respostasPadrao(), async () => {
      primeiro = (await gerarQr(cliente, plano)).authorizationId;
      await gerarQr(cliente, plano);
      await utmifyService.aguardarEnvios();
    });

    await webhook.handlePixAuthorizationCancelada(primeiro);
    await utmifyService.aguardarEnvios();

    const { rows } = await pool.query('SELECT utmify_order_id FROM asaas_pix_authorizations WHERE asaas_authorization_id = $1', [primeiro]);
    const status = pedidos.filter((p) => p.corpo.orderId === rows[0].utmify_order_id).map((p) => p.corpo.status);
    assert.deepEqual(status, ['waiting_payment'], 'a pessoa ainda está pagando pelo QR novo');
  });
});
