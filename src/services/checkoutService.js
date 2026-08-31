// Checkout transparente: o pagamento acontece DENTRO do Post Flow.
//
// Antes, "pagar" era sair do sistema para uma tela hospedada pelo Asaas. Isso
// resolvia o problema de nunca ver o cartão, mas cobrava um preço alto:
// quem estava comprando era jogado para outro domínio, com outra identidade
// visual, no exato momento em que mais precisa confiar no que está vendo. Com
// a tokenização liberada para a conta, o cartão pode ser trocado por um token
// na nossa própria requisição e a tela nunca muda de lugar.
//
// AS TRÊS REGRAS DESTE ARQUIVO
//
//   1. Número de cartão, CVV e validade NUNCA são gravados nem registrados em
//      log. Eles existem durante uma requisição, viram token, e somem. O que
//      fica no banco é o token (referência opaca, só utilizável nesta conta do
//      Asaas), a bandeira e os 4 últimos dígitos.
//
//   2. Dinheiro nunca se move antes de o caminho de volta existir. Onde há
//      duas etapas (assinatura recorrente + primeira mensalidade), a que NÃO
//      move dinheiro vem primeiro e é desfeita se a segunda falhar.
//
//   3. Nada é liberado por causa da resposta síncrona sozinha. Toda liberação
//      passa por asaas_payments.markPaidOnce, que é condicionado ao status
//      anterior — então o aviso do Asaas chegando depois (ou duas vezes) nunca
//      credita em dobro.
'use strict';

const asaasService = require('./asaasService');
const asaasPaymentsRepository = require('../repositories/asaasPaymentsRepository');
const clientSubscriptionsRepository = require('../repositories/clientSubscriptionsRepository');
const clientCreditsRepository = require('../repositories/clientCreditsRepository');
const creditPurchasesRepository = require('../repositories/creditPurchasesRepository');
const subscriptionPlansRepository = require('../repositories/subscriptionPlansRepository');
const usersRepository = require('../repositories/usersRepository');
const creditsUnlockService = require('./creditsUnlockService');
const affiliateService = require('./affiliateService');
const cpfCnpj = require('../lib/cpfCnpj');
const logger = require('../lib/logger');

const { AsaasError } = asaasService;

// Datas que o Asaas espera no formato AAAA-MM-DD, sempre no fuso de Brasília.
// Usar o fuso do servidor daria certo hoje (a VPS está em UTC e a diferença
// não cruza o dia na maior parte das horas) e erraria numa madrugada — uma
// cobrança "vencida ontem" que nasce vencida.
function dataAsaas(deslocamentoDias = 0) {
  const agora = new Date(Date.now() + deslocamentoDias * 86400000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(agora);
}

// Quantos dias até a assinatura recorrente começar a cobrar. 30 e não "mesmo
// dia do mês que vem" porque o Asaas cobra pelo calendário e um cliente que
// assina dia 31 não teria fevereiro.
const DIAS_ATE_A_RENOVACAO = 30;

// ---------------------------------------------------------------------------
// Preço
// ---------------------------------------------------------------------------

// Os dois degraus do preço. `price_cents` é o valor cheio da mensalidade;
// `first_month_price_cents` é o promocional, e ele só vale uma vez por cliente
// — sem isso, cancelar e reassinar viraria desconto permanente.
function precoDaAssinatura(plan, subscription) {
  const temPromo = Boolean(plan.first_month_price_cents) && !subscription.first_month_used_at;
  return {
    promo: temPromo,
    primeiraCobrancaCents: temPromo ? plan.first_month_price_cents : plan.price_cents,
    recorrenteCents: plan.price_cents,
  };
}

// ---------------------------------------------------------------------------
// Cliente no Asaas
// ---------------------------------------------------------------------------

// Reaproveita o cliente do Asaas se existir; recria se tiver sumido. Trocar de
// conta ou de ambiente deixa todo id salvo apontando para o nada — a mesma
// lição que a Stripe deu em 14/08/2026, quando todo botão de pagamento morreu
// com "Algo deu errado" porque os ids do modo teste não existiam no modo vivo.
async function resolverCustomer(clientUserId, { nome, documento, email, telefone }) {
  const subscription = await clientSubscriptionsRepository.getOrCreate(clientUserId);

  let customerId = subscription.asaas_customer_id;
  if (customerId && !(await asaasService.customerExists(customerId))) {
    logger.warn(`Cliente do Asaas ${customerId} (cliente #${clientUserId}) sumiu desta conta - recriando.`);
    customerId = null;
    // O token de cartão pertence ao CLIENTE do Asaas: com o cliente morto, ele
    // não cobra mais nada. Mantê-lo faria a cobrança de excedente falhar longe
    // da tela, no meio de um processamento, sem ninguém ver — exatamente o
    // estrago que a troca de chaves da Stripe causou em 14/08/2026.
    await clientSubscriptionsRepository.clearAsaasCard(clientUserId);
  }

  if (customerId) {
    // Nome e documento podem ter mudado desde a primeira compra (o cliente
    // digita de novo a cada checkout). Manter o cadastro do Asaas alinhado
    // evita antifraude recusando por divergência de titular.
    await asaasService
      .updateCustomer(customerId, { name: nome, cpfCnpj: documento, email, mobilePhone: telefone || undefined })
      .catch((err) => logger.warn(`Nao consegui atualizar o cliente ${customerId} no Asaas: ${err.message}`));
    return customerId;
  }

  const criado = await asaasService.createCustomer({
    name: nome,
    cpfCnpj: documento,
    email,
    mobilePhone: telefone || undefined,
    clientUserId,
  });
  // Só o vínculo com o cliente do Asaas. Cartão nenhum é preservado aqui: ou
  // não havia nenhum, ou ele acabou de ser apagado junto do cliente morto.
  await clientSubscriptionsRepository.setAsaasCard(clientUserId, {
    customerId: criado.id,
    token: null,
    brand: null,
    last4: null,
    exp: null,
    enableOverage: false,
  });
  return criado.id;
}

// ---------------------------------------------------------------------------
// Cartão
// ---------------------------------------------------------------------------

// Erro de preenchimento que o cliente consegue corrigir sozinho. Distinguir
// isso de "Asaas fora do ar" é o que decide se a tela mostra o campo errado ou
// pede para tentar mais tarde.
class DadosInvalidosError extends Error {
  constructor(mensagem) {
    super(mensagem);
    this.name = 'DadosInvalidosError';
    this.status = 400;
  }
}

// Confere e normaliza o que veio do formulário ANTES de qualquer ida ao Asaas.
// Um campo faltando aqui viraria lá uma recusa genérica, e na tela de
// pagamento "não foi possível" é o pior texto possível.
function validarDadosDoTitular({ nome, documento, email, cep, numeroEndereco, telefone }) {
  const nomeLimpo = String(nome || '').trim();
  if (nomeLimpo.length < 3) throw new DadosInvalidosError('Informe o nome completo do titular do cartão.');

  const doc = cpfCnpj.normalizar(documento);
  if (!doc) throw new DadosInvalidosError('CPF ou CNPJ inválido.');

  const cepLimpo = String(cep || '').replace(/\D/g, '');
  if (cepLimpo.length !== 8) throw new DadosInvalidosError('CEP inválido — informe os 8 dígitos.');

  const numero = String(numeroEndereco || '').trim();
  if (!numero) throw new DadosInvalidosError('Informe o número do endereço de cobrança.');

  const fone = String(telefone || '').replace(/\D/g, '');
  if (fone && (fone.length < 10 || fone.length > 11)) {
    throw new DadosInvalidosError('Telefone inválido — informe DDD e número.');
  }

  return {
    nome: nomeLimpo,
    documento: doc,
    email: String(email || '').trim(),
    cep: cepLimpo,
    numeroEndereco: numero,
    telefone: fone || null,
  };
}

// Só formato: quem decide se o cartão presta é o Asaas. Isto existe para o
// erro de digitação óbvio virar mensagem no campo em vez de uma recusa vinda
// da API depois de o cliente já ter clicado em "Pagar".
function validarCartao(card) {
  const numero = String(card && card.number ? card.number : '').replace(/\D/g, '');
  if (numero.length < 13 || numero.length > 19) throw new DadosInvalidosError('Número do cartão inválido.');

  const ccv = String(card.ccv || '').replace(/\D/g, '');
  if (ccv.length < 3 || ccv.length > 4) throw new DadosInvalidosError('Código de segurança inválido.');

  const mes = String(card.expiryMonth || '').replace(/\D/g, '').padStart(2, '0');
  if (!/^(0[1-9]|1[0-2])$/.test(mes)) throw new DadosInvalidosError('Mês de validade inválido.');

  // Aceita 2 ou 4 dígitos: o cartão é impresso dos dois jeitos, e obrigar um
  // formato só transformaria a leitura do próprio cartão num erro.
  let ano = String(card.expiryYear || '').replace(/\D/g, '');
  if (ano.length === 2) ano = `20${ano}`;
  if (!/^20\d{2}$/.test(ano)) throw new DadosInvalidosError('Ano de validade inválido.');

  const titular = String(card.holderName || '').trim();
  if (titular.length < 3) throw new DadosInvalidosError('Informe o nome como está impresso no cartão.');

  return { number: numero, ccv, expiryMonth: mes, expiryYear: ano, holderName: titular };
}

// Troca o cartão por um token e guarda a referência. É a única porta de
// entrada de cartão do sistema — assinatura, crédito avulso, conexões extras e
// excedente usam todos o token que sai daqui.
async function salvarCartao({ clientUserId, dadosDoTitular, cartao, remoteIp, email }) {
  const titular = validarDadosDoTitular({ ...dadosDoTitular, email: dadosDoTitular.email || email });
  const card = validarCartao(cartao);

  const customerId = await resolverCustomer(clientUserId, {
    nome: titular.nome,
    documento: titular.documento,
    email: titular.email,
    telefone: titular.telefone,
  });

  await usersRepository.setCpfCnpj(clientUserId, titular.documento);

  const tokenizado = await asaasService.tokenizeCard({
    customerId,
    card,
    holder: {
      name: titular.nome,
      email: titular.email,
      cpfCnpj: titular.documento,
      postalCode: titular.cep,
      addressNumber: titular.numeroEndereco,
      phone: titular.telefone,
      mobilePhone: titular.telefone,
    },
    remoteIp,
  });

  // SALVAR NÃO É AUTORIZAR. O cartão fica guardado para as próximas compras,
  // mas a cobrança automática de excedente (a única que tira dinheiro sem
  // ninguém clicar em nada) continua DESLIGADA até o cliente ligar de
  // propósito. Ligar junto seria transformar "paguei uma vez" em "autorizei
  // cobranças futuras" sem ele ter dito isso — e é exatamente esse tipo de
  // suposição que vira contestação no cartão.
  await clientSubscriptionsRepository.setAsaasCard(clientUserId, {
    customerId,
    token: tokenizado.creditCardToken,
    brand: tokenizado.creditCardBrand || null,
    last4: tokenizado.creditCardNumber || null,
    exp: `${card.expiryMonth}/${card.expiryYear}`,
    enableOverage: false,
  });

  return {
    customerId,
    token: tokenizado.creditCardToken,
    brand: tokenizado.creditCardBrand || null,
    last4: tokenizado.creditCardNumber || null,
  };
}

// ---------------------------------------------------------------------------
// Assinatura
// ---------------------------------------------------------------------------

// Uma cobrança do Asaas que já pode ser considerada paga. CONFIRMED = o cartão
// autorizou; RECEIVED = o dinheiro caiu. Para liberar acesso vale o primeiro:
// segurar o serviço até compensar seria punir quem já pagou.
function pagamentoAprovado(payment) {
  return payment && (payment.status === 'CONFIRMED' || payment.status === 'RECEIVED');
}

// Assina (ou troca de plano) com o cartão salvo.
//
// ORDEM DELIBERADA: a assinatura recorrente nasce primeiro, com vencimento no
// mês que vem — criar assinatura futura não move dinheiro nenhum. Só depois a
// primeira mensalidade é cobrada. Se o cartão for recusado nessa hora, a
// assinatura é cancelada e o cliente termina exatamente como começou. Na ordem
// inversa, um erro depois do pagamento deixaria dinheiro cobrado sem
// recorrência e sem jeito automático de perceber.
async function assinarComCartaoSalvo({ clientUserId, plan, remoteIp }) {
  const subscription = await clientSubscriptionsRepository.getOrCreate(clientUserId);
  if (!subscription.asaas_card_token) {
    throw new DadosInvalidosError('Nenhum cartão salvo — cadastre um cartão antes de assinar.');
  }
  const customerId = subscription.asaas_customer_id;
  if (!customerId) throw new DadosInvalidosError('Cadastro de pagamento incompleto — cadastre o cartão de novo.');

  const preco = precoDaAssinatura(plan, subscription);

  // Trocar de plano não pode deixar a assinatura antiga cobrando junto.
  await cancelarAssinaturaAnterior(clientUserId, subscription);

  const assinatura = await asaasService.createSubscription({
    customerId,
    billingType: 'CREDIT_CARD',
    amountCents: preco.recorrenteCents,
    nextDueDate: dataAsaas(DIAS_ATE_A_RENOVACAO),
    description: `Post Flow ${plan.name}`,
    externalReference: `assinatura:${clientUserId}:${plan.key}`,
    creditCardToken: subscription.asaas_card_token,
    remoteIp,
  });

  let cobranca;
  try {
    cobranca = await asaasService.createPayment({
      customerId,
      billingType: 'CREDIT_CARD',
      amountCents: preco.primeiraCobrancaCents,
      dueDate: dataAsaas(0),
      description: `Post Flow ${plan.name}${preco.promo ? ' - 1o mes' : ''}`,
      externalReference: `assinatura:${clientUserId}:${plan.key}`,
      creditCardToken: subscription.asaas_card_token,
      remoteIp,
    });
  } catch (err) {
    // Cartão recusado (ou qualquer falha na cobrança): desfaz a recorrência
    // que acabou de nascer, senão o cliente seria cobrado mês que vem por um
    // plano que nunca chegou a valer.
    await asaasService
      .cancelSubscription(assinatura.id)
      .catch((e) => logger.error(`Nao consegui cancelar a assinatura ${assinatura.id} apos falha na 1a cobranca:`, e.message));
    throw err;
  }

  await asaasPaymentsRepository.create({
    asaasPaymentId: cobranca.id,
    clientUserId,
    purpose: 'subscription',
    billingType: 'CREDIT_CARD',
    amountCents: preco.primeiraCobrancaCents,
    planId: plan.id,
  });

  await clientSubscriptionsRepository.setAsaasSubscription(clientUserId, {
    customerId,
    subscriptionId: assinatura.id,
  });

  if (!pagamentoAprovado(cobranca)) {
    // Cartão que entra em análise: a assinatura fica de pé e o aviso do Asaas
    // ativa o plano quando o resultado sair. Dizer "pronto" agora seria mentir.
    return { pago: false, status: cobranca.status, paymentId: cobranca.id, preco };
  }

  await ativarAssinaturaPaga({ clientUserId, plan, asaasPaymentId: cobranca.id, amountCents: preco.primeiraCobrancaCents });
  return { pago: true, paymentId: cobranca.id, preco };
}

// Cancela no Asaas a assinatura recorrente anterior do cliente (troca de
// plano). Falha aqui não pode impedir a assinatura nova de nascer, mas precisa
// ficar gritando no log: é dinheiro sendo cobrado duas vezes.
async function cancelarAssinaturaAnterior(clientUserId, subscription) {
  if (!subscription.asaas_subscription_id) return;
  try {
    await asaasService.cancelSubscription(subscription.asaas_subscription_id);
  } catch (err) {
    logger.error(
      `ATENCAO: nao consegui cancelar a assinatura antiga ${subscription.asaas_subscription_id} do cliente ${clientUserId} - ela pode continuar cobrando:`,
      err.message
    );
  }
}

// Ponto único de ativação de plano. Chamado pelo caminho síncrono (cartão
// aprovado na hora) E pelo webhook — markPaidOnce garante que só o primeiro
// dos dois faz efeito.
async function ativarAssinaturaPaga({ clientUserId, plan, asaasPaymentId, amountCents }) {
  const marcado = await asaasPaymentsRepository.markPaidOnce(asaasPaymentId);
  if (!marcado) return false;

  const antes = await clientSubscriptionsRepository.getOrCreate(clientUserId);
  const primeiraAtivacao = antes.status === 'sem_plano' || !antes.plan_id;

  await clientSubscriptionsRepository.setPlan(clientUserId, plan.id);
  await clientSubscriptionsRepository.setStatus(clientUserId, 'ativo');
  // A promoção é consumida quando o primeiro mês é efetivamente PAGO, não
  // quando a tela é aberta: quem tentou e teve o cartão recusado continua com
  // direito ao desconto.
  await clientSubscriptionsRepository.markFirstMonthUsed(clientUserId);

  if (primeiraAtivacao) await clientCreditsRepository.applyPlanQuotaNow(clientUserId, plan.id);
  await creditsUnlockService.unlockAwaitingCreditsForClient(clientUserId);

  try {
    await affiliateService.recordCommissionForPayment({
      clientUserId,
      provider: 'asaas',
      externalPaymentId: asaasPaymentId,
      amountPaidCents: amountCents,
    });
  } catch (err) {
    logger.error(`Falha ao processar comissao do pagamento ${asaasPaymentId}:`, err);
  }

  logger.info(`Cliente ${clientUserId} ativou o plano ${plan.key} (pagamento ${asaasPaymentId}).`);
  return true;
}

// ---------------------------------------------------------------------------
// Crédito avulso
// ---------------------------------------------------------------------------

// A compra nasce pendente ANTES de existir cobrança: se o registro fosse
// criado depois, um pagamento confirmado rápido demais poderia chegar sem ter
// linha para atualizar.
async function criarCompraDeCredito({ clientUserId, minutes, bucket, priceCents }) {
  return creditPurchasesRepository.create({
    clientUserId,
    bucket,
    minutes,
    amountCents: priceCents,
    provider: 'asaas',
  });
}

async function comprarCreditoComCartao({ clientUserId, minutes, bucket, priceCents, remoteIp }) {
  const subscription = await clientSubscriptionsRepository.getOrCreate(clientUserId);
  if (!subscription.asaas_card_token || !subscription.asaas_customer_id) {
    throw new DadosInvalidosError('Nenhum cartão salvo — cadastre um cartão antes de comprar.');
  }

  const compra = await criarCompraDeCredito({ clientUserId, minutes, bucket, priceCents });

  let cobranca;
  try {
    cobranca = await asaasService.createPayment({
      customerId: subscription.asaas_customer_id,
      billingType: 'CREDIT_CARD',
      amountCents: priceCents,
      dueDate: dataAsaas(0),
      description: `Post Flow - ${minutes} min de credito`,
      externalReference: `credito:${compra.id}`,
      creditCardToken: subscription.asaas_card_token,
      remoteIp,
    });
  } catch (err) {
    // A cobrança não chegou a existir, então esta compra nunca poderá ser
    // paga. Deixá-la "pendente" faria o histórico mostrar para sempre uma
    // compra que o cliente não fez e não tem como concluir.
    await creditPurchasesRepository.markFailedById(compra.id).catch(() => {});
    throw err;
  }

  await asaasPaymentsRepository.create({
    asaasPaymentId: cobranca.id,
    clientUserId,
    purpose: 'credit_package',
    billingType: 'CREDIT_CARD',
    amountCents: priceCents,
    creditPurchaseId: compra.id,
  });

  if (!pagamentoAprovado(cobranca)) return { pago: false, status: cobranca.status, paymentId: cobranca.id };

  await liberarCreditoPago({ asaasPaymentId: cobranca.id, clientUserId, creditPurchaseId: compra.id });
  return { pago: true, paymentId: cobranca.id, minutes };
}

async function comprarCreditoComPix({ clientUserId, minutes, bucket, priceCents, dadosDoTitular, email }) {
  const titular = validarDadosDoTitular({
    ...dadosDoTitular,
    email: dadosDoTitular.email || email,
    // O PIX não passa por antifraude de cartão: o Asaas só precisa do cliente
    // cadastrado, e cliente exige documento. CEP e número não fazem falta aqui,
    // então pedi-los seria atrito sem motivo.
    cep: dadosDoTitular.cep || '00000000',
    numeroEndereco: dadosDoTitular.numeroEndereco || 's/n',
  });

  const customerId = await resolverCustomer(clientUserId, {
    nome: titular.nome,
    documento: titular.documento,
    email: titular.email,
    telefone: titular.telefone,
  });
  await usersRepository.setCpfCnpj(clientUserId, titular.documento);

  const compra = await criarCompraDeCredito({ clientUserId, minutes, bucket, priceCents });

  let cobranca;
  try {
    cobranca = await asaasService.createPayment({
      customerId,
      billingType: 'PIX',
      amountCents: priceCents,
      dueDate: dataAsaas(1),
      description: `Post Flow - ${minutes} min de credito`,
      externalReference: `credito:${compra.id}`,
    });
  } catch (err) {
    await creditPurchasesRepository.markFailedById(compra.id).catch(() => {});
    throw err;
  }

  await asaasPaymentsRepository.create({
    asaasPaymentId: cobranca.id,
    clientUserId,
    purpose: 'credit_package',
    billingType: 'PIX',
    amountCents: priceCents,
    creditPurchaseId: compra.id,
  });

  const qr = await asaasService.getPixQrCode(cobranca.id);
  return {
    pago: false,
    paymentId: cobranca.id,
    pixCopiaECola: qr.payload,
    qrCodeBase64: qr.encodedImage,
    minutes,
  };
}

// Ponto único de liberação de crédito avulso — caminho síncrono e webhook caem
// os dois aqui, e markPaidOnce decide qual dos dois chegou primeiro.
async function liberarCreditoPago({ asaasPaymentId, clientUserId, creditPurchaseId }) {
  const marcado = await asaasPaymentsRepository.markPaidOnce(asaasPaymentId);
  if (!marcado) return false;

  const compra = await creditPurchasesRepository.markPaidById(Number(creditPurchaseId), asaasPaymentId);
  if (!compra) {
    logger.error(`Compra de credito ${creditPurchaseId} nao estava pendente ao confirmar o pagamento ${asaasPaymentId}.`);
    return false;
  }

  await clientCreditsRepository.addExtra(clientUserId, compra.bucket, compra.minutes);
  // Vídeo parado por falta de crédito volta pra fila sozinho — sem isso o
  // cliente pagaria e continuaria olhando para um vídeo travado.
  await creditsUnlockService.unlockAwaitingCreditsForClient(clientUserId);
  logger.info(`${compra.minutes} min de credito liberados pro cliente ${clientUserId} (compra ${compra.id}).`);
  return true;
}

// ---------------------------------------------------------------------------
// Conexões extras
// ---------------------------------------------------------------------------

// Cada slot = 1 canal do YouTube + 1 conta do TikTok a mais. Só existe nos
// planos que trazem extra_slot_price_cents; nos outros, a saída é trocar de
// plano (e é isso que a tela diz).
//
// Mesma estrutura de dois passos da assinatura: uma cobrança avulsa cobre o
// mês corrente (e é ela que libera os slots na hora), e a recorrência passa a
// valer do mês seguinte em diante.
async function comprarSlotsExtras({ clientUserId, quantidade, remoteIp }) {
  const subscription = await clientSubscriptionsRepository.getOrCreate(clientUserId);
  if (!subscription.plan_id) throw new DadosInvalidosError('Assine um plano antes de comprar conexões extras.');
  if (!subscription.extra_slot_price_cents) {
    throw new DadosInvalidosError('Seu plano não vende conexões extras — troque para o plano maior.');
  }
  if (!subscription.asaas_card_token || !subscription.asaas_customer_id) {
    throw new DadosInvalidosError('Nenhum cartão salvo — cadastre um cartão antes de comprar.');
  }

  const precoUnitario = Number(subscription.extra_slot_price_cents);
  const total = Number(subscription.extra_slots) + quantidade;
  const valorAgoraCents = precoUnitario * quantidade;

  const cobranca = await asaasService.createPayment({
    customerId: subscription.asaas_customer_id,
    billingType: 'CREDIT_CARD',
    amountCents: valorAgoraCents,
    dueDate: dataAsaas(0),
    description: `Post Flow - ${quantidade} conexao(oes) extra(s)`,
    externalReference: `extras:${clientUserId}:${quantidade}`,
    creditCardToken: subscription.asaas_card_token,
    remoteIp,
  });

  await asaasPaymentsRepository.create({
    asaasPaymentId: cobranca.id,
    clientUserId,
    purpose: 'extra_slots',
    billingType: 'CREDIT_CARD',
    amountCents: valorAgoraCents,
    slots: quantidade,
  });

  if (!pagamentoAprovado(cobranca)) return { pago: false, status: cobranca.status, paymentId: cobranca.id };

  await liberarSlotsPagos({ asaasPaymentId: cobranca.id, clientUserId, slots: quantidade });
  return { pago: true, paymentId: cobranca.id, slots: total };
}

// Ponto único de liberação de slot — síncrono e webhook caem aqui.
//
// A recorrência é ajustada DEPOIS de os slots já valerem: se o Asaas falhar
// nessa hora, o cliente fica com o que pagou e o problema é nosso (aparece no
// log), não dele.
async function liberarSlotsPagos({ asaasPaymentId, clientUserId, slots }) {
  const marcado = await asaasPaymentsRepository.markPaidOnce(asaasPaymentId);
  if (!marcado) return false;

  const subscription = await clientSubscriptionsRepository.getOrCreate(clientUserId);
  const total = Number(subscription.extra_slots) + Number(slots);
  await clientSubscriptionsRepository.setExtraSlots(clientUserId, { slots: total });

  try {
    await sincronizarAssinaturaDeExtras(clientUserId);
  } catch (err) {
    logger.error(
      `ATENCAO: cliente ${clientUserId} pagou ${slots} conexao(oes) extra(s) mas a recorrencia nao foi ajustada:`,
      err.message
    );
  }
  logger.info(`Cliente ${clientUserId} agora tem ${total} conexao(oes) extra(s).`);
  return true;
}

// Deixa a assinatura recorrente das conexões extras com o valor certo para o
// número atual de slots. Cria, ajusta ou cancela — uma função só, porque as
// três situações têm que terminar consistentes com a mesma coluna.
async function sincronizarAssinaturaDeExtras(clientUserId) {
  const subscription = await clientSubscriptionsRepository.getOrCreate(clientUserId);
  const slots = Number(subscription.extra_slots);
  const idAtual = subscription.asaas_extra_slots_subscription_id;

  if (slots === 0) {
    if (idAtual) await asaasService.cancelSubscription(idAtual);
    await clientSubscriptionsRepository.clearExtraSlotsSubscription(clientUserId);
    return null;
  }

  const valorCents = Number(subscription.extra_slot_price_cents) * slots;

  if (idAtual) {
    await asaasService.updateSubscription(idAtual, { value: valorCents / 100, updatePendingPayments: true });
    return idAtual;
  }

  const assinatura = await asaasService.createSubscription({
    customerId: subscription.asaas_customer_id,
    billingType: 'CREDIT_CARD',
    amountCents: valorCents,
    // O mês corrente já foi pago na cobrança avulsa que liberou os slots.
    nextDueDate: dataAsaas(DIAS_ATE_A_RENOVACAO),
    description: 'Post Flow - conexoes extras',
    externalReference: `extras:${clientUserId}`,
    creditCardToken: subscription.asaas_card_token,
  });
  await clientSubscriptionsRepository.setExtraSlots(clientUserId, {
    slots,
    asaasSubscriptionId: assinatura.id,
  });
  return assinatura.id;
}

// Devolver conexões extras. Sem reembolso do mês em curso (está escrito na
// tela): o que muda é o que será cobrado daqui para frente.
async function removerSlotsExtras({ clientUserId, quantidade }) {
  const subscription = await clientSubscriptionsRepository.getOrCreate(clientUserId);
  const total = Math.max(Number(subscription.extra_slots) - quantidade, 0);
  await clientSubscriptionsRepository.setExtraSlots(clientUserId, { slots: total });
  await sincronizarAssinaturaDeExtras(clientUserId);
  return total;
}

// ---------------------------------------------------------------------------
// Conferência de pagamento pendente (PIX)
// ---------------------------------------------------------------------------

// Pergunta ao Asaas se uma cobrança pendente já foi paga.
//
// Existe como rede de segurança do webhook, não como substituto dele: quem
// paga um PIX fica olhando a tela esperando, e um aviso que demora 30 segundos
// (ou que a fila do Asaas atrasou) viraria "paguei e não aconteceu nada".
async function conferirPagamentoPendente(asaasPaymentId, clientUserId) {
  const registro = await asaasPaymentsRepository.findByAsaasId(asaasPaymentId);
  // Confere o dono: o id vem da tela, e sem isto daria pra perguntar (e
  // liberar) o pagamento de outra pessoa.
  if (!registro || Number(registro.client_user_id) !== Number(clientUserId)) return { status: 'desconhecido' };
  if (registro.status === 'pago') return { status: 'pago' };
  if (registro.status !== 'pendente') return { status: registro.status };

  let payment;
  try {
    payment = await asaasService.getPayment(asaasPaymentId);
  } catch (err) {
    logger.warn(`Nao consegui conferir o pagamento ${asaasPaymentId} no Asaas: ${err.message}`);
    return { status: 'pendente' };
  }

  if (!pagamentoAprovado(payment)) return { status: 'pendente' };
  await aplicarPagamentoConfirmado(registro);
  return { status: 'pago' };
}

// Traduz "esta cobrança foi paga" na consequência certa para a finalidade
// dela. Usado pela conferência sob demanda e pelo webhook — os dois precisam
// da mesma tabela de decisões, e duplicá-la seria garantir que um dia
// divergem.
async function aplicarPagamentoConfirmado(registro) {
  const clientUserId = Number(registro.client_user_id);

  if (registro.purpose === 'credit_package') {
    return liberarCreditoPago({
      asaasPaymentId: registro.asaas_payment_id,
      clientUserId,
      creditPurchaseId: Number(registro.credit_purchase_id),
    });
  }

  if (registro.purpose === 'extra_slots') {
    return liberarSlotsPagos({
      asaasPaymentId: registro.asaas_payment_id,
      clientUserId,
      slots: Number(registro.slots),
    });
  }

  const plan = await subscriptionPlansRepository.findById(Number(registro.plan_id));
  if (!plan) {
    logger.error(`Plano ${registro.plan_id} nao encontrado ao confirmar o pagamento ${registro.asaas_payment_id}.`);
    return false;
  }
  return ativarAssinaturaPaga({
    clientUserId,
    plan,
    asaasPaymentId: registro.asaas_payment_id,
    amountCents: Number(registro.amount_cents),
  });
}

module.exports = {
  DadosInvalidosError,
  AsaasError,
  dataAsaas,
  precoDaAssinatura,
  validarDadosDoTitular,
  validarCartao,
  resolverCustomer,
  salvarCartao,
  assinarComCartaoSalvo,
  comprarCreditoComCartao,
  comprarCreditoComPix,
  comprarSlotsExtras,
  removerSlotsExtras,
  sincronizarAssinaturaDeExtras,
  conferirPagamentoPendente,
  aplicarPagamentoConfirmado,
  ativarAssinaturaPaga,
  liberarCreditoPago,
  liberarSlotsPagos,
  pagamentoAprovado,
  DIAS_ATE_A_RENOVACAO,
};
