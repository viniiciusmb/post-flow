// Webhook público do Asaas: é por aqui que o sistema fica sabendo que o
// dinheiro entrou. A tela de retorno depois do pagamento NÃO serve para isso —
// o cliente pode fechar o navegador, e no PIX ele paga no app do banco e nunca
// volta. Só o aviso do Asaas é confiável.
//
// Diferente da Stripe, o Asaas não assina o corpo da requisição: ele manda um
// token combinado no cabeçalho asaas-access-token. Por isso esta rota NÃO
// precisa do corpo bruto e pode usar o express.json() normal.
//
// Duas regras que valem para tudo aqui:
//
//   1. Idempotência. O Asaas garante entrega "pelo menos uma vez" — receber o
//      mesmo aviso duas vezes é o comportamento normal, não a exceção. Toda
//      liberação de crédito passa por um UPDATE condicionado ao status
//      anterior, então a segunda vez não faz nada.
//
//   2. Responder 2xx. Depois de 15 respostas ruins seguidas o Asaas PAUSA a
//      fila da conta inteira e os eventos somem em 14 dias. Um erro nosso não
//      pode virar perda de aviso de pagamento.
'use strict';

const asaasService = require('../../../services/asaasService');
const asaasCheckoutsRepository = require('../../../repositories/asaasCheckoutsRepository');
const asaasPixAuthorizationsRepository = require('../../../repositories/asaasPixAuthorizationsRepository');
const creditPurchasesRepository = require('../../../repositories/creditPurchasesRepository');
const clientSubscriptionsRepository = require('../../../repositories/clientSubscriptionsRepository');
const clientCreditsRepository = require('../../../repositories/clientCreditsRepository');
const subscriptionPlansRepository = require('../../../repositories/subscriptionPlansRepository');
const creditsUnlockService = require('../../../services/creditsUnlockService');
const asaasPaymentsRepository = require('../../../repositories/asaasPaymentsRepository');
const checkoutService = require('../../../services/checkoutService');
const affiliateService = require('../../../services/affiliateService');
const logger = require('../../../lib/logger');

// ---------- checkout pago ----------

// paymentId chega quando quem avisou foi o evento de PAGAMENTO (o aviso de
// checkout nao traz o id da cobranca). Guardar esse id e o que permite achar
// depois, no painel do Asaas, exatamente qual cobranca gerou qual credito.
async function handleCheckoutPaid(checkout, { paymentId = null } = {}) {
  const registro = await asaasCheckoutsRepository.findByAsaasId(checkout.id);
  if (!registro) {
    // Checkout que não foi criado por nós (teste manual no painel do Asaas,
    // ou de outro sistema usando a mesma conta). Não é erro.
    logger.warn(`Asaas: CHECKOUT_PAID de um checkout desconhecido (${checkout.id}) - ignorando.`);
    return;
  }

  const marcado = await asaasCheckoutsRepository.markPaidOnce(checkout.id);
  if (!marcado) {
    logger.info(`Asaas: checkout ${checkout.id} ja tinha sido processado - aviso repetido, nada a fazer.`);
    return;
  }

  const clientUserId = Number(registro.client_user_id);

  if (registro.purpose === 'credit_package') {
    await liberarCreditoAvulso(registro, clientUserId, paymentId);
    return;
  }
  if (registro.purpose === 'subscription') {
    await ativarAssinatura(registro, clientUserId, checkout);
  }
}

async function liberarCreditoAvulso(registro, clientUserId, paymentId = null) {
  const compra = await creditPurchasesRepository.markPaidById(Number(registro.credit_purchase_id), paymentId);
  if (!compra) {
    logger.error(
      `Asaas: compra de credito ${registro.credit_purchase_id} nao estava pendente ao confirmar o checkout ${registro.asaas_checkout_id}.`
    );
    return;
  }
  await clientCreditsRepository.addExtra(clientUserId, compra.bucket, compra.minutes);
  // Vídeo que estava parado por falta de crédito volta pra fila sozinho -
  // sem isso o cliente pagaria e continuaria olhando pra um vídeo travado.
  await creditsUnlockService.unlockAwaitingCreditsForClient(clientUserId);
  logger.info(`Asaas: ${compra.minutes} min de credito liberados pro cliente ${clientUserId} (compra ${compra.id}).`);
}

async function ativarAssinatura(registro, clientUserId, checkout) {
  const plan = await subscriptionPlansRepository.findById(Number(registro.plan_id));
  if (!plan) {
    logger.error(`Asaas: plano ${registro.plan_id} nao encontrado ao ativar a assinatura do cliente ${clientUserId}.`);
    return;
  }

  const antes = await clientSubscriptionsRepository.getOrCreate(clientUserId);
  const primeiraAtivacao = antes.status === 'sem_plano' || !antes.plan_id;

  await clientSubscriptionsRepository.setPlan(clientUserId, plan.id);

  // O aviso traz o cliente, mas não a assinatura que acabou de nascer.
  // Buscamos pelo cliente para guardar o id — é ele que permite trocar de
  // plano ou cancelar depois.
  const customerId = checkout.customer || null;
  let subscriptionId = null;
  if (customerId) {
    try {
      const assinaturas = await asaasService.listSubscriptionsByCustomer(customerId);
      subscriptionId = assinaturas.length > 0 ? assinaturas[0].id : null;
    } catch (err) {
      // Sem o id, a assinatura funciona e cobra normalmente; só o cancelamento
      // pelo painel fica indisponível até alguém religar. Perder a ativação
      // inteira por causa disso seria muito pior.
      logger.error(`Asaas: nao consegui achar a assinatura do cliente ${customerId} (seguindo sem o id):`, err.message);
    }
  }
  await clientSubscriptionsRepository.setAsaasSubscription(clientUserId, { customerId, subscriptionId });
  await clientSubscriptionsRepository.setStatus(clientUserId, 'ativo');

  if (primeiraAtivacao) {
    await clientCreditsRepository.applyPlanQuotaNow(clientUserId, plan.id);
  }
  await creditsUnlockService.unlockAwaitingCreditsForClient(clientUserId);
  logger.info(`Asaas: cliente ${clientUserId} ativou o plano ${plan.key} (assinatura ${subscriptionId || 'sem id'}).`);
}

// ---------- PIX Automático ----------

// O cliente leu o QR Code, pagou a primeira mensalidade e autorizou as
// próximas no app do banco. É ESTE aviso que ativa o plano - o cliente sai do
// nosso site para o banco e pode nunca voltar, então não existe clique de
// "concluí" para escutar.
async function handlePixAuthorizationActivated(authorizationId) {
  const registro = await asaasPixAuthorizationsRepository.findByAsaasId(authorizationId);
  if (!registro) {
    logger.warn(`Asaas: autorizacao Pix desconhecida ativada (${authorizationId}) - ignorando.`);
    return;
  }

  const ativada = await asaasPixAuthorizationsRepository.markActiveOnce(authorizationId);
  if (!ativada) {
    logger.info(`Asaas: autorizacao Pix ${authorizationId} ja estava ativa - aviso repetido.`);
    return;
  }

  const clientUserId = Number(registro.client_user_id);
  const plan = await subscriptionPlansRepository.findById(Number(registro.plan_id));
  if (!plan) {
    logger.error(`Asaas: plano ${registro.plan_id} nao encontrado ao ativar Pix Automatico do cliente ${clientUserId}.`);
    return;
  }

  const antes = await clientSubscriptionsRepository.getOrCreate(clientUserId);
  const primeiraAtivacao = antes.status === 'sem_plano' || !antes.plan_id;

  await clientSubscriptionsRepository.setPlan(clientUserId, plan.id);
  await clientSubscriptionsRepository.setAsaasPixAuthorization(clientUserId, {
    customerId: registro.asaas_customer_id,
    authorizationId,
  });
  await clientSubscriptionsRepository.setStatus(clientUserId, 'ativo');

  if (primeiraAtivacao) await clientCreditsRepository.applyPlanQuotaNow(clientUserId, plan.id);
  await creditsUnlockService.unlockAwaitingCreditsForClient(clientUserId);
  logger.info(`Asaas: cliente ${clientUserId} ativou o plano ${plan.key} por PIX Automatico.`);
}

// Autorização recusada, expirada ou cancelada pelo cliente no app do banco.
// Sem autorização ativa não há cobrança nenhuma, então a assinatura para.
async function handlePixAuthorizationEncerrada(authorizationId, status) {
  const registro = await asaasPixAuthorizationsRepository.markFinalIfPending(authorizationId, status);
  if (!registro) return;
  logger.warn(`Asaas: autorizacao Pix ${authorizationId} terminou como "${status}" (cliente ${registro.client_user_id}).`);
}

// Cliente cancelou no app do banco uma autorização que JÁ estava ativa: a
// mensalidade para de ser cobrada, então a assinatura fica inadimplente. Não
// cancelamos de imediato - ele pode ter cancelado por engano e refazer.
async function handlePixAuthorizationCancelada(authorizationId) {
  const registro = await asaasPixAuthorizationsRepository.findByAsaasId(authorizationId);
  if (!registro) return;
  await asaasPixAuthorizationsRepository.markFinalIfPending(authorizationId, 'cancelada');
  if (registro.status !== 'ativa') return;
  await clientSubscriptionsRepository.setStatus(Number(registro.client_user_id), 'inadimplente');
  logger.warn(
    `Asaas: cliente ${registro.client_user_id} cancelou a autorizacao de PIX Automatico - assinatura marcada como inadimplente.`
  );
}

// ---------- cobrança recebida (renovação mensal) ----------

// A primeira mensalidade chega como CHECKOUT_PAID; as seguintes, como
// pagamento avulso ligado à assinatura. É aqui que a renovação reativa quem
// estava inadimplente e paga a comissão do afiliado.
async function handlePaymentReceived(payment) {
  // Checkout transparente: a cobrança foi criada por nós, direto pela API, e
  // está registrada em asaas_payments com a finalidade dela (mensalidade,
  // crédito avulso ou conexões extras). Este é o caminho principal desde que
  // o checkout deixou de ser a tela hospedada do Asaas.
  //
  // Quando o cartão é aprovado na hora, a liberação já aconteceu de forma
  // síncrona e este aviso não faz nada (markPaidOnce recusa a segunda vez) -
  // ele existe para o PIX, para o cartão que ficou em análise, e para o caso
  // de a resposta síncrona ter se perdido no meio do caminho.
  if (payment.id) {
    const registro = await asaasPaymentsRepository.findByAsaasId(payment.id);
    if (registro) await checkoutService.aplicarPagamentoConfirmado(registro);
  }

  // Rede de segurança: a cobrança gerada por um checkout nosso carrega o id
  // dele em checkoutSession. Se o CHECKOUT_PAID não chegar, chegar fora de
  // ordem, ou o pagamento for confirmado por fora (PIX conciliado, baixa
  // manual no painel), este é o segundo caminho para o crédito sair.
  //
  // Descoberto testando de verdade: um PIX de checkout confirmado pelo painel
  // gerou PAYMENT_RECEIVED e nenhum CHECKOUT_PAID - o cliente teria pago e
  // ficado sem crédito. markPaidOnce garante que receber os DOIS avisos ainda
  // credita uma vez só.
  if (payment.checkoutSession) {
    await handleCheckoutPaid(
      { id: payment.checkoutSession, customer: payment.customer },
      { paymentId: payment.id || null }
    );
  }

  if (!payment.subscription) return; // cobrança que não é mensalidade

  const assinatura = await clientSubscriptionsRepository.findByAsaasSubscriptionId(payment.subscription);
  if (!assinatura) {
    // Pode ser a assinatura das CONEXÕES EXTRAS, que vive numa coluna própria.
    // Ela renova normalmente e não é mensalidade, então não gera comissão nem
    // reativa nada - só não pode virar aviso de "assinatura desconhecida", que
    // no log parece problema e não é.
    const extras = await clientSubscriptionsRepository.findByAsaasExtraSlotsSubscriptionId(payment.subscription);
    if (extras) {
      logger.info(`Asaas: renovacao das conexoes extras do cliente ${extras.client_user_id} paga (${payment.id}).`);
      return;
    }
    logger.warn(`Asaas: pagamento ${payment.id} de uma assinatura desconhecida (${payment.subscription}).`);
    return;
  }
  const clientUserId = assinatura.client_user_id;

  // Comissão roda pra TODA mensalidade paga, não só pras que reativam - por
  // isso vem antes do return abaixo. O serviço já é idempotente e filtra
  // sozinho (teto de meses, isenção de admin).
  try {
    await affiliateService.recordCommissionForPayment({
      clientUserId,
      provider: 'asaas',
      externalPaymentId: payment.id,
      amountPaidCents: Math.round(Number(payment.value) * 100),
    });
  } catch (err) {
    logger.error(`Asaas: falha ao processar comissao do pagamento ${payment.id}:`, err);
  }

  if (assinatura.status !== 'inadimplente') return;
  await clientSubscriptionsRepository.setStatus(clientUserId, 'ativo');
  await creditsUnlockService.unlockAwaitingCreditsForClient(clientUserId);
  logger.info(`Asaas: cliente ${clientUserId} pagou a mensalidade ${payment.id} - assinatura reativada.`);
}

// Mensalidade venceu sem pagamento. Marca inadimplente na hora, que é o que
// trava processamento novo - esperar o Asaas cancelar a assinatura sozinho
// levaria dias de serviço prestado de graça.
async function handlePaymentOverdue(payment) {
  // Cobrança do checkout transparente que venceu sem pagamento (PIX que
  // ninguém pagou, tipicamente). Sem isso ela ficaria "pendente" para sempre
  // no histórico do cliente - o pior estado possível numa tela de pagamento,
  // porque não dá para saber se pagou.
  if (payment.id) await asaasPaymentsRepository.markStatusIfPending(payment.id, 'falhou');

  if (!payment.subscription) return;

  const assinatura = await clientSubscriptionsRepository.findByAsaasSubscriptionId(payment.subscription);
  if (assinatura) {
    await clientSubscriptionsRepository.setStatus(assinatura.client_user_id, 'inadimplente');
    logger.warn(`Asaas: mensalidade ${payment.id} venceu sem pagamento - cliente ${assinatura.client_user_id} inadimplente.`);
    return;
  }

  // Conexões extras não pagas: o cliente perde as CONEXÕES EXTRAS, não o
  // plano. Bloquear o processamento inteiro por causa de um adicional de
  // R$29,90 seria desproporcional - e nada é apagado: canal e conta que já
  // existem continuam funcionando, o limite só volta a barrar novos.
  const extras = await clientSubscriptionsRepository.findByAsaasExtraSlotsSubscriptionId(payment.subscription);
  if (!extras) return;
  await clientSubscriptionsRepository.clearExtraSlotsSubscription(extras.client_user_id);
  await asaasService.cancelSubscription(payment.subscription).catch((err) =>
    logger.error(`Asaas: nao consegui cancelar a assinatura de extras ${payment.subscription}:`, err.message)
  );
  logger.warn(
    `Asaas: conexoes extras do cliente ${extras.client_user_id} venceram sem pagamento - removidas.`
  );
}

// ---------- rota ----------

async function webhook(req, res) {
  if (!asaasService.webhookTokenValido(req.headers['asaas-access-token'])) {
    // 401 de propósito: o Asaas não reenvia o que foi recusado por
    // autenticação, e reenviar não adiantaria - o token continuaria errado.
    logger.error('Asaas: webhook recusado - token invalido ou ausente.');
    return res.status(401).json({ error: 'token invalido' });
  }

  const evento = req.body && req.body.event;
  if (!evento) return res.status(400).json({ error: 'evento ausente' });

  // Registra TODO evento que chega, inclusive os que ignoramos. Sem isto não
  // havia como responder a pergunta mais básica durante um problema de
  // pagamento - "o aviso chegou?" -, porque um evento ignorado passava em
  // silêncio absoluto e ficava idêntico a um evento que nunca chegou.
  const alvo = (req.body.checkout && req.body.checkout.id) || (req.body.payment && req.body.payment.id) || '-';
  logger.info(`Asaas: evento ${evento} recebido (${alvo}).`);

  try {
    switch (evento) {
      case 'CHECKOUT_PAID':
        await handleCheckoutPaid(req.body.checkout || {});
        break;

      // Cliente abriu a tela de pagamento e desistiu. Nada é cobrado nem
      // creditado - só o registro deixa de mentir dizendo "pendente" pra
      // sempre no histórico dele.
      case 'CHECKOUT_EXPIRED':
      case 'CHECKOUT_CANCELED': {
        const checkout = req.body.checkout || {};
        const novoStatus = evento === 'CHECKOUT_EXPIRED' ? 'expirado' : 'cancelado';
        const registro = await asaasCheckoutsRepository.markStatusIfPending(checkout.id, novoStatus);
        if (registro && registro.credit_purchase_id) {
          await creditPurchasesRepository.markFailedById(Number(registro.credit_purchase_id));
        }
        break;
      }

      // CONFIRMED = o cliente pagou; RECEIVED = o dinheiro caiu na conta
      // Asaas. Para liberar acesso vale o primeiro (segurar o serviço até o
      // dinheiro compensar seria punir quem já pagou), e os dois caem no
      // mesmo tratamento porque ele é idempotente.
      case 'PAYMENT_CONFIRMED':
      case 'PAYMENT_RECEIVED':
        await handlePaymentReceived(req.body.payment || {});
        break;

      case 'PAYMENT_OVERDUE':
        await handlePaymentOverdue(req.body.payment || {});
        break;

      // PIX Automático. O id da autorização vem numa chave própria do corpo,
      // não dentro de payment/checkout.
      case 'PIX_AUTOMATIC_RECURRING_AUTHORIZATION_ACTIVATED':
        await handlePixAuthorizationActivated(req.body.pixAutomaticAuthorization);
        break;
      case 'PIX_AUTOMATIC_RECURRING_AUTHORIZATION_REFUSED':
        await handlePixAuthorizationEncerrada(req.body.pixAutomaticAuthorization, 'recusada');
        break;
      case 'PIX_AUTOMATIC_RECURRING_AUTHORIZATION_EXPIRED':
        await handlePixAuthorizationEncerrada(req.body.pixAutomaticAuthorization, 'expirada');
        break;
      case 'PIX_AUTOMATIC_RECURRING_AUTHORIZATION_CANCELLED':
        await handlePixAuthorizationCancelada(req.body.pixAutomaticAuthorization);
        break;

      default:
        // O Asaas manda dezenas de eventos que não mudam nada do nosso lado
        // (PAYMENT_CREATED, PAYMENT_UPDATED, BANK_SLIP_VIEWED...). Responder
        // 200 pra eles evita que a fila da conta seja pausada.
        break;
    }
    res.json({ received: true });
  } catch (err) {
    logger.error(`Asaas: falha ao processar o evento ${evento}:`, err);
    // 500 faz o Asaas tentar de novo, que é o que queremos quando o erro é
    // nosso (banco fora do ar, por exemplo) - o aviso não se perde.
    res.status(500).json({ error: 'falha ao processar evento' });
  }
}

module.exports = {
  webhook,
  handleCheckoutPaid,
  handlePaymentReceived,
  handlePaymentOverdue,
  handlePixAuthorizationActivated,
};
