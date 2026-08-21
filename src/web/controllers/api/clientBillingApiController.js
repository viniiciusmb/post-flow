// Tela "Planos e credito" do cliente - saldo dos 2 bolsos, os 3 planos lado
// a lado, compra de pacote avulso e cadastro de cartao de excedente. Toda
// acao que depende da Stripe de verdade checa stripeService.isConfigured()
// primeiro e devolve 400 com mensagem clara em vez de deixar o SDK explodir.
'use strict';

const logger = require('../../../lib/logger');
const subscriptionPlansRepository = require('../../../repositories/subscriptionPlansRepository');
const clientSubscriptionsRepository = require('../../../repositories/clientSubscriptionsRepository');
const clientCreditsRepository = require('../../../repositories/clientCreditsRepository');
const overageChargesRepository = require('../../../repositories/overageChargesRepository');
const creditPurchasesRepository = require('../../../repositories/creditPurchasesRepository');
const creditTransactionsRepository = require('../../../repositories/creditTransactionsRepository');
const usersRepository = require('../../../repositories/usersRepository');
const stripeService = require('../../../services/stripeService');
const asaasService = require('../../../services/asaasService');
const asaasBillingService = require('../../../services/asaasBillingService');
const asaasPixAuthorizationsRepository = require('../../../repositories/asaasPixAuthorizationsRepository');
const cpfCnpj = require('../../../lib/cpfCnpj');
const creditsService = require('../../../services/creditsService');
const subscriptionCheckoutService = require('../../../services/subscriptionCheckoutService');
const { resolveStripeCustomerId } = subscriptionCheckoutService;

// Credito avulso: o cliente escolhe MINUTOS numa barra, e o preco por minuto e
// exatamente o mesmo do excedente pela nossa internet. Isso e de proposito: se
// comprar adiantado saisse mais caro que estourar a cota, ninguem compraria; se
// saisse muito mais barato, o excedente viraria pegadinha. Um valor so, vindo
// de creditsService - mudar a taxa la muda os dois juntos, sem chance de
// desencontrar.
const CREDITO_MIN_MINUTOS = 25;
const CREDITO_PASSO_MINUTOS = 25;
const CREDITO_MAX_MINUTOS = 1000;

function centsPorMinutoAvulso() {
  return creditsService.OVERAGE_RATE_CENTS_PER_MIN.normal;
}

// Quantos minutos comprar. Isolada e exportada porque e ela que separa uma
// compra legitima de uma cobranca errada: o numero vem da tela, e um POST
// montado na mao poderia mandar 0, -50, 1e9, "abc" ou 37. Sem piso, teto e
// encaixe no passo, isso viraria credito de graca, uma fatura absurda, ou um
// valor que nao bate com nenhum dos degraus mostrados na barra.
function minutosPedidos(valorRecebido) {
  const numero = Number(valorRecebido);
  if (!Number.isFinite(numero)) return CREDITO_MIN_MINUTOS;
  const emPassos = Math.round(numero / CREDITO_PASSO_MINUTOS) * CREDITO_PASSO_MINUTOS;
  return Math.min(Math.max(emPassos, CREDITO_MIN_MINUTOS), CREDITO_MAX_MINUTOS);
}

function bucketView(credits, key) {
  const quota = credits[`quota_${key}`];
  const used = credits[`used_${key}`];
  const extra = credits[`extra_${key}`];
  return {
    quotaMinutes: quota,
    usedMinutes: used,
    extraMinutes: extra,
    availableMinutes: Math.max(quota - used, 0) + extra,
  };
}

async function overview(req, res) {
  const clientUserId = req.session.user.id;
  const [subscription, credits, plans, pendingOverage, purchases, recentTransactions] = await Promise.all([
    clientSubscriptionsRepository.getOrCreate(clientUserId),
    clientCreditsRepository.getOrCreate(clientUserId),
    subscriptionPlansRepository.listActive(),
    overageChargesRepository.listPendingByClient(clientUserId),
    creditPurchasesRepository.listByClientId(clientUserId, { limit: 10 }),
    creditTransactionsRepository.listByClientId(clientUserId, { limit: 20 }),
  ]);

  res.json({
    stripeConfigured: stripeService.isConfigured(),
    // O dono do sistema nao gasta credito (ver creditsService). A tela precisa
    // saber disso, senao mostra cota e plano pra quem nao esta sujeito a eles.
    isExempt: req.session.user.role === 'admin',
    subscription: {
      planKey: subscription.plan_key || null,
      planName: subscription.plan_name || null,
      status: subscription.status,
      overageCardEnabled: subscription.overage_card_enabled,
    },
    credits: {
      normal: bucketView(credits, 'normal'),
      bonus: bucketView(credits, 'bonus'),
    },
    plans: plans.map((p) => ({
      key: p.key,
      name: p.name,
      priceCents: p.price_cents,
      weeklyMinutesNormal: p.weekly_minutes_normal,
      weeklyMinutesBonus: p.weekly_minutes_bonus,
      maxYoutubeChannels: p.max_youtube_channels,
      maxTiktokAccounts: p.max_tiktok_accounts,
    })),
    overage: {
      rateCentsNormal: creditsService.OVERAGE_RATE_CENTS_PER_MIN.normal,
      rateCentsBonus: creditsService.OVERAGE_RATE_CENTS_PER_MIN.bonus,
      pendingCents: pendingOverage.reduce((sum, c) => sum + c.amount_cents, 0),
    },
    package: {
      minMinutes: CREDITO_MIN_MINUTOS,
      stepMinutes: CREDITO_PASSO_MINUTOS,
      maxMinutes: CREDITO_MAX_MINUTOS,
      centsPerMinute: centsPorMinutoAvulso(),
    },
    recentPurchases: purchases.map((p) => ({
      id: p.id,
      bucket: p.bucket,
      minutes: p.minutes,
      amountCents: p.amount_cents,
      status: p.status,
      createdAt: p.created_at,
    })),
    recentTransactions: recentTransactions.map((t) => ({
      id: t.id,
      sourceVideoId: t.source_video_id,
      bucket: t.bucket,
      status: t.status,
      minutesCharged: t.minutes_charged,
      downloadPath: t.download_path,
      createdAt: t.created_at,
    })),
  });
}

// Assinar um plano pela primeira vez ou trocar de plano - redireciona pro
// Checkout da Stripe (assinatura). Sem Stripe configurada ainda, devolve
// 400 - o admin pode atribuir o plano manualmente enquanto isso (tela de
// admin, sem depender daqui).
// Mensalidade pelo Asaas. Nao precisa de preco cadastrado la (como o
// stripe_price_id exigia): o valor vai no proprio checkout, direto da nossa
// tabela de planos - uma fonte da verdade a menos pra sair de sincronia.
async function subscribe(req, res) {
  const usarAsaas = asaasBillingService.clientePodeUsarAsaas(req.session.user);
  if (!usarAsaas && !stripeService.isConfigured()) {
    return res.status(400).json({ error: res.locals.t('erros.pagamentoIndisponivel') });
  }

  const plan = await subscriptionPlansRepository.findByKey(String(req.body.planKey || ''));
  // O Asaas nao precisa de preco cadastrado la (como o stripe_price_id
  // exigia): o valor vai no proprio checkout, direto da nossa tabela de
  // planos - uma fonte da verdade a menos pra sair de sincronia.
  if (!plan || (!usarAsaas && !plan.stripe_price_id)) {
    return res.status(400).json({ error: res.locals.t('erros.planoInvalido') });
  }

  const clientUserId = req.session.user.id;
  const subscription = await clientSubscriptionsRepository.getOrCreate(clientUserId);
  const origin = `${req.protocol}://${req.get('host')}`;

  if (usarAsaas) {
    const { checkoutUrl } = await asaasBillingService.createSubscriptionCheckout({ clientUserId, plan, origin });
    return res.json({ checkoutUrl });
  }

  const customerId = await resolveStripeCustomerId(clientUserId, subscription);
  const session = await stripeService.createCheckoutSessionForSubscription({
    customerId,
    priceId: plan.stripe_price_id,
    successUrl: `${origin}/client/billing?assinatura=sucesso`,
    cancelUrl: `${origin}/client/billing?assinatura=cancelado`,
    metadata: { clientUserId: String(clientUserId), planKey: plan.key },
  });
  res.json({ checkoutUrl: session.url });
}

// Compra de credito avulso. O preco NAO e mais um pacote fechado vindo da
// tabela settings: e minutos x a taxa de excedente (ver as constantes no topo).
async function buyPackage(req, res) {
  const usarAsaas = asaasBillingService.clientePodeUsarAsaas(req.session.user);
  if (!usarAsaas && !stripeService.isConfigured()) {
    return res.status(400).json({ error: res.locals.t('erros.pagamentoIndisponivel') });
  }

  const bucket = req.body.bucket === 'bonus' ? 'bonus' : 'normal';
  const clientUserId = req.session.user.id;
  const subscription = await clientSubscriptionsRepository.getOrCreate(clientUserId);

  // O valor e recalculado AQUI a partir dos minutos, nunca aceito da tela: se
  // o preco viesse no corpo da requisicao, daria pra comprar 1000 minutos por
  // um centavo.
  const minutes = minutosPedidos(req.body.minutes);
  const priceCents = minutes * centsPorMinutoAvulso();
  const origin = `${req.protocol}://${req.get('host')}`;

  if (usarAsaas) {
    const { checkoutUrl } = await asaasBillingService.createPackageCheckout({
      clientUserId,
      minutes,
      bucket,
      priceCents,
      origin,
    });
    return res.json({ checkoutUrl });
  }

  const customerId = await resolveStripeCustomerId(clientUserId, subscription);
  const session = await stripeService.createCheckoutSessionForPackage({
    customerId,
    amountCents: priceCents,
    minutes,
    bucket,
    successUrl: `${origin}/client/billing?pacote=sucesso`,
    cancelUrl: `${origin}/client/billing?pacote=cancelado`,
    metadata: { clientUserId: String(clientUserId) },
  });
  await creditPurchasesRepository.create({
    clientUserId,
    bucket,
    minutes,
    amountCents: priceCents,
    stripeCheckoutSessionId: session.id,
    provider: 'stripe',
  });
  res.json({ checkoutUrl: session.url });
}

// Assinatura por PIX Automatico: o cliente le UM QR Code que paga a primeira
// mensalidade e autoriza as proximas. Dali em diante o Asaas debita sozinho.
//
// Unico caminho de pagamento que precisa do CPF/CNPJ: a autorizacao exige um
// cliente ja cadastrado no Asaas, e o Asaas nao cria cliente sem documento.
// No cartao, quem coleta tudo e a tela do proprio Asaas.
async function subscribePix(req, res) {
  if (!asaasBillingService.clientePodeUsarAsaas(req.session.user)) {
    return res.status(400).json({ error: res.locals.t('erros.pagamentoIndisponivel') });
  }

  const plan = await subscriptionPlansRepository.findByKey(String(req.body.planKey || ''));
  if (!plan) return res.status(400).json({ error: res.locals.t('erros.planoInvalido') });

  // Validado aqui pra o cliente ver o erro no campo, na hora - e nao depois
  // de esperar uma recusa vinda da API no meio do fluxo de pagamento.
  const documento = cpfCnpj.normalizar(req.body.cpfCnpj);
  if (!documento) return res.status(400).json({ error: res.locals.t('erros.documentoInvalido') });

  const nome = String(req.body.name || '').trim();
  if (nome.length < 3) return res.status(400).json({ error: res.locals.t('erros.nomeInvalido') });

  const clientUserId = req.session.user.id;
  const subscription = await clientSubscriptionsRepository.getOrCreate(clientUserId);

  await usersRepository.setCpfCnpj(clientUserId, documento);

  // Reaproveita o cliente do Asaas se ja existir; recria se tiver sumido
  // (troca de conta/ambiente deixa todo id salvo apontando pro nada - mesma
  // licao que a Stripe deu em 14/08/2026).
  let customerId = subscription.asaas_customer_id;
  if (customerId && !(await asaasService.customerExists(customerId))) customerId = null;
  if (!customerId) {
    const criado = await asaasService.createCustomer({
      name: nome,
      cpfCnpj: documento,
      email: req.session.user.email,
      clientUserId,
    });
    customerId = criado.id;
  }

  const resultado = await asaasBillingService.createPixAutomaticSubscription({ clientUserId, plan, customerId });
  res.json(resultado);
}

// A tela fica perguntando se ja pagou: o cliente sai do site pro app do banco
// e volta, entao nao ha clique de "conclui" pra escutar. O aviso do Asaas e
// quem realmente ativa o plano; isto aqui so atualiza a tela.
async function pixAuthorizationStatus(req, res) {
  const autorizacao = await asaasPixAuthorizationsRepository.findLatestForClient(req.session.user.id);
  if (!autorizacao) return res.json({ status: null });
  res.json({
    authorizationId: autorizacao.asaas_authorization_id,
    status: autorizacao.status,
    activatedAt: autorizacao.activated_at,
  });
}

// Cadastra cartao pra cobranca automatica de excedente (modo "setup" - nao
// cobra nada na hora, so guarda o cartao pro overageBillingJob semanal usar).
async function setupOverageCard(req, res) {
  if (!stripeService.isConfigured()) {
    return res.status(400).json({ error: res.locals.t('erros.cartaoIndisponivel') });
  }

  const clientUserId = req.session.user.id;
  const subscription = await clientSubscriptionsRepository.getOrCreate(clientUserId);
  const customerId = await resolveStripeCustomerId(clientUserId, subscription);

  const origin = `${req.protocol}://${req.get('host')}`;
  const session = await stripeService.createSetupSessionForOverageCard({
    customerId,
    successUrl: `${origin}/client/billing?cartao=sucesso`,
    cancelUrl: `${origin}/client/billing?cartao=cancelado`,
    metadata: { clientUserId: String(clientUserId) },
  });

  res.json({ checkoutUrl: session.url });
}

// ---------------------------------------------------------------------------
// Cartoes e extrato.
//
// Ficam FORA do /overview de proposito: aquele endpoint nao fala com a Stripe,
// entao a tela de plano continua abrindo (saldo, cota, planos) mesmo com a
// Stripe fora do ar ou lenta. Aqui a Stripe e obrigatoria, e uma falha derruba
// so este pedaco da tela.
// ---------------------------------------------------------------------------

// Junta as cobrancas de verdade (que sabem qual cartao pagou, mas nao sabem o
// que foi comprado) com os nossos registros (que sabem o que foi, mas nao o
// cartao). O cruzamento e por payment_intent no caso do avulso e por fatura no
// caso do excedente; fatura que nao e de excedente so pode ser mensalidade.
function montarExtrato(charges, compras, excedentes) {
  const porPaymentIntent = new Map(
    compras.filter((c) => c.stripe_payment_intent_id).map((c) => [c.stripe_payment_intent_id, c])
  );
  const porFatura = new Map(excedentes.map((e) => [e.stripe_invoice_id, e]));

  return charges.map((ch) => {
    const compra = ch.paymentIntentId ? porPaymentIntent.get(ch.paymentIntentId) : null;
    const excedente = ch.invoiceId ? porFatura.get(ch.invoiceId) : null;

    let kind = 'outro';
    let minutes = null;
    if (compra) {
      kind = 'avulso';
      minutes = compra.minutes;
    } else if (excedente) {
      kind = 'excedente';
      minutes = excedente.minutes;
    } else if (ch.invoiceId) {
      // Sobrou fatura que nao e de excedente: no sistema so existe um outro
      // tipo de fatura, a da mensalidade.
      kind = 'plano';
    }

    return {
      id: ch.id,
      createdAt: ch.createdAt,
      kind,
      minutes,
      amountCents: ch.amountCents,
      // Reembolso parcial ou total muda o que o cliente de fato pagou - mostrar
      // so o valor original faria o extrato divergir da fatura do cartao dele.
      refundedCents: ch.amountRefundedCents || 0,
      status: ch.amountRefundedCents >= ch.amountCents && ch.amountCents > 0
        ? 'reembolsado'
        : ch.paid && ch.status === 'succeeded'
          ? 'pago'
          : 'falhou',
      card: ch.card,
      receiptUrl: ch.receiptUrl,
    };
  });
}

async function payments(req, res) {
  if (!stripeService.isConfigured()) {
    return res.status(400).json({ error: res.locals.t('erros.pagamentoIndisponivel') });
  }

  const clientUserId = req.session.user.id;
  const subscription = await clientSubscriptionsRepository.getOrCreate(clientUserId);

  // Sem customer ainda: cliente que nunca fez nenhuma acao de pagamento. Nao e
  // erro - so nao ha cartao nem extrato pra mostrar. Criar um customer so pra
  // responder isso poluiria a Stripe com cliente vazio a cada visita na tela.
  if (!subscription.stripe_customer_id) {
    return res.json({ cards: [], statement: [] });
  }

  const [cards, charges, compras, excedentes] = await Promise.all([
    stripeService.listPaymentMethods(subscription.stripe_customer_id),
    stripeService.listCharges(subscription.stripe_customer_id),
    creditPurchasesRepository.listByClientId(clientUserId, { limit: 100 }),
    overageChargesRepository.listInvoicedByClient(clientUserId),
  ]);

  res.json({ cards, statement: montarExtrato(charges, compras, excedentes) });
}

// Troca qual cartao e usado nas cobrancas automaticas.
async function setDefaultCard(req, res) {
  if (!stripeService.isConfigured()) {
    return res.status(400).json({ error: res.locals.t('erros.pagamentoIndisponivel') });
  }

  const paymentMethodId = String(req.body.paymentMethodId || '');
  if (!paymentMethodId) {
    return res.status(400).json({ error: res.locals.t('erros.valorInvalido') });
  }

  const clientUserId = req.session.user.id;
  const subscription = await clientSubscriptionsRepository.getOrCreate(clientUserId);
  if (!subscription.stripe_customer_id) {
    return res.status(400).json({ error: res.locals.t('erros.nenhumCartaoCadastrado') });
  }

  // O id do cartao vem da tela, entao um POST montado na mao poderia mandar o
  // cartao de outra pessoa. Sem esta checagem, isso viraria "apontar a minha
  // cobranca pro cartao alheio" - a Stripe recusaria a cobranca depois, mas o
  // vinculo errado ja teria sido gravado.
  const ehDele = await stripeService.paymentMethodBelongsToCustomer(
    subscription.stripe_customer_id,
    paymentMethodId
  );
  if (!ehDele) {
    return res.status(404).json({ error: res.locals.t('erros.cartaoNaoEncontrado') });
  }

  await stripeService.setDefaultPaymentMethod(subscription.stripe_customer_id, paymentMethodId);
  await clientSubscriptionsRepository.setOverageCard(clientUserId, {
    enabled: subscription.overage_card_enabled,
    stripeDefaultPaymentMethodId: paymentMethodId,
  });

  res.json({ paymentMethodId });
}

// Desliga a cobranca automatica de excedente (nao mexe no cartao salvo na
// Stripe, so para de usar - o cliente pode ligar de novo depois sem
// recadastrar o cartao).
async function disableOverageCard(req, res) {
  const updated = await clientSubscriptionsRepository.setOverageCard(req.session.user.id, { enabled: false });
  if (!updated) return res.status(404).json({ error: res.locals.t('erros.assinaturaNaoEncontrada') });
  res.json({ overageCardEnabled: updated.overage_card_enabled });
}

module.exports = {
  subscribePix,
  pixAuthorizationStatus,
  overview,
  subscribe,
  buyPackage,
  setupOverageCard,
  disableOverageCard,
  payments,
  setDefaultCard,
  // Exportadas pro teste: sao a trava que impede uma cobranca errada.
  montarExtrato,
  minutosPedidos,
  centsPorMinutoAvulso,
  CREDITO_MIN_MINUTOS,
  CREDITO_PASSO_MINUTOS,
  CREDITO_MAX_MINUTOS,
};
