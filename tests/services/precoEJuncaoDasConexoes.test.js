// As duas regras novas de cobrança das conexões extras (01/09/2026).
//
// 1. PREÇO. Canal do YouTube e conta do TikTok viraram produtos separados, com
//    desconto para quem leva o par:
//      canal R$14,90 · conta R$29,90 · os dois R$39,90
//    O desconto vale POR PAR, não uma vez só — cobrar o par uma vez e o resto
//    cheio daria uma conta que ninguém confere de cabeça, e a primeira
//    reclamação seria sobre o preço numa tela de pagamento.
//
// 2. JUNÇÃO DAS COBRANÇAS. Regra confirmada com o fundador: quem compra uma
//    conexão no meio do ciclo paga na hora; a mensalidade do plano segue o
//    ciclo dela sem interrupção; e do ciclo SEGUINTE em diante tudo cai no
//    mesmo dia.
//
//    Exemplo: plano vence 15/set, compra em 05/set →
//      05/set  paga a conexão
//      15/set  paga o plano (normal)
//      15/out  plano + conexão, no mesmo dia
//
//    Por que alinhar a DATA em vez de somar no valor do plano: mexer no valor
//    da assinatura do plano agora arriscaria alterar uma cobrança JÁ GERADA
//    pelo Asaas (a de 15/set) e o cliente pagaria a conexão duas vezes no mesmo
//    mês. Alinhar a data é determinístico e não toca no que já está a caminho.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const pool = require('../../src/db/pool');
const checkoutService = require('../../src/services/checkoutService');
const clientSubscriptionsRepository = require('../../src/repositories/clientSubscriptionsRepository');
const subscriptionPlansRepository = require('../../src/repositories/subscriptionPlansRepository');
const { precoDosExtras, mensalidadeDosExtras, precosDoPlano } = require('../../src/lib/precoDasConexoesExtras');
const { comAsaasFalso, respostasPadrao } = require('../helpers/asaasFalso');
const { createClient } = require('../helpers/db');

test.after(async () => {
  await pool.end();
});

const PRECOS = { canal: 1490, conta: 2990, ambos: 3990 };

// --- 1. Preço ---

test('cada produto tem o seu preço, e o par tem desconto', () => {
  assert.equal(precoDosExtras({ canais: 1, contas: 0 }, PRECOS).totalCents, 1490);
  assert.equal(precoDosExtras({ canais: 0, contas: 1 }, PRECOS).totalCents, 2990);
  assert.equal(precoDosExtras({ canais: 1, contas: 1 }, PRECOS).totalCents, 3990);
  assert.ok(3990 < 1490 + 2990, 'o par tem que ser mais barato que os dois separados');
});

test('o desconto do par vale POR PAR', () => {
  // 2 canais + 2 contas = dois pares, não um par + dois soltos.
  assert.equal(precoDosExtras({ canais: 2, contas: 2 }, PRECOS).totalCents, 3990 * 2);
  const r = precoDosExtras({ canais: 2, contas: 2 }, PRECOS);
  assert.equal(r.combos, 2);
  assert.equal(r.canaisSozinhos, 0);
  assert.equal(r.contasSozinhas, 0);
});

test('o que sobra do par paga o preço avulso', () => {
  // 3 canais + 1 conta = 1 par + 2 canais soltos.
  assert.equal(precoDosExtras({ canais: 3, contas: 1 }, PRECOS).totalCents, 3990 + 1490 * 2);
  // 1 canal + 2 contas = 1 par + 1 conta solta.
  assert.equal(precoDosExtras({ canais: 1, contas: 2 }, PRECOS).totalCents, 3990 + 2990);
});

test('comprar nada custa nada, e número estranho não vira preço estranho', () => {
  assert.equal(precoDosExtras({ canais: 0, contas: 0 }, PRECOS).totalCents, 0);
  assert.equal(precoDosExtras({ canais: -5, contas: 0 }, PRECOS).totalCents, 0, 'negativo não pode virar desconto');
  assert.equal(precoDosExtras({ canais: 1.7, contas: 0 }, PRECOS).totalCents, 1490, 'fração não pode virar preço quebrado');
});

test('a mensalidade usa a MESMA conta da compra', () => {
  // Se a recorrência usasse outra regra, o cliente pagaria um valor na compra e
  // outro todo mês — e descobriria isso na segunda fatura.
  const sub = { extra_channels: 2, extra_tiktok_accounts: 1 };
  assert.equal(
    mensalidadeDosExtras(sub, PRECOS),
    precoDosExtras({ canais: 2, contas: 1 }, PRECOS).totalCents
  );
});

test('plano que não vende extras não tem preço nenhum', () => {
  // Devolver null (e não zero) é o que impede "não vende" virar "de graça".
  assert.equal(precosDoPlano({ extra_channel_price_cents: null }), null);
  assert.equal(precosDoPlano(null), null);
});

// --- 2. Junção das cobranças ---

const CARTAO = { number: '5162306219378829', expiryMonth: '05', expiryYear: '2030', ccv: '318', holderName: 'MARCELO H ALMEIDA' };
const TITULAR = { nome: 'Marcelo Henrique Almeida', documento: '52998224725', email: 'm@teste.local', cep: '89223005', numeroEndereco: '277' };

async function clienteComPlanoEAssinatura(vencimentoDoPlano) {
  const cliente = await createClient();
  const plano = await subscriptionPlansRepository.findByKey('max');
  await clientSubscriptionsRepository.setPlan(cliente.id, plano.id);
  await checkoutService.salvarCartao({
    clientUserId: cliente.id,
    dadosDoTitular: TITULAR,
    cartao: CARTAO,
    remoteIp: '1.2.3.4',
    email: cliente.email,
  });
  await clientSubscriptionsRepository.setAsaasSubscription(cliente.id, {
    customerId: (await clientSubscriptionsRepository.getOrCreate(cliente.id)).asaas_customer_id,
    subscriptionId: 'sub_do_plano',
  });
  return { cliente, plano };
}

test('a recorrência da conexão nasce alinhada ao ciclo do plano, um ciclo depois', async () => {
  const respostas = respostasPadrao();
  // O Asaas responde que o plano vence dia 15/09 — a cobrança que já está a
  // caminho e que NÃO pode ser alterada.
  respostas['GET /subscriptions/:id'] = () => ({ body: { id: 'sub_do_plano', nextDueDate: '2026-09-15' } });

  await comAsaasFalso(respostas, async (chamadas) => {
    const { cliente } = await clienteComPlanoEAssinatura();
    chamadas.length = 0;

    await checkoutService.comprarExtras({ clientUserId: cliente.id, canais: 1, remoteIp: '1.2.3.4' });

    const cobrancaAgora = chamadas.find((c) => c.metodo === 'POST' && c.caminho === '/payments');
    assert.ok(cobrancaAgora, 'a conexão tem que ser paga na hora');

    const recorrencia = chamadas.find((c) => c.metodo === 'POST' && c.caminho === '/subscriptions');
    assert.equal(
      recorrencia.corpo.nextDueDate,
      '2026-10-15',
      'a recorrência tinha que começar UM CICLO depois do vencimento do plano, pra cair no mesmo dia dele'
    );
  });
});

test('sem assinatura de plano no Asaas, cai no padrão de 30 dias', async () => {
  // Plano atribuído na mão pelo admin não tem assinatura no Asaas. Sem essa
  // saída, a compra quebraria justamente para os clientes que o fundador ativa
  // manualmente — que são todos os de hoje.
  await comAsaasFalso(respostasPadrao(), async (chamadas) => {
    const cliente = await createClient();
    const plano = await subscriptionPlansRepository.findByKey('max');
    await clientSubscriptionsRepository.setPlan(cliente.id, plano.id);
    await checkoutService.salvarCartao({
      clientUserId: cliente.id, dadosDoTitular: TITULAR, cartao: CARTAO, remoteIp: '1.2.3.4', email: cliente.email,
    });
    chamadas.length = 0;

    await checkoutService.comprarExtras({ clientUserId: cliente.id, contas: 1, remoteIp: '1.2.3.4' });

    const recorrencia = chamadas.find((c) => c.metodo === 'POST' && c.caminho === '/subscriptions');
    assert.ok(recorrencia, 'a recorrência tem que nascer mesmo sem assinatura de plano no Asaas');
    const daqui30 = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    assert.equal(recorrencia.corpo.nextDueDate, daqui30);
  });
});

test('a assinatura do PLANO não é tocada na compra da conexão', async () => {
  // É o ponto que protege o cliente de pagar a conexão duas vezes no mesmo mês:
  // a cobrança do plano que já está a caminho segue intacta.
  const respostas = respostasPadrao();
  respostas['GET /subscriptions/:id'] = () => ({ body: { id: 'sub_do_plano', nextDueDate: '2026-09-15' } });

  await comAsaasFalso(respostas, async (chamadas) => {
    const { cliente } = await clienteComPlanoEAssinatura();
    chamadas.length = 0;

    await checkoutService.comprarExtras({ clientUserId: cliente.id, canais: 1, contas: 1, remoteIp: '1.2.3.4' });

    const mexeuNoPlano = chamadas.some(
      (c) => c.caminho === '/subscriptions/sub_do_plano' && c.metodo !== 'GET'
    );
    assert.equal(mexeuNoPlano, false, 'mexer na assinatura do plano pode alterar uma cobrança já gerada');
  });
});
