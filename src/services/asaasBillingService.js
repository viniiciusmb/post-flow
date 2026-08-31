// Assinatura por PIX Automático.
//
// O que sobrou aqui depois que o checkout virou transparente (ver
// checkoutService): o cartão não passa mais pela tela hospedada do Asaas, mas
// o PIX Automático continua sendo dele por natureza — quem paga lê um QR Code
// no app do banco, e é o banco que autoriza os débitos seguintes.
//
// Os checkouts hospedados (createSubscriptionCheckout/createPackageCheckout)
// foram REMOVIDOS: mandavam quem estava comprando para outro domínio, com
// outra identidade visual, no momento em que mais precisa confiar no que está
// vendo. A tabela asaas_checkouts e o tratamento de CHECKOUT_PAID continuam
// existindo só para os checkouts que já foram criados em produção antes desta
// mudança.
'use strict';

const asaasService = require('./asaasService');
const asaasPixAuthorizationsRepository = require('../repositories/asaasPixAuthorizationsRepository');
const logger = require('../lib/logger');

// Quem pode pagar pelo Asaas neste momento.
//
// Em SANDBOX só o dono do sistema é mandado para lá; todo mundo continua na
// Stripe. O motivo é concreto: em sandbox o pagamento é de mentira, mas o
// crédito que ele libera é de verdade, no banco de produção. Sem esta trava,
// um cliente real que clicasse em "Assinar" durante uma validação assinaria de
// graça e receberia a cota inteira.
//
// Em produção (que é o caso desde 13/08/2026) vale para todo mundo.
function clientePodeUsarAsaas(user) {
  if (!asaasService.isConfigured()) return false;
  if (require('../config').asaas.environment === 'production') return true;
  return user && user.role === 'admin';
}

// O Asaas recusa descrição com mais de 30 caracteres na autorização de PIX
// Automático, e o erro só aparece na hora de gerar o QR Code - ou seja, no
// clique do cliente em "Pagar".
const MAX_NOME_ITEM = 30;

function nomeDeItem(texto) {
  const limpo = String(texto).trim();
  if (limpo.length <= MAX_NOME_ITEM) return limpo;
  logger.warn(`Nome de item longo demais pro Asaas ("${limpo}") - cortando em ${MAX_NOME_ITEM} caracteres.`);
  return limpo.slice(0, MAX_NOME_ITEM);
}

// ---------- PIX Automático ----------

// A chave Pix é da CONTA (não do cliente) e não muda. Consultada uma vez e
// guardada em memória: é uma ida à API por processo, não por pagamento.
let chavePixEmCache = null;

async function resolverChavePix() {
  if (chavePixEmCache) return chavePixEmCache;
  const chaves = await asaasService.listPixKeys();
  const ativa = chaves.find((k) => k.status === 'ACTIVE');
  if (!ativa) {
    throw new Error(
      'A conta do Asaas nao tem chave Pix ativa - sem ela o Asaas recusa qualquer cobranca por Pix.'
    );
  }
  chavePixEmCache = ativa.key;
  return chavePixEmCache;
}

// Quanto tempo a autorização vale. 2 anos: o cliente autoriza uma vez e não
// é incomodado de novo enquanto for cliente. Prazo curto significaria pedir
// autorização de novo no meio da assinatura, que é exatamente o atrito que o
// PIX Automático existe para eliminar.
const ANOS_DE_AUTORIZACAO = 2;

// primeiraCobrancaCents pode ser MENOR que o valor recorrente: é a promoção de
// primeiro mês. O PIX Automático aceita os dois valores no mesmo pedido — o QR
// que o cliente paga agora (immediateQrCode.originalValue) é independente do
// valor que passa a ser debitado todo mês (value). Foi o que permitiu os dois
// degraus de preço caberem num produto que só tem um valor por autorização.
async function createPixAutomaticSubscription({ clientUserId, plan, customerId, primeiraCobrancaCents = null }) {
  const pixKey = await resolverChavePix();
  const hoje = new Date();
  // A primeira cobrança é o próprio QR Code que o cliente vai pagar agora; a
  // recorrência começa no ciclo seguinte.
  const inicio = new Date(hoje.getTime() + 2 * 864e5);
  const fim = new Date(hoje.getTime() + ANOS_DE_AUTORIZACAO * 365 * 864e5);

  const autorizacao = await asaasService.createPixAutomaticAuthorization({
    customerId,
    planName: nomeDeItem(`Post Flow ${plan.name}`),
    amountCents: Number(plan.price_cents),
    primeiraCobrancaCents: Number(primeiraCobrancaCents || plan.price_cents),
    pixKey,
    contractId: `postflow-${clientUserId}-${plan.key}`,
    startDate: inicio.toISOString().slice(0, 10),
    finishDate: fim.toISOString().slice(0, 10),
  });

  await asaasPixAuthorizationsRepository.create({
    asaasAuthorizationId: autorizacao.id,
    clientUserId,
    planId: plan.id,
    asaasCustomerId: customerId,
    amountCents: Number(primeiraCobrancaCents || plan.price_cents),
  });

  return {
    authorizationId: autorizacao.id,
    // Copia-e-cola: quem paga no computador não consegue ler o QR da própria
    // tela, então os dois caminhos precisam existir.
    pixCopiaECola: autorizacao.payload,
    qrCodeBase64: autorizacao.encodedImage,
    status: autorizacao.status,
  };
}

module.exports = {
  clientePodeUsarAsaas,
  createPixAutomaticSubscription,
  nomeDeItem,
  MAX_NOME_ITEM,
};
