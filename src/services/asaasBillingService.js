// Monta os checkouts do Asaas (mensalidade e crédito avulso) e registra cada
// um em asaas_checkouts antes de devolver o link.
//
// Uma decisão que define o resto: NÃO mandamos dado nenhum do cliente para o
// Asaas. Descobrimos testando contra a API real que, no momento em que se
// manda qualquer dado, o Asaas passa a exigir o conjunto inteiro — CPF,
// telefone, CEP, rua, número e bairro — e recusa o checkout sem eles. Sem
// mandar nada, ele funciona e a própria tela dele pede ao cliente o que
// precisar. Isso apagou uma tela inteira de coleta de dados do nosso lado e
// tirou o CPF do nosso banco, o que é melhor para todo mundo.
'use strict';

const config = require('../config');
const asaasService = require('./asaasService');
const asaasCheckoutsRepository = require('../repositories/asaasCheckoutsRepository');
const creditPurchasesRepository = require('../repositories/creditPurchasesRepository');
const logger = require('../lib/logger');

// Quem pode pagar pelo Asaas neste momento.
//
// Enquanto a conta do Asaas está em SANDBOX, só o dono do sistema é mandado
// para lá — todo mundo continua na Stripe. O motivo é concreto: em sandbox o
// pagamento é de mentira, mas o crédito que ele libera é de verdade, no banco
// de produção. Sem esta trava, um cliente real que clicasse em "Assinar"
// durante a validação assinaria de graça e receberia a cota inteira.
//
// Quando as chaves de produção entrarem (ASAAS_ENVIRONMENT=production), a
// função passa a valer para todo mundo e a Stripe sai do caminho da
// mensalidade e do crédito avulso.
function clientePodeUsarAsaas(user) {
  if (!asaasService.isConfigured()) return false;
  if (config.asaas.environment === 'production') return true;
  return user && user.role === 'admin';
}

// O Asaas recusa nome de item com mais de 30 caracteres, e o erro só aparece
// na hora de criar o checkout - ou seja, no clique do cliente em "Pagar".
const MAX_NOME_ITEM = 30;

function nomeDeItem(texto) {
  const limpo = String(texto).trim();
  if (limpo.length <= MAX_NOME_ITEM) return limpo;
  logger.warn(`Nome de item longo demais pro Asaas ("${limpo}") - cortando em ${MAX_NOME_ITEM} caracteres.`);
  return limpo.slice(0, MAX_NOME_ITEM);
}

// O Asaas trabalha em reais com decimal; o resto do sistema, em centavos
// inteiros. A conversão fica isolada aqui para não haver dois lugares
// arredondando de jeitos diferentes.
function reais(centavos) {
  return Math.round(centavos) / 100;
}

// A tela do Asaas fica aberta por 24h. Menos que isso atrapalha quem vai
// pagar por PIX e sai para abrir o app do banco.
const MINUTOS_ATE_EXPIRAR = 1440;

function callbackUrls(origin, sufixo) {
  return {
    successUrl: `${origin}/client/billing?${sufixo}=sucesso`,
    cancelUrl: `${origin}/client/billing?${sufixo}=cancelado`,
    expiredUrl: `${origin}/client/billing?${sufixo}=expirou`,
  };
}

// Mensalidade. O Asaas passa a gerar e cobrar sozinho todo mês a partir da
// primeira cobrança (chargeTypes RECURRENT + subscription.cycle).
async function createSubscriptionCheckout({ clientUserId, plan, origin }) {
  const priceCents = Number(plan.price_cents);

  const checkout = await asaasService.createCheckout({
    billingTypes: ['CREDIT_CARD'],
    chargeTypes: ['RECURRENT'],
    minutesToExpire: MINUTOS_ATE_EXPIRAR,
    externalReference: `assinatura:${clientUserId}:${plan.key}`,
    callback: callbackUrls(origin, 'assinatura'),
    items: [{ name: nomeDeItem(`Post Flow ${plan.name}`), quantity: 1, value: reais(priceCents) }],
    subscription: {
      cycle: 'MONTHLY',
      // Primeira cobrança é hoje - é o pagamento que o cliente está fazendo
      // agora. As seguintes o Asaas agenda sozinho de mês em mês.
      nextDueDate: new Date().toISOString().slice(0, 10),
    },
  });

  await asaasCheckoutsRepository.create({
    asaasCheckoutId: checkout.id,
    clientUserId,
    purpose: 'subscription',
    planId: plan.id,
    amountCents: priceCents,
  });

  return { checkoutUrl: checkout.link, checkoutId: checkout.id };
}

// Crédito avulso: pagamento único, PIX ou cartão. O PIX é o motivo principal
// desta migração - cai na hora e não depende de o cliente ter cartão.
async function createPackageCheckout({ clientUserId, minutes, bucket, priceCents, origin }) {
  // A compra nasce pendente ANTES do checkout existir: se o registro fosse
  // criado depois, um cliente que pagasse rápido demais poderia ter o aviso
  // chegando antes de haver linha para atualizar.
  const purchase = await creditPurchasesRepository.create({
    clientUserId,
    bucket,
    minutes,
    amountCents: priceCents,
    provider: 'asaas',
  });

  try {
    const checkout = await asaasService.createCheckout({
      billingTypes: ['CREDIT_CARD', 'PIX'],
      chargeTypes: ['DETACHED'],
      minutesToExpire: MINUTOS_ATE_EXPIRAR,
      externalReference: `credito:${purchase.id}`,
      callback: callbackUrls(origin, 'pacote'),
      items: [{ name: nomeDeItem(`Credito Post Flow ${minutes}min`), quantity: 1, value: reais(priceCents) }],
    });

    await asaasCheckoutsRepository.create({
      asaasCheckoutId: checkout.id,
      clientUserId,
      purpose: 'credit_package',
      creditPurchaseId: purchase.id,
      amountCents: priceCents,
    });

    return { checkoutUrl: checkout.link, checkoutId: checkout.id, purchaseId: purchase.id };
  } catch (err) {
    // O checkout não chegou a existir, então esta compra nunca poderá ser
    // paga. Deixá-la "pendente" faria o histórico do cliente mostrar para
    // sempre uma compra que ele não fez e não pode concluir.
    await creditPurchasesRepository.markFailedById(purchase.id).catch((e) =>
      logger.error(`Nao consegui marcar a compra ${purchase.id} como falha:`, e.message)
    );
    throw err;
  }
}

module.exports = {
  clientePodeUsarAsaas,
  createSubscriptionCheckout,
  createPackageCheckout,
  nomeDeItem,
  reais,
  MAX_NOME_ITEM,
};
