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
const asaasBillingService = require('../../../services/asaasBillingService');
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
const utmifyService = require('../../../services/utmifyService');
const logger = require('../../../lib/logger');
const receitaService = require('../../../services/receitaService');
const cancelamentoDeAssinaturaService = require('../../../services/cancelamentoDeAssinaturaService');

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
  await receitaService.registrar({
    clientUserId,
    kind: 'credito_avulso',
    provider: 'asaas',
    // Checkout hospedado: o aviso de checkout nao traz o id da cobranca, entao
    // o id do proprio checkout e o que torna o registro unico.
    externalId: `checkout:${registro.asaas_checkout_id}`,
    amountCents: compra.amount_cents,
  });
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
  await receitaService.registrarMensalidade({
    clientUserId,
    provider: 'asaas',
    externalId: `checkout:${registro.asaas_checkout_id}`,
    planId: plan.id,
    amountCents: registro.amount_cents,
  });

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
//
// O aviso traz a autorização INTEIRA em `authorization` (com o id dentro), e
// não um id solto. Até 25/09/2026 o código lia um campo `pixAutomaticAuthorization`
// que o Asaas nunca mandou: o primeiro cliente que assinou por PIX Automático
// pagou, e o aviso caiu em "autorização desconhecida (undefined)" - plano sem
// ativar, receita e Utmify sem registro.
async function handlePixAuthorizationActivated(autorizacao) {
  const authorizationId = autorizacao && autorizacao.id;
  const registro = authorizationId ? await asaasPixAuthorizationsRepository.findByAsaasId(authorizationId) : null;
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

  // O aviso pode vir sem a assinatura e sem o QR imediato (o exemplo da
  // documentação não traz nenhum dos dois); a consulta traz. Falhar aqui não
  // pode impedir o plano de ativar - no pior caso a renovação fica sem dono,
  // que é o que acontecia antes.
  let detalhes = autorizacao;
  if (!detalhes.subscriptionId || !detalhes.immediateQrCode || !detalhes.status) {
    try {
      detalhes = { ...autorizacao, ...(await asaasService.getPixAutomaticAuthorization(authorizationId)) };
    } catch (err) {
      logger.error(`Asaas: nao consegui consultar a autorizacao Pix ${authorizationId} (seguindo sem ela):`, err.message);
    }
  }

  const antes = await clientSubscriptionsRepository.getOrCreate(clientUserId);
  const primeiraAtivacao = antes.status === 'sem_plano' || !antes.plan_id;

  await clientSubscriptionsRepository.setPlan(clientUserId, plan.id);
  // A assinatura que o Asaas cria a partir da autorização é quem gera as
  // mensalidades seguintes, e elas chegam com `payment.subscription` = este
  // id. Sem guardá-lo, toda renovação caía em "assinatura desconhecida".
  await clientSubscriptionsRepository.setAsaasPixAuthorization(clientUserId, {
    customerId: registro.asaas_customer_id,
    authorizationId,
    subscriptionId: detalhes.subscriptionId || null,
  });
  await clientSubscriptionsRepository.setStatus(clientUserId, 'ativo');
  // O QR imediato sai pelo preço de estreia: a promoção foi usada agora.
  await clientSubscriptionsRepository.markFirstMonthUsed(clientUserId);

  if (primeiraAtivacao) await clientCreditsRepository.applyPlanQuotaNow(clientUserId, plan.id);
  await creditsUnlockService.unlockAwaitingCreditsForClient(clientUserId);
  logger.info(`Asaas: cliente ${clientUserId} ativou o plano ${plan.key} por PIX Automatico.`);

  try {
    await registrarPrimeiraMensalidadePix({ registro, detalhes, clientUserId, plan });
  } catch (err) {
    logger.error(`Asaas: falha ao registrar a 1a mensalidade Pix do cliente ${clientUserId}:`, err);
  }

  // O aviso de cancelamento pode ter chegado ANTES deste (ou se perdido). Se a
  // consulta já diz que a autorização caiu, o mês pago vale e acaba sozinho -
  // sem isto, `setPlan` acima deixaria o plano ativo para sempre de graça.
  if (detalhes.status === 'CANCELLED') {
    await encerrarPixNoFimDoMesPago({ ...ativada, client_user_id: clientUserId }, 'autorizacao ja cancelada ao ativar');
  }
}

// A primeira mensalidade do PIX Automático não passa pelo nosso checkout: é
// o QR imediato da autorização, e o Asaas o registra como uma cobrança avulsa
// ("gerada a partir de Pix recebido"), sem assinatura e sem referência nossa.
// O que liga as duas é o identificador de conciliação do QR, que volta na
// cobrança como `pixQrCodeId`. Com o id da cobrança em mãos, receita,
// comissão e Utmify ficam presos a ela - e um estorno futuro dela desfaz tudo
// pelo caminho de sempre.
async function registrarPrimeiraMensalidadePix({ registro, detalhes, clientUserId, plan }) {
  const conciliacao = detalhes.immediateQrCode && detalhes.immediateQrCode.conciliationIdentifier;
  let pagamento = null;
  if (conciliacao && registro.asaas_customer_id) {
    try {
      const lista = await asaasService.listPaymentsByCustomer(registro.asaas_customer_id);
      pagamento =
        ((lista && lista.data) || []).find(
          (p) => p.pixQrCodeId === conciliacao && ['RECEIVED', 'CONFIRMED'].includes(p.status)
        ) || null;
    } catch (err) {
      logger.error(`Asaas: nao consegui listar as cobrancas do cliente ${registro.asaas_customer_id}:`, err.message);
    }
  }

  // Sem a cobrança, ainda assim registra: o dinheiro entrou (a autorização só
  // ativa com o QR pago). O id sintético mantém o registro único.
  const externalId = pagamento ? pagamento.id : `pix-autorizacao:${registro.asaas_authorization_id}`;
  const amountCents = pagamento ? Math.round(Number(pagamento.value) * 100) : Number(registro.amount_cents);

  await receitaService.registrarMensalidade({
    clientUserId,
    provider: 'asaas',
    externalId,
    planId: plan.id,
    amountCents,
    billingType: 'PIX',
  });

  try {
    await affiliateService.recordCommissionForPayment({
      clientUserId,
      provider: 'asaas',
      externalPaymentId: externalId,
      amountPaidCents: amountCents,
    });
  } catch (err) {
    logger.error(`Asaas: falha ao processar comissao da 1a mensalidade Pix ${externalId}:`, err);
  }

  // Fecha o MESMO pedido que foi anunciado como pendente quando o QR foi
  // gerado (utmify_order_id). Autorização de antes dessa coluna existir não
  // tem pedido: aí a venda vai pelo id da cobrança, como antes.
  utmifyService.vendaPaga(
    asaasBillingService.pedidoUtmifyDoPix(registro, {
      asaas_payment_id: registro.utmify_order_id || externalId,
      client_user_id: clientUserId,
      plan_id: plan.id,
      amount_cents: amountCents,
      paid_at: (pagamento && (pagamento.clientPaymentDate || pagamento.paymentDate)) || new Date(),
    })
  );
}

// QR que expirou, foi recusado ou cancelado SEM nunca ter sido pago: a compra
// morreu, e a Utmify precisa saber - senão o pedido fica "aguardando
// pagamento" para sempre no funil. Exceto quando a pessoa já gerou outro QR
// do mesmo pedido: aí ela ainda está tentando, e dar a venda como perdida
// agora faria o pedido piscar de pendente para recusado e de volta.
async function avisarUtmifyDoPixPerdido(registro) {
  if (!registro || !registro.utmify_order_id) return;
  const viva = await asaasPixAuthorizationsRepository.pedidoTemOutraTentativaViva(
    registro.utmify_order_id,
    registro.asaas_authorization_id
  );
  if (viva) return;
  utmifyService.vendaRecusada(asaasBillingService.pedidoUtmifyDoPix(registro));
}

// Autorização recusada, expirada ou cancelada pelo cliente no app do banco.
// Sem autorização ativa não há cobrança nenhuma, então a assinatura para.
async function handlePixAuthorizationEncerrada(authorizationId, status) {
  const registro = await asaasPixAuthorizationsRepository.markFinalIfPending(authorizationId, status);
  if (!registro) return;
  logger.warn(`Asaas: autorizacao Pix ${authorizationId} terminou como "${status}" (cliente ${registro.client_user_id}).`);
  await avisarUtmifyDoPixPerdido(registro);
}

// A autorização que JÁ estava ativa foi cancelada - pelo cliente no app do
// banco, ou pelo próprio banco logo depois do primeiro pagamento (visto em
// 26/09/2026: ativada e cancelada 66 ms depois, motivo "OTHER", com os
// R$59,90 do primeiro mês já recebidos). Sem autorização não há mais cobrança
// nenhuma, mas o mês pago é do cliente: o acesso segue até o fim dele, igual
// ao cancelamento do cartão, e só então vira cancelado. Se ele autorizar de
// novo, `setPlan` desfaz o agendamento.
async function handlePixAuthorizationCancelada(authorizationId) {
  const registro = await asaasPixAuthorizationsRepository.findByAsaasId(authorizationId);
  if (!registro) return;
  const perdida = await asaasPixAuthorizationsRepository.markFinalIfPending(authorizationId, 'cancelada');
  if (perdida) await avisarUtmifyDoPixPerdido(perdida);
  if (registro.status !== 'ativa') return;
  await encerrarPixNoFimDoMesPago(registro, 'autorizacao cancelada');
}

// Fim do período pago: o maior entre o livro de receita (última mensalidade +
// 1 mês) e a própria ativação + 1 mês. A ativação entra porque ela SÓ acontece
// com o QR imediato pago, e porque a receita da primeira mensalidade pode não
// ter sido gravada (consulta ao Asaas que falhou).
async function encerrarPixNoFimDoMesPago(registro, origem) {
  const clientUserId = Number(registro.client_user_id);
  const pelaReceita = await cancelamentoDeAssinaturaService.fimDoPeriodoPago(clientUserId);
  const pelaAtivacao = registro.activated_at ? new Date(registro.activated_at) : null;
  if (pelaAtivacao) pelaAtivacao.setMonth(pelaAtivacao.getMonth() + 1);
  const candidatos = [pelaReceita, pelaAtivacao].filter(Boolean);
  const fim = candidatos.length ? new Date(Math.max(...candidatos.map((d) => d.getTime()))) : null;

  if (fim && fim > new Date()) {
    const agendado = await clientSubscriptionsRepository.agendarFimDoPix(
      clientUserId,
      registro.asaas_authorization_id,
      fim
    );
    if (agendado) {
      logger.warn(
        `Asaas: PIX Automatico do cliente ${clientUserId} encerrado (${origem}) - acesso mantido ate ${new Date(agendado.cancel_at).toISOString()}.`
      );
      return;
    }
  }
  await clientSubscriptionsRepository.setStatus(clientUserId, 'inadimplente');
  logger.warn(`Asaas: PIX Automatico do cliente ${clientUserId} encerrado (${origem}) - sem mes pago em aberto, inadimplente.`);
}

// Os avisos de uma mesma autorização chegam colados (ativação e cancelamento
// com 66 ms de diferença) e a ativação consulta o Asaas no meio. Soltos, o
// cancelamento rodaria no meio da ativação e o resultado dependeria de quem
// termina primeiro. Um de cada vez, na ordem de chegada.
const filasDeAutorizacao = new Map();
function emOrdemPorAutorizacao(id, tarefa) {
  const anterior = filasDeAutorizacao.get(id) || Promise.resolve();
  const atual = anterior.catch(() => {}).then(tarefa);
  filasDeAutorizacao.set(id, atual);
  return atual.finally(() => {
    if (filasDeAutorizacao.get(id) === atual) filasDeAutorizacao.delete(id);
  });
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
  // Guardado numa variavel da funcao inteira (e nao so deste if) porque mais
  // abaixo ele decide se a renovacao mensal precisa ser avisada a Utmify: sem
  // essa guarda, a primeira mensalidade seria contada duas vezes la.
  const registroLocal = payment.id ? await asaasPaymentsRepository.findByAsaasId(payment.id) : null;
  if (registroLocal) await checkoutService.aplicarPagamentoConfirmado(registroLocal);

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
      if (!registroLocal) {
        avisarUtmifyDaRenovacao(payment, extras.client_user_id, { purpose: 'extra_slots' });
        await receitaService.registrar({
          clientUserId: extras.client_user_id,
          kind: 'conexoes_extras',
          provider: 'asaas',
          externalId: payment.id,
          amountCents: Math.round(Number(payment.value) * 100),
          billingType: payment.billingType || null,
        });
      }
      return;
    }
    logger.warn(`Asaas: pagamento ${payment.id} de uma assinatura desconhecida (${payment.subscription}).`);
    return;
  }
  const clientUserId = assinatura.client_user_id;

  // Mensalidade do 2o mes em diante. Ela NAO passa pelo nosso checkout (quem
  // cobra e a assinatura recorrente do Asaas), entao nao existe linha em
  // asaas_payments e o aviso a Utmify precisa sair daqui - senao o painel
  // mostraria a venda de estreia de cada cliente e mais nenhuma depois.
  if (!registroLocal) {
    avisarUtmifyDaRenovacao(payment, clientUserId, { purpose: 'subscription', planId: assinatura.plan_id });
    // Receita recorrente. Era exatamente esta a parte que nao ficava gravada em
    // lugar nenhum - e e a que sustenta o negocio. Guardada pelo mesmo
    // `!registroLocal`: a primeira mensalidade ja foi registrada pelo checkout.
    await receitaService.registrarMensalidade({
      clientUserId,
      provider: 'asaas',
      externalId: payment.id,
      planId: assinatura.plan_id,
      amountCents: Math.round(Number(payment.value) * 100),
      billingType: payment.billingType || null,
    });
  }

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

// A renovacao vira um "pedido" com a mesma cara dos que nascem no nosso
// checkout, montado a partir do aviso do Asaas. O id do pedido continua sendo
// o id da cobranca, que e o que impede a venda de aparecer duplicada caso a
// integracao nativa do Asaas com a Utmify tambem entregue a mesma cobranca.
function avisarUtmifyDaRenovacao(payment, clientUserId, { purpose, planId = null }) {
  utmifyService.vendaPaga({
    asaas_payment_id: payment.id,
    client_user_id: clientUserId,
    purpose,
    plan_id: planId,
    billing_type: payment.billingType || 'CREDIT_CARD',
    amount_cents: Math.round(Number(payment.value) * 100),
    created_at: payment.dateCreated || null,
    paid_at: payment.paymentDate || null,
  });
}

// ---------- estorno, contestação e cobrança apagada ----------

// Todo evento que significa "o dinheiro saiu da nossa conta ou foi retido"
// cai aqui. A contestação de cartão (chargeback) entra junto porque o valor é
// retido no MOMENTO em que ela é aberta, não quando é julgada: esperar o
// julgamento deixaria a comissão sacável durante semanas, e saque a gente não
// consegue trazer de volta.
//
// O estorno PARCIAL desfaz tudo, e não uma parte proporcional. É o lado seguro
// do erro: comissão sobre dinheiro devolvido é prejuízo, e o caso não existe
// hoje (nossas cobranças são mensalidades cheias).
async function handlePaymentRefunded(payment, motivo) {
  if (!payment.id) return;

  // Receita primeiro e para QUALQUER cobranca: renovacao, checkout, excedente.
  // Idempotente (so marca o que ainda nao estava estornado).
  await receitaService.marcarEstorno({ provider: 'asaas', externalId: payment.id });

  const registro = await asaasPaymentsRepository.findByAsaasId(payment.id);
  if (registro) {
    await checkoutService.aplicarEstorno(registro, motivo);
    return;
  }

  // Cobrança que não passou pelo nosso checkout (renovação da assinatura, ou
  // baixa feita à mão no painel do Asaas). Não há o que devolver de crédito,
  // mas a comissão e o acesso continuam valendo o mesmo.
  await affiliateService.reverseCommissionForPayment({ externalPaymentId: payment.id, motivo });

  if (!payment.subscription) return;
  const assinatura = await clientSubscriptionsRepository.findByAsaasSubscriptionId(payment.subscription);
  if (!assinatura) return;
  await clientSubscriptionsRepository.setStatus(assinatura.client_user_id, 'inadimplente');
  logger.warn(
    `Asaas: mensalidade ${payment.id} estornada (${motivo}) - cliente ${assinatura.client_user_id} marcado inadimplente.`
  );
}

// A contestação foi ganha, ou o estorno foi negado: o dinheiro ficou conosco.
async function handleRefundReverted(payment) {
  if (!payment.id) return;

  await receitaService.desfazerEstorno({ provider: 'asaas', externalId: payment.id });

  const registro = await asaasPaymentsRepository.findByAsaasId(payment.id);
  if (registro) {
    await checkoutService.reverterEstorno(registro);
    return;
  }

  await affiliateService.restoreCommissionForPayment({ externalPaymentId: payment.id });
  if (!payment.subscription) return;
  const assinatura = await clientSubscriptionsRepository.findByAsaasSubscriptionId(payment.subscription);
  if (!assinatura) return;
  await clientSubscriptionsRepository.setStatus(assinatura.client_user_id, 'ativo');
  logger.info(`Asaas: estorno de ${payment.id} revertido - cliente ${assinatura.client_user_id} reativado.`);
}

// Mensalidade venceu sem pagamento. Marca inadimplente na hora, que é o que
// trava processamento novo - esperar o Asaas cancelar a assinatura sozinho
// levaria dias de serviço prestado de graça.
async function handlePaymentOverdue(payment) {
  // Cobrança do checkout transparente que venceu sem pagamento (PIX que
  // ninguém pagou, tipicamente). Sem isso ela ficaria "pendente" para sempre
  // no histórico do cliente - o pior estado possível numa tela de pagamento,
  // porque não dá para saber se pagou.
  if (payment.id) {
    const recusado = await asaasPaymentsRepository.markStatusIfPending(payment.id, 'falhou');
    // So avisa se ELE estava mesmo pendente ate agora: o markStatusIfPending
    // devolve null no aviso repetido, e ai nao ha mudanca nenhuma a contar.
    if (recusado) utmifyService.vendaRecusada(recusado);
  }

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

// Cartão recusado DEPOIS de a cobrança ficar pendente (reprovado na análise
// antifraude, ou captura recusada). No caminho síncrono a recusa já é tratada
// na hora; este aviso é o caso do cartão que entrou "em análise". Sem ele, a
// venda ficava pendente para sempre (no histórico e na Utmify) e a recorrência
// de uma mensalidade que nunca foi paga continuava de pé.
async function handlePagamentoRecusado(payment) {
  if (!payment.id) return;
  const recusado = await asaasPaymentsRepository.markStatusIfPending(payment.id, 'falhou');
  if (!recusado) return; // não era nosso, ou já tinha sido resolvido
  utmifyService.vendaRecusada(recusado);

  if (recusado.purpose === 'credit_package' && recusado.credit_purchase_id) {
    await creditPurchasesRepository.markFailedById(Number(recusado.credit_purchase_id));
  }
  if (recusado.purpose === 'subscription') {
    await cancelamentoDeAssinaturaService.desfazerAssinaturaNaoPaga(recusado);
  }
  logger.warn(`Asaas: cobranca ${payment.id} recusada depois da analise (cliente ${recusado.client_user_id}).`);
}

function idDaAutorizacao(corpo) {
  return (corpo && corpo.authorization && corpo.authorization.id) || null;
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
  const alvo =
    (req.body.checkout && req.body.checkout.id) ||
    (req.body.payment && req.body.payment.id) ||
    (req.body.subscription && req.body.subscription.id) ||
    idDaAutorizacao(req.body) ||
    '-';
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

      case 'PAYMENT_CREDIT_CARD_CAPTURE_REFUSED':
      case 'PAYMENT_REPROVED_BY_RISK_ANALYSIS':
        await handlePagamentoRecusado(req.body.payment || {});
        break;

      // Assinatura cancelada no painel do Asaas, removida ou inativada. O
      // acesso segue até o fim do período pago (ver
      // cancelamentoDeAssinaturaService). Se este aviso se perder, a
      // conferência de hora em hora acha o mesmo cancelamento.
      case 'SUBSCRIPTION_INACTIVATED':
      case 'SUBSCRIPTION_DELETED':
        await cancelamentoDeAssinaturaService.registrarEncerramento(
          req.body.subscription && req.body.subscription.id,
          { origem: evento }
        );
        break;

      // Dinheiro devolvido ou retido. Sem estes casos o prejuízo era em
      // dobro: o valor voltava para o cliente E a comissão do afiliado
      // continuava creditada e sacável.
      case 'PAYMENT_REFUNDED':
      case 'PAYMENT_PARTIALLY_REFUNDED':
        await handlePaymentRefunded(req.body.payment || {}, 'estorno');
        break;

      // Contestação no cartão: o valor é retido assim que ela é aberta.
      case 'PAYMENT_CHARGEBACK_REQUESTED':
      case 'PAYMENT_CHARGEBACK_DISPUTE':
      case 'PAYMENT_AWAITING_CHARGEBACK_REVERSAL':
        await handlePaymentRefunded(req.body.payment || {}, 'contestacao no cartao');
        break;

      // Cobrança apagada no painel do Asaas depois de paga.
      case 'PAYMENT_DELETED':
        await handlePaymentRefunded(req.body.payment || {}, 'cobranca removida');
        break;

      // Caminho de volta: contestação ganha, estorno negado, ou cobrança
      // restaurada.
      case 'PAYMENT_REFUND_DENIED':
      case 'PAYMENT_RESTORED':
        await handleRefundReverted(req.body.payment || {});
        break;

      // PIX Automático. A autorização vem inteira em `authorization` (ver
      // handlePixAuthorizationActivated).
      case 'PIX_AUTOMATIC_RECURRING_AUTHORIZATION_ACTIVATED':
        await emOrdemPorAutorizacao(idDaAutorizacao(req.body), () => handlePixAuthorizationActivated(req.body.authorization));
        break;
      case 'PIX_AUTOMATIC_RECURRING_AUTHORIZATION_REFUSED':
        await emOrdemPorAutorizacao(idDaAutorizacao(req.body), () => handlePixAuthorizationEncerrada(idDaAutorizacao(req.body), 'recusada'));
        break;
      case 'PIX_AUTOMATIC_RECURRING_AUTHORIZATION_EXPIRED':
        await emOrdemPorAutorizacao(idDaAutorizacao(req.body), () => handlePixAuthorizationEncerrada(idDaAutorizacao(req.body), 'expirada'));
        break;
      case 'PIX_AUTOMATIC_RECURRING_AUTHORIZATION_CANCELLED':
        await emOrdemPorAutorizacao(idDaAutorizacao(req.body), () => handlePixAuthorizationCancelada(idDaAutorizacao(req.body)));
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
  handlePaymentRefunded,
  handleRefundReverted,
  handleCheckoutPaid,
  handlePaymentReceived,
  handlePaymentOverdue,
  handlePagamentoRecusado,
  handlePixAuthorizationActivated,
  handlePixAuthorizationEncerrada,
  handlePixAuthorizationCancelada,
};
