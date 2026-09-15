// A venda chega à Utmify — pendente quando nasce, aprovada quando o dinheiro
// entra.
//
// A integração nativa do Asaas com a Utmify enxerga a cobrança, mas não a
// ORIGEM dela: de que anúncio, link ou campanha veio aquele cliente. Isso só
// existe do nosso lado (capturado na landing, gravado em `referrals` no
// cadastro), e é exatamente o motivo de a Utmify existir. Por isso o aviso sai
// daqui.
//
// O que estes testes travam:
//   - toda cobrança criada vira "venda pendente", e toda confirmação vira
//     "venda aprovada", com o MESMO orderId (o id da cobrança no Asaas) —
//     é ele que impede a mesma venda de aparecer duas vezes no painel;
//   - a UTM gravada no cadastro viaja junto com a venda;
//   - aviso repetido do Asaas não vira venda repetida;
//   - o segundo aviso de um mesmo pedido só sai depois de o primeiro terminar
//     — soltos ao mesmo tempo, a Utmify pode processá-los em qualquer ordem e
//     a venda fica parada como pendente num painel onde ela já foi paga;
//   - a Utmify fora do ar, lenta ou sem token NÃO impede ninguém de pagar.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const pool = require('../../src/db/pool');
const config = require('../../src/config');
const checkoutService = require('../../src/services/checkoutService');
const utmifyService = require('../../src/services/utmifyService');
const clientSubscriptionsRepository = require('../../src/repositories/clientSubscriptionsRepository');
const subscriptionPlansRepository = require('../../src/repositories/subscriptionPlansRepository');
const asaasPaymentsRepository = require('../../src/repositories/asaasPaymentsRepository');
const referralsRepository = require('../../src/repositories/referralsRepository');
const { comAsaasFalso, respostasPadrao } = require('../helpers/asaasFalso');
const { comUtmifyFalsa, semUtmify } = require('../helpers/utmifyFalsa');
const { createClient } = require('../helpers/db');

test.after(async () => {
  await pool.end();
});

const CARTAO = { number: '5162306219378829', expiryMonth: '05', expiryYear: '2030', ccv: '318', holderName: 'M H A' };
const TITULAR = {
  nome: 'Marcelo Henrique Almeida',
  documento: '529.982.247-25',
  email: 'marcelo@teste.local',
  cep: '89223-005',
  numeroEndereco: '277',
};

async function clienteComCartao() {
  const cliente = await createClient();
  await clientSubscriptionsRepository.getOrCreate(cliente.id);
  await checkoutService.salvarCartao({
    clientUserId: cliente.id,
    dadosDoTitular: TITULAR,
    cartao: CARTAO,
    remoteIp: '200.1.2.3',
    email: cliente.email,
  });
  return cliente;
}

async function planoMax() {
  const planos = await subscriptionPlansRepository.listActive();
  return planos.find((p) => p.key === 'max') || planos[planos.length - 1];
}

test('assinar manda venda pendente e depois venda aprovada, no mesmo pedido', async () => {
  await comAsaasFalso(respostasPadrao(), async () => {
    await comUtmifyFalsa(async (pedidos) => {
      const cliente = await clienteComCartao();
      const plan = await planoMax();

      const r = await checkoutService.assinarComCartaoSalvo({ clientUserId: cliente.id, plan, remoteIp: '200.1.2.3' });
      assert.equal(r.pago, true);
      await utmifyService.aguardarEnvios();

      assert.equal(pedidos.length, 2, 'tem que sair exatamente uma venda pendente e uma aprovada');
      const [pendente, aprovada] = pedidos.map((p) => p.corpo);

      assert.equal(pendente.status, 'waiting_payment');
      assert.equal(aprovada.status, 'paid');
      // O mesmo pedido nos dois avisos: é isso que faz a Utmify ATUALIZAR a
      // venda em vez de criar uma segunda.
      assert.equal(pendente.orderId, r.paymentId);
      assert.equal(aprovada.orderId, r.paymentId);
      assert.equal(pedidos[0].token, 'token-de-teste');

      assert.equal(aprovada.paymentMethod, 'credit_card');
      assert.equal(aprovada.products[0].priceInCents, r.preco.primeiraCobrancaCents);
      assert.equal(aprovada.commission.totalPriceInCents, r.preco.primeiraCobrancaCents);
      assert.equal(aprovada.products[0].planName, plan.name);
      assert.equal(aprovada.customer.email, cliente.email);
      assert.ok(aprovada.approvedDate, 'venda aprovada precisa da data de aprovação');
      assert.equal(pendente.approvedDate, null);
    });
  });
});

test('a UTM que trouxe o cliente viaja junto com a venda', async () => {
  await comAsaasFalso(respostasPadrao(), async () => {
    await comUtmifyFalsa(async (pedidos) => {
      const cliente = await clienteComCartao();
      // Gravada no CADASTRO, semanas antes do pagamento — é o elo que a
      // integração nativa do Asaas não tem como fazer.
      await referralsRepository.create({
        referredUserId: cliente.id,
        utm: { source: 'facebook', medium: 'cpc', campaign: 'black-friday', content: 'video-1', term: 'cortes ia' },
        landingPath: '/',
      });

      await checkoutService.assinarComCartaoSalvo({ clientUserId: cliente.id, plan: await planoMax(), remoteIp: '200.1.2.3' });
      await utmifyService.aguardarEnvios();

      for (const { corpo } of pedidos) {
        assert.equal(corpo.trackingParameters.utm_source, 'facebook');
        assert.equal(corpo.trackingParameters.utm_medium, 'cpc');
        assert.equal(corpo.trackingParameters.utm_campaign, 'black-friday');
        assert.equal(corpo.trackingParameters.utm_content, 'video-1');
        assert.equal(corpo.trackingParameters.utm_term, 'cortes ia');
      }
    });
  });
});

test('cadastro direto (sem UTM) manda a venda assim mesmo, com os campos nulos', async () => {
  await comAsaasFalso(respostasPadrao(), async () => {
    await comUtmifyFalsa(async (pedidos) => {
      const cliente = await clienteComCartao();
      await checkoutService.assinarComCartaoSalvo({ clientUserId: cliente.id, plan: await planoMax(), remoteIp: '200.1.2.3' });
      await utmifyService.aguardarEnvios();

      assert.ok(pedidos.length >= 1);
      assert.equal(pedidos[0].corpo.trackingParameters.utm_source, null);
    });
  });
});

test('aviso repetido do Asaas não vira uma segunda venda aprovada', async () => {
  await comAsaasFalso(respostasPadrao(), async () => {
    await comUtmifyFalsa(async (pedidos) => {
      const cliente = await clienteComCartao();
      const plan = await planoMax();
      const r = await checkoutService.assinarComCartaoSalvo({ clientUserId: cliente.id, plan, remoteIp: '200.1.2.3' });
      await utmifyService.aguardarEnvios();
      const antes = pedidos.length;

      // O webhook chegando depois da confirmação síncrona é o caminho NORMAL,
      // não a exceção: o Asaas entrega "pelo menos uma vez".
      const registro = await asaasPaymentsRepository.findByAsaasId(r.paymentId);
      await checkoutService.aplicarPagamentoConfirmado(registro);
      await utmifyService.aguardarEnvios();

      assert.equal(pedidos.length, antes, 'a segunda confirmação não pode virar outra venda');
    });
  });
});

test('PIX fica pendente até o pagamento, e só então vira aprovada', async () => {
  await comAsaasFalso(respostasPadrao({ paymentStatus: 'PENDING' }), async () => {
    await comUtmifyFalsa(async (pedidos) => {
      const cliente = await createClient();
      await clientSubscriptionsRepository.getOrCreate(cliente.id);

      const compra = await checkoutService.comprarCreditoComPix({
        clientUserId: cliente.id,
        minutes: 30,
        bucket: 'normal',
        priceCents: 990,
        dadosDoTitular: TITULAR,
        email: cliente.email,
      });
      await utmifyService.aguardarEnvios();

      assert.equal(pedidos.length, 1);
      assert.equal(pedidos[0].corpo.status, 'waiting_payment');
      assert.equal(pedidos[0].corpo.paymentMethod, 'pix');
      assert.equal(pedidos[0].corpo.products[0].id, 'credito-avulso');

      // Agora o cliente paga no app do banco e o Asaas avisa.
      const registro = await asaasPaymentsRepository.findByAsaasId(compra.paymentId);
      await checkoutService.aplicarPagamentoConfirmado(registro);
      await utmifyService.aguardarEnvios();

      assert.equal(pedidos.length, 2);
      assert.equal(pedidos[1].corpo.status, 'paid');
      assert.equal(pedidos[1].corpo.orderId, compra.paymentId);
    });
  });
});

test('estorno vira devolução e contestação de cartão vira chargeback', async () => {
  await comAsaasFalso(respostasPadrao(), async () => {
    await comUtmifyFalsa(async (pedidos) => {
      const cliente = await clienteComCartao();
      const r = await checkoutService.assinarComCartaoSalvo({ clientUserId: cliente.id, plan: await planoMax(), remoteIp: '200.1.2.3' });
      await utmifyService.aguardarEnvios();
      pedidos.length = 0;

      const registro = await asaasPaymentsRepository.findByAsaasId(r.paymentId);
      await checkoutService.aplicarEstorno(registro, 'estorno');
      await utmifyService.aguardarEnvios();
      assert.equal(pedidos[0].corpo.status, 'refunded');
      assert.ok(pedidos[0].corpo.refundedAt, 'estorno precisa da data');

      // Outra venda, agora contestada no cartão. São linhas diferentes no
      // painel: uma é disputa, a outra é devolução combinada.
      const cliente2 = await clienteComCartao();
      const r2 = await checkoutService.assinarComCartaoSalvo({ clientUserId: cliente2.id, plan: await planoMax(), remoteIp: '200.1.2.3' });
      await utmifyService.aguardarEnvios();
      pedidos.length = 0;

      const registro2 = await asaasPaymentsRepository.findByAsaasId(r2.paymentId);
      await checkoutService.aplicarEstorno(registro2, 'contestacao no cartao');
      await utmifyService.aguardarEnvios();
      assert.equal(pedidos[0].corpo.status, 'chargedback');
    });
  });
});

test('o segundo aviso do mesmo pedido só sai depois de o primeiro terminar', async () => {
  // A garantia não é "chegaram na ordem certa" — duas requisições soltas quase
  // sempre CHEGAM na ordem em que foram disparadas, e um teste que olhasse só
  // isso passaria com a fila removida (verificado por mutação). A garantia é
  // que a segunda nem é ENVIADA enquanto a primeira não termina. Sem ela,
  // as duas ficam pendentes ao mesmo tempo na Utmify, que pode processá-las
  // em qualquer ordem — e a venda fica parada como pendente num painel onde
  // ela já foi paga.
  let aindaEmVooQuandoAPrimeiraTerminou = null;

  await comUtmifyFalsa(
    async (pedidos) => {
      const registro = {
        asaas_payment_id: 'pay_ordem_1',
        client_user_id: (await createClient()).id,
        purpose: 'subscription',
        billing_type: 'CREDIT_CARD',
        amount_cents: 13990,
        created_at: new Date(),
        paid_at: new Date(),
      };

      utmifyService.vendaPendente(registro);
      utmifyService.vendaPaga(registro);
      await utmifyService.aguardarEnvios();

      assert.equal(
        aindaEmVooQuandoAPrimeiraTerminou,
        1,
        'a segunda venda chegou antes de a primeira terminar - a fila por pedido não está segurando'
      );
      assert.deepEqual(
        pedidos.map((p) => p.corpo.status),
        ['waiting_payment', 'paid']
      );
    },
    {
      resposta: async (corpo, pedidos) => {
        if (corpo.status === 'waiting_payment') {
          await new Promise((r) => setTimeout(r, 150));
          // Quantas requisições existem no momento em que a primeira acaba.
          // Com a fila, só ela mesma.
          aindaEmVooQuandoAPrimeiraTerminou = pedidos.length;
        }
        return { status: 200, body: { ok: true } };
      },
    }
  );
});

test('Utmify fora do ar não impede o cliente de pagar', async () => {
  await comAsaasFalso(respostasPadrao(), async () => {
    await comUtmifyFalsa(
      async (pedidos) => {
        const cliente = await clienteComCartao();
        const r = await checkoutService.assinarComCartaoSalvo({ clientUserId: cliente.id, plan: await planoMax(), remoteIp: '200.1.2.3' });

        // O que importa: o pagamento foi até o fim e o plano ativou.
        assert.equal(r.pago, true);
        const assinatura = await clientSubscriptionsRepository.getOrCreate(cliente.id);
        assert.equal(assinatura.status, 'ativo');
        await utmifyService.aguardarEnvios();
        assert.ok(pedidos.length >= 1, 'a tentativa acontece; a falha dela é que não pode subir');
      },
      { resposta: () => ({ status: 500, body: { error: 'caiu' } }) }
    );
  });
});

test('sem token configurado, nada é enviado e o pagamento funciona igual', async () => {
  await comAsaasFalso(respostasPadrao(), async () => {
    await semUtmify(async () => {
      const cliente = await clienteComCartao();
      const r = await checkoutService.assinarComCartaoSalvo({ clientUserId: cliente.id, plan: await planoMax(), remoteIp: '200.1.2.3' });
      assert.equal(r.pago, true);
      assert.equal(utmifyService.isConfigured(), false);
    });
  });
});

test('o formato das datas é o que a Utmify aceita, e venda de sandbox é marcada como teste', async () => {
  const cliente = await createClient();
  const registro = {
    asaas_payment_id: 'pay_formato_1',
    client_user_id: cliente.id,
    purpose: 'subscription',
    billing_type: 'PIX',
    amount_cents: 9990,
    created_at: new Date('2026-09-13T04:35:42.915Z'),
    paid_at: new Date('2026-09-13T04:35:46.000Z'),
  };

  const pedido = await utmifyService.montarPedido(registro, { status: 'paid' });

  // "YYYY-MM-DD HH:MM:SS" em UTC. Um ISO com T e Z é recusado pela validação
  // deles - e a recusa não aparece em lugar nenhum a não ser no nosso log.
  assert.equal(pedido.createdAt, '2026-09-13 04:35:42');
  assert.equal(pedido.approvedDate, '2026-09-13 04:35:46');
  assert.match(pedido.createdAt, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  assert.equal(pedido.commission.currency, 'BRL');
  assert.equal(pedido.customer.country, 'BR');
  // O ambiente dos testes é sandbox: venda de mentira não pode entrar na
  // contabilidade real do painel.
  assert.equal(config.asaas.environment !== 'production', true);
  assert.equal(pedido.isTest, true);
});

test('o endereço da Utmify só pode ser trocado por um local', async () => {
  // Sem esta trava, uma variável de ambiente errada mandaria os dados de venda
  // dos clientes para o servidor de outra pessoa, e tudo continuaria
  // parecendo funcionar.
  const anterior = { ...config.utmify };
  try {
    config.utmify.apiToken = 'x';
    config.utmify.baseUrlOverride = 'https://coletor-de-outra-pessoa.example.com/orders';
    let destino = null;
    const fetchOriginal = global.fetch;
    global.fetch = async (url) => {
      destino = String(url);
      return { ok: true, text: async () => '' };
    };
    try {
      await utmifyService.vendaPaga({
        asaas_payment_id: 'pay_trava_1',
        client_user_id: (await createClient()).id,
        purpose: 'subscription',
        billing_type: 'PIX',
        amount_cents: 100,
        created_at: new Date(),
      });
      await utmifyService.aguardarEnvios();
    } finally {
      global.fetch = fetchOriginal;
    }
    assert.equal(destino, 'https://api.utmify.com.br/api-credentials/orders');
  } finally {
    Object.assign(config.utmify, anterior);
  }
});

// A Utmify recusa a venda inteira com "customer.ip cannot be null". Em
// 14-15/09/2026 isso fez sumir do painel a venda aprovada do cartão e as duas
// do PIX: só o aviso que saía da tela de pagamento tinha o IP.
test('PIX: a venda pendente E a aprovada levam o IP de quem comprou', async () => {
  await comAsaasFalso(respostasPadrao({ paymentStatus: 'PENDING' }), async () => {
    await comUtmifyFalsa(async (pedidos) => {
      const cliente = await createClient();
      await clientSubscriptionsRepository.getOrCreate(cliente.id);

      const compra = await checkoutService.comprarCreditoComPix({
        clientUserId: cliente.id,
        minutes: 100,
        bucket: 'normal',
        priceCents: 2000,
        dadosDoTitular: TITULAR,
        email: cliente.email,
        remoteIp: '189.10.20.30',
      });
      await utmifyService.aguardarEnvios();

      // O pagamento chega horas depois, pelo webhook - que não tem o IP do cliente.
      const registro = await asaasPaymentsRepository.findByAsaasId(compra.paymentId);
      await checkoutService.aplicarPagamentoConfirmado(registro);
      await utmifyService.aguardarEnvios();

      assert.deepEqual(
        pedidos.map((p) => [p.corpo.status, p.corpo.customer.ip]),
        [
          ['waiting_payment', '189.10.20.30'],
          ['paid', '189.10.20.30'],
        ]
      );
    });
  });
});

test('cartão: a venda aprovada leva o mesmo IP da pendente', async () => {
  await comAsaasFalso(respostasPadrao(), async () => {
    await comUtmifyFalsa(async (pedidos) => {
      const cliente = await clienteComCartao();
      await checkoutService.assinarComCartaoSalvo({ clientUserId: cliente.id, plan: await planoMax(), remoteIp: '200.1.2.3' });
      await utmifyService.aguardarEnvios();

      assert.equal(pedidos.length, 2);
      for (const { corpo } of pedidos) assert.equal(corpo.customer.ip, '200.1.2.3', `venda "${corpo.status}" sem IP`);
    });
  });
});

test('renovação mensal (sem compra nossa) usa o IP da compra mais recente', async () => {
  await comAsaasFalso(respostasPadrao(), async () => {
    await comUtmifyFalsa(async (pedidos) => {
      const cliente = await clienteComCartao();
      await checkoutService.assinarComCartaoSalvo({ clientUserId: cliente.id, plan: await planoMax(), remoteIp: '200.1.2.3' });
      await utmifyService.aguardarEnvios();
      pedidos.length = 0;

      // O formato que o webhook monta para a renovação (avisarUtmifyDaRenovacao).
      utmifyService.vendaPaga({
        asaas_payment_id: `pay_renovacao_ip_${process.pid}_${Date.now()}`,
        client_user_id: cliente.id,
        purpose: 'subscription',
        billing_type: 'CREDIT_CARD',
        amount_cents: 23390,
      });
      await utmifyService.aguardarEnvios();

      assert.equal(pedidos[0].corpo.customer.ip, '200.1.2.3');
    });
  });
});

test('sem IP conhecido, o campo não vai - nunca como nulo, que a Utmify recusa', async () => {
  const cliente = await createClient();
  const pedido = await utmifyService.montarPedido(
    {
      asaas_payment_id: 'pay_sem_ip',
      client_user_id: cliente.id,
      purpose: 'subscription',
      billing_type: 'CREDIT_CARD',
      amount_cents: 100,
    },
    { status: 'paid' }
  );
  assert.equal(Object.prototype.hasOwnProperty.call(pedido.customer, 'ip'), false);
});

test('toda cobrança criada no checkout avisa a Utmify', async () => {
  // Esta é uma varredura de CÓDIGO, não de comportamento, e é de propósito.
  //
  // O defeito provável desta integração não é lógica errada: é um tipo novo de
  // cobrança nascendo amanhã (um produto novo, um upgrade) com o aviso
  // esquecido. Nenhum teste de comportamento pega isso — o produto novo
  // simplesmente não apareceria no painel, e ninguém descobre por uma venda
  // que não aparece.
  const fonte = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '../../src/services/checkoutService.js'),
    'utf8'
  );

  const criacoes = fonte.split('asaasPaymentsRepository.create(').length - 1;
  const avisos = fonte.split('utmifyService.vendaPendente(').length - 1;
  assert.equal(
    avisos,
    criacoes,
    `há ${criacoes} cobrança(s) criada(s) no checkout e ${avisos} aviso(s) de venda pendente - toda cobrança nova precisa do seu`
  );

  // O mesmo do outro lado: confirmação e estorno.
  assert.equal(
    fonte.split('markPaidOnce(').length - 1,
    fonte.split('utmifyService.vendaPaga(').length - 1,
    'todo ponto de confirmação de pagamento precisa avisar a venda aprovada'
  );
  assert.equal(
    fonte.split('markRefundedOnce(').length - 1,
    fonte.split('utmifyService.vendaEstornada(').length - 1,
    'todo ponto de estorno precisa avisar a Utmify'
  );
});
