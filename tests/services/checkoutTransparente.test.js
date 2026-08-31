// Checkout transparente: o pagamento acontece dentro do Post Flow.
//
// Isto é código com dinheiro no meio, e os erros possíveis são caros nos dois
// sentidos: cobrar sem entregar, ou entregar sem cobrar. O que estes testes
// travam:
//
//   - o cartão vira TOKEN e o número não sobra em lugar nenhum do nosso banco;
//   - a assinatura recorrente nasce ANTES da cobrança, e é cancelada quando o
//     cartão é recusado (senão o cliente seria cobrado mês que vem por um plano
//     que nunca valeu);
//   - a primeira mensalidade sai pelo preço promocional e a recorrência já
//     nasce pelo preço cheio — os dois degraus de preço, num provedor que só
//     aceita um valor por assinatura;
//   - a promoção vale UMA vez por cliente (cancelar e reassinar não é desconto
//     infinito);
//   - liberar é idempotente: a resposta síncrona e o aviso do Asaas chegando
//     depois não podem creditar duas vezes;
//   - cartão em análise NÃO ativa nada.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const pool = require('../../src/db/pool');
const checkoutService = require('../../src/services/checkoutService');
const clientSubscriptionsRepository = require('../../src/repositories/clientSubscriptionsRepository');
const clientCreditsRepository = require('../../src/repositories/clientCreditsRepository');
const subscriptionPlansRepository = require('../../src/repositories/subscriptionPlansRepository');
const asaasPaymentsRepository = require('../../src/repositories/asaasPaymentsRepository');
const creditPurchasesRepository = require('../../src/repositories/creditPurchasesRepository');
const { comAsaasFalso, respostasPadrao } = require('../helpers/asaasFalso');
const { createClient, readCredits } = require('../helpers/db');

test.after(async () => {
  await pool.end();
});

const CARTAO = {
  number: '5162 3062 1937 8829',
  expiryMonth: '05',
  expiryYear: '2030',
  ccv: '318',
  holderName: 'MARCELO H ALMEIDA',
};

const TITULAR = {
  nome: 'Marcelo Henrique Almeida',
  documento: '529.982.247-25',
  email: 'marcelo@teste.local',
  cep: '89223-005',
  numeroEndereco: '277',
  telefone: '(47) 99878-1877',
};

async function clienteComCartao(chamadasFora) {
  const cliente = await createClient();
  await clientSubscriptionsRepository.getOrCreate(cliente.id);
  await checkoutService.salvarCartao({
    clientUserId: cliente.id,
    dadosDoTitular: TITULAR,
    cartao: CARTAO,
    remoteIp: '200.1.2.3',
    email: cliente.email,
  });
  if (chamadasFora) chamadasFora.length = 0;
  return cliente;
}

test('o cartão vira token e o número não fica guardado em lugar nenhum', async () => {
  await comAsaasFalso(respostasPadrao(), async (chamadas) => {
    const cliente = await createClient();
    await clientSubscriptionsRepository.getOrCreate(cliente.id);

    const salvo = await checkoutService.salvarCartao({
      clientUserId: cliente.id,
      dadosDoTitular: TITULAR,
      cartao: CARTAO,
      remoteIp: '200.1.2.3',
      email: cliente.email,
    });

    assert.equal(salvo.token, 'tok_falso');
    assert.equal(salvo.last4, '8829');

    const tokenizacao = chamadas.find((c) => c.caminho === '/creditCard/tokenizeCreditCard');
    assert.ok(tokenizacao, 'o cartão tem que passar pela tokenização');
    // O IP de quem paga (e não o do nosso servidor) é o que a antifraude usa.
    assert.equal(tokenizacao.corpo.remoteIp, '200.1.2.3');
    // O Asaas exige o conjunto inteiro do titular; faltar um campo vira recusa
    // genérica na tela de quem está pagando.
    assert.equal(tokenizacao.corpo.creditCardHolderInfo.postalCode, '89223005');
    assert.equal(tokenizacao.corpo.creditCardHolderInfo.addressNumber, '277');
    assert.equal(tokenizacao.corpo.creditCardHolderInfo.cpfCnpj, '52998224725');

    // A prova que importa: em NENHUMA coluna do banco existe o número do
    // cartão ou o CVV. Não basta "não gravamos" — o teste procura.
    const { rows } = await pool.query(
      `SELECT * FROM client_subscriptions WHERE client_user_id = $1`,
      [cliente.id]
    );
    const linha = rows[0];
    assert.ok(
      !JSON.stringify(linha).includes('5162306219378829'),
      'o número do cartão não pode estar no banco'
    );
    // O CVV é procurado coluna a coluna, comparando o VALOR inteiro. Procurar
    // "318" como pedaço do JSON dá falso positivo o tempo todo: três dígitos
    // aparecem por acaso em id e em carimbo de hora (foi o que aconteceu na
    // primeira versão deste teste).
    for (const [coluna, valor] of Object.entries(linha)) {
      assert.notEqual(String(valor), CARTAO.ccv, `o CVV não pode estar guardado em ${coluna}`);
    }
    assert.equal(linha.asaas_card_token, 'tok_falso');
    assert.equal(linha.asaas_card_last4, '8829');
    // SALVAR NÃO É AUTORIZAR. Guardar o cartão para não redigitar é uma coisa;
    // deixá-lo ser cobrado sozinho quando a cota acabar é outra, e é a única
    // cobrança do sistema que acontece sem ninguém clicar em nada. Ligar junto
    // transformaria "paguei uma vez" em "autorizei cobranças futuras" sem o
    // cliente ter dito isso - que é o caminho curto para uma contestação.
    assert.equal(linha.overage_card_enabled, false);
  });
});

test('assinatura: recorrência nasce antes da cobrança, e os dois degraus de preço saem certos', async () => {
  await comAsaasFalso(respostasPadrao(), async (chamadas) => {
    const cliente = await clienteComCartao(chamadas);
    const plan = await subscriptionPlansRepository.findByKey('starter');

    const r = await checkoutService.assinarComCartaoSalvo({
      clientUserId: cliente.id,
      plan,
      remoteIp: '200.1.2.3',
    });

    assert.equal(r.pago, true);
    assert.equal(r.preco.promo, true);
    assert.equal(r.preco.primeiraCobrancaCents, plan.first_month_price_cents);
    assert.equal(r.preco.recorrenteCents, plan.price_cents);

    const ordem = chamadas.map((c) => `${c.metodo} ${c.caminho}`);
    const iAssinatura = ordem.indexOf('POST /subscriptions');
    const iCobranca = ordem.indexOf('POST /payments');
    assert.ok(iAssinatura >= 0 && iCobranca >= 0);
    assert.ok(
      iAssinatura < iCobranca,
      'a assinatura (que não move dinheiro) tem que nascer antes da cobrança, senão uma falha depois deixa dinheiro cobrado sem recorrência'
    );

    const assinatura = chamadas.find((c) => c.caminho === '/subscriptions' && c.metodo === 'POST');
    const cobranca = chamadas.find((c) => c.caminho === '/payments' && c.metodo === 'POST');
    assert.equal(assinatura.corpo.value, plan.price_cents / 100, 'a recorrência já nasce pelo preço cheio');
    assert.equal(cobranca.corpo.value, plan.first_month_price_cents / 100, 'a 1ª cobrança sai pelo promocional');
    assert.equal(assinatura.corpo.cycle, 'MONTHLY');
    // Vencimento no futuro: sem isso o Asaas cobraria a mensalidade cheia hoje,
    // em cima da promocional que acabou de sair.
    assert.ok(assinatura.corpo.nextDueDate > cobranca.corpo.dueDate);

    const sub = await clientSubscriptionsRepository.getOrCreate(cliente.id);
    assert.equal(sub.status, 'ativo');
    assert.equal(sub.plan_key, 'starter');
    assert.ok(sub.asaas_subscription_id, 'o id da assinatura precisa ser guardado: e ele que permite cancelar depois');
    assert.ok(sub.first_month_used_at, 'a promoção fica marcada como consumida');

    const creditos = await readCredits(cliente.id);
    assert.equal(creditos.quota_normal, plan.weekly_minutes_normal, 'a cota do plano entra na hora');
  });
});

test('cartão recusado CANCELA a recorrência que tinha acabado de nascer', async () => {
  const rotas = {
    ...respostasPadrao(),
    'POST /payments': () => ({
      status: 400,
      body: { errors: [{ code: 'invalid_creditCard', description: 'Cartão recusado pelo emissor.' }] },
    }),
  };

  await comAsaasFalso(rotas, async (chamadas) => {
    const cliente = await clienteComCartao(chamadas);
    const plan = await subscriptionPlansRepository.findByKey('starter');

    await assert.rejects(
      () => checkoutService.assinarComCartaoSalvo({ clientUserId: cliente.id, plan, remoteIp: '200.1.2.3' }),
      (err) => {
        assert.match(err.message, /recusado/i);
        return true;
      }
    );

    assert.ok(
      chamadas.some((c) => c.metodo === 'DELETE' && c.caminho.startsWith('/subscriptions/')),
      'a assinatura precisa ser cancelada, senão o cliente é cobrado mês que vem por um plano que nunca valeu'
    );

    const sub = await clientSubscriptionsRepository.getOrCreate(cliente.id);
    assert.equal(sub.status, 'sem_plano', 'nada pode ser ativado quando o cartão não passou');
    assert.equal(sub.first_month_used_at, null, 'quem teve o cartão recusado continua com direito ao desconto');
  });
});

test('a promoção de primeiro mês vale uma vez só por cliente', async () => {
  await comAsaasFalso(respostasPadrao(), async (chamadas) => {
    const cliente = await clienteComCartao(chamadas);
    const starter = await subscriptionPlansRepository.findByKey('starter');
    const pro = await subscriptionPlansRepository.findByKey('pro');

    const primeira = await checkoutService.assinarComCartaoSalvo({
      clientUserId: cliente.id,
      plan: starter,
      remoteIp: '1.2.3.4',
    });
    assert.equal(primeira.preco.promo, true);

    // Troca de plano depois: preço cheio, sem desconto de estreia.
    const segunda = await checkoutService.assinarComCartaoSalvo({
      clientUserId: cliente.id,
      plan: pro,
      remoteIp: '1.2.3.4',
    });
    assert.equal(segunda.preco.promo, false);
    assert.equal(segunda.preco.primeiraCobrancaCents, pro.price_cents);
  });
});

test('trocar de plano cancela a assinatura anterior no Asaas', async () => {
  await comAsaasFalso(respostasPadrao(), async (chamadas) => {
    const cliente = await clienteComCartao(chamadas);
    const starter = await subscriptionPlansRepository.findByKey('starter');
    const pro = await subscriptionPlansRepository.findByKey('pro');

    await checkoutService.assinarComCartaoSalvo({ clientUserId: cliente.id, plan: starter, remoteIp: '1.2.3.4' });
    chamadas.length = 0;
    await checkoutService.assinarComCartaoSalvo({ clientUserId: cliente.id, plan: pro, remoteIp: '1.2.3.4' });

    assert.ok(
      chamadas.some((c) => c.metodo === 'DELETE' && c.caminho.startsWith('/subscriptions/')),
      'duas assinaturas ativas cobrariam o cliente duas vezes'
    );
  });
});

test('cartão em análise NÃO ativa o plano; o aviso do Asaas é quem ativa depois', async () => {
  await comAsaasFalso(respostasPadrao({ paymentStatus: 'PENDING' }), async (chamadas) => {
    const cliente = await clienteComCartao(chamadas);
    const plan = await subscriptionPlansRepository.findByKey('starter');

    const r = await checkoutService.assinarComCartaoSalvo({ clientUserId: cliente.id, plan, remoteIp: '1.2.3.4' });
    assert.equal(r.pago, false, 'dizer "pronto" sem o banco ter aprovado seria mentir');

    const antes = await clientSubscriptionsRepository.getOrCreate(cliente.id);
    assert.equal(antes.status, 'sem_plano');

    // Agora chega o aviso do Asaas dizendo que a cobrança foi confirmada.
    const registro = await asaasPaymentsRepository.findByAsaasId(r.paymentId);
    await checkoutService.aplicarPagamentoConfirmado(registro);

    const depois = await clientSubscriptionsRepository.getOrCreate(cliente.id);
    assert.equal(depois.status, 'ativo');
    assert.equal(depois.plan_key, 'starter');
  });
});

test('liberar duas vezes o mesmo pagamento não credita em dobro', async () => {
  await comAsaasFalso(respostasPadrao(), async (chamadas) => {
    const cliente = await clienteComCartao(chamadas);
    await clientCreditsRepository.getOrCreate(cliente.id);

    const r = await checkoutService.comprarCreditoComCartao({
      clientUserId: cliente.id,
      minutes: 100,
      bucket: 'normal',
      priceCents: 2500,
      remoteIp: '1.2.3.4',
    });
    assert.equal(r.pago, true);

    const depoisDaCompra = await readCredits(cliente.id);
    assert.equal(depoisDaCompra.extra_normal, 100);

    // O aviso do Asaas chega depois da resposta síncrona — é o comportamento
    // NORMAL, não a exceção: ele entrega "pelo menos uma vez".
    const registro = await asaasPaymentsRepository.findByAsaasId(r.paymentId);
    await checkoutService.aplicarPagamentoConfirmado(registro);
    await checkoutService.aplicarPagamentoConfirmado(registro);

    const depoisDosAvisos = await readCredits(cliente.id);
    assert.equal(depoisDosAvisos.extra_normal, 100, 'aviso repetido não pode creditar de novo');
  });
});

test('crédito por PIX devolve o QR e só credita quando o pagamento confirma', async () => {
  let statusDoPix = 'PENDING';
  let idDoPix = null;
  const rotas = {
    ...respostasPadrao(),
    'POST /payments': (corpo) => {
      idDoPix = `pay_pix_${Date.now()}`;
      return { body: { id: idDoPix, status: 'PENDING', value: corpo.value } };
    },
    'GET /payments/:id': () => ({ body: { id: idDoPix, status: statusDoPix } }),
  };

  await comAsaasFalso(rotas, async () => {
    const cliente = await createClient();
    await clientSubscriptionsRepository.getOrCreate(cliente.id);
    await clientCreditsRepository.getOrCreate(cliente.id);

    const r = await checkoutService.comprarCreditoComPix({
      clientUserId: cliente.id,
      minutes: 50,
      bucket: 'normal',
      priceCents: 1250,
      dadosDoTitular: { nome: TITULAR.nome, documento: TITULAR.documento, telefone: TITULAR.telefone },
      email: cliente.email,
    });

    assert.equal(r.pago, false);
    assert.equal(r.pixCopiaECola, '000201-pix-copia-e-cola');
    assert.ok(r.qrCodeBase64);

    // Ainda não pagou: perguntar não pode liberar nada.
    const aindaNao = await checkoutService.conferirPagamentoPendente(r.paymentId, cliente.id);
    assert.equal(aindaNao.status, 'pendente');
    assert.equal((await readCredits(cliente.id)).extra_normal, 0);

    statusDoPix = 'RECEIVED';
    const agora = await checkoutService.conferirPagamentoPendente(r.paymentId, cliente.id);
    assert.equal(agora.status, 'pago');
    assert.equal((await readCredits(cliente.id)).extra_normal, 50);

    const compras = await creditPurchasesRepository.listByClientId(cliente.id);
    assert.equal(compras[0].status, 'pago');
  });
});

test('não dá para consultar (nem liberar) o pagamento de outra pessoa', async () => {
  await comAsaasFalso(respostasPadrao(), async (chamadas) => {
    const dono = await clienteComCartao(chamadas);
    const intruso = await createClient();
    await clientCreditsRepository.getOrCreate(dono.id);

    const r = await checkoutService.comprarCreditoComCartao({
      clientUserId: dono.id,
      minutes: 25,
      bucket: 'normal',
      priceCents: 625,
      remoteIp: '1.2.3.4',
    });

    const resposta = await checkoutService.conferirPagamentoPendente(r.paymentId, intruso.id);
    assert.equal(resposta.status, 'desconhecido', 'o id vem da tela: sem conferir o dono, daria pra espiar o pagamento alheio');
  });
});

test('cartão inválido é recusado ANTES de qualquer ida ao Asaas', async () => {
  await comAsaasFalso(respostasPadrao(), async (chamadas) => {
    const cliente = await createClient();
    await clientSubscriptionsRepository.getOrCreate(cliente.id);

    await assert.rejects(
      () =>
        checkoutService.salvarCartao({
          clientUserId: cliente.id,
          dadosDoTitular: TITULAR,
          cartao: { ...CARTAO, ccv: '1' },
          remoteIp: '1.2.3.4',
          email: cliente.email,
        }),
      (err) => {
        assert.equal(err.name, 'DadosInvalidosError');
        return true;
      }
    );
    assert.equal(chamadas.length, 0, 'erro de digitação óbvio não precisa virar recusa vinda da API');
  });
});

test('CPF inválido vira erro no campo, não recusa genérica no meio do pagamento', async () => {
  await comAsaasFalso(respostasPadrao(), async () => {
    assert.throws(
      () => checkoutService.validarDadosDoTitular({ ...TITULAR, documento: '111.111.111-11' }),
      /CPF ou CNPJ inválido/
    );
    assert.throws(() => checkoutService.validarDadosDoTitular({ ...TITULAR, cep: '123' }), /CEP inválido/);
    assert.throws(() => checkoutService.validarDadosDoTitular({ ...TITULAR, numeroEndereco: '' }), /número do endereço/);
  });
});

test('validade de 2 dígitos é aceita — o cartão é impresso dos dois jeitos', () => {
  const a = checkoutService.validarCartao({ ...CARTAO, expiryYear: '30' });
  assert.equal(a.expiryYear, '2030');
  const b = checkoutService.validarCartao({ ...CARTAO, expiryYear: '2030' });
  assert.equal(b.expiryYear, '2030');
  assert.throws(() => checkoutService.validarCartao({ ...CARTAO, expiryMonth: '13' }), /Mês de validade/);
});

test('PIX Automático: o QR de agora sai promocional e a recorrência já nasce cheia', async () => {
  // O PIX Automático aceita um valor para a cobrança imediata e outro para o
  // débito mensal. É o que permitiu os dois degraus de preço caberem num
  // produto que só tem um valor por autorização — sem isso, ou o cliente
  // perderia o desconto, ou pagaria o promocional para sempre.
  const asaasBillingService = require('../../src/services/asaasBillingService');

  await comAsaasFalso(respostasPadrao(), async (chamadas) => {
    const cliente = await createClient();
    const sub = await clientSubscriptionsRepository.getOrCreate(cliente.id);
    const plan = await subscriptionPlansRepository.findByKey('pro');
    const preco = checkoutService.precoDaAssinatura(plan, sub);

    await asaasBillingService.createPixAutomaticSubscription({
      clientUserId: cliente.id,
      plan,
      customerId: 'cus_teste',
      primeiraCobrancaCents: preco.primeiraCobrancaCents,
    });

    const pedido = chamadas.find((c) => c.caminho === '/pix/automatic/authorizations');
    assert.equal(pedido.corpo.value, plan.price_cents / 100, 'o débito mensal é o preço cheio');
    assert.equal(
      pedido.corpo.immediateQrCode.originalValue,
      plan.first_month_price_cents / 100,
      'o QR que o cliente paga agora é o promocional'
    );
    assert.equal(pedido.corpo.frequency, 'MONTHLY');
    // Sem política de repetição, um único dia sem saldo cancelaria a
    // mensalidade inteira.
    assert.equal(pedido.corpo.retryPolicy, 'ALLOW_THREE_IN_SEVEN_DAYS');
  });
});

test('cliente do Asaas que sumiu leva o cartão junto — token órfão não pode sobrar', async () => {
  // Trocar de conta ou de ambiente no Asaas deixa todo id salvo apontando para
  // o nada. O token de cartão pertence ao CLIENTE, então ele morre junto: se
  // ficasse guardado, a cobrança de excedente falharia longe da tela, no meio
  // de um processamento, sem ninguém ver. É o mesmo estrago que a troca de
  // chaves da Stripe causou em 14/08/2026.
  const rotas = {
    ...respostasPadrao(),
    'GET /customers/:id': () => ({
      status: 404,
      body: { errors: [{ code: 'not_found', description: 'Cliente não encontrado.' }] },
    }),
  };

  await comAsaasFalso(rotas, async () => {
    const cliente = await createClient();
    await clientSubscriptionsRepository.getOrCreate(cliente.id);
    await clientSubscriptionsRepository.setAsaasCard(cliente.id, {
      customerId: 'cus_que_sumiu',
      token: 'tok_orfao',
      brand: 'VISA',
      last4: '4242',
      exp: '05/2030',
    });

    await checkoutService.resolverCustomer(cliente.id, {
      nome: TITULAR.nome,
      documento: '52998224725',
      email: cliente.email,
    });

    const sub = await clientSubscriptionsRepository.getOrCreate(cliente.id);
    assert.notEqual(sub.asaas_customer_id, 'cus_que_sumiu', 'o cliente tem que ser recriado');
    assert.equal(sub.asaas_card_token, null, 'o cartão do cliente morto não cobra mais nada');
    assert.equal(sub.asaas_card_last4, null);
    assert.equal(sub.overage_card_enabled, false, 'cobrança automática sem cartão falharia em silêncio');
  });
});
