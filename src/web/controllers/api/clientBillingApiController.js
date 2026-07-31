// Tela "Planos e credito" do cliente - saldo dos 2 bolsos, os 3 planos lado
// a lado, compra de pacote avulso e cadastro de cartao de excedente. Toda
// acao que depende da Stripe de verdade checa stripeService.isConfigured()
// primeiro e devolve 400 com mensagem clara em vez de deixar o SDK explodir
// (as chaves ainda nao chegaram - ver CLAUDE.md).
'use strict';

const subscriptionPlansRepository = require('../../../repositories/subscriptionPlansRepository');
const clientSubscriptionsRepository = require('../../../repositories/clientSubscriptionsRepository');
const clientCreditsRepository = require('../../../repositories/clientCreditsRepository');
const overageChargesRepository = require('../../../repositories/overageChargesRepository');
const creditPurchasesRepository = require('../../../repositories/creditPurchasesRepository');
const creditTransactionsRepository = require('../../../repositories/creditTransactionsRepository');
const settingsRepository = require('../../../repositories/settingsRepository');
const usersRepository = require('../../../repositories/usersRepository');
const stripeService = require('../../../services/stripeService');
const creditsService = require('../../../services/creditsService');

// Cria o customer na Stripe na primeira vez que o cliente faz qualquer
// acao de pagamento (assinar, comprar avulso, cadastrar cartao) e guarda o
// id pra reaproveitar dai em diante.
async function resolveStripeCustomerId(clientUserId, subscription) {
  if (subscription.stripe_customer_id) return subscription.stripe_customer_id;
  const user = await usersRepository.findById(clientUserId);
  const customerId = await stripeService.ensureCustomer(null, {
    email: user.email,
    name: user.business_name,
    clientUserId,
  });
  await clientSubscriptionsRepository.setStripeCustomer(clientUserId, customerId);
  return customerId;
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
  const [subscription, credits, plans, pendingOverage, purchases, recentTransactions, packageMinutes, packagePriceCents] =
    await Promise.all([
      clientSubscriptionsRepository.getOrCreate(clientUserId),
      clientCreditsRepository.getOrCreate(clientUserId),
      subscriptionPlansRepository.listActive(),
      overageChargesRepository.listPendingByClient(clientUserId),
      creditPurchasesRepository.listByClientId(clientUserId, { limit: 10 }),
      creditTransactionsRepository.listByClientId(clientUserId, { limit: 20 }),
      settingsRepository.getValue('credit_package_minutes', 100),
      settingsRepository.getValue('credit_package_price_cents', 4990),
    ]);

  res.json({
    stripeConfigured: stripeService.isConfigured(),
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
    package: { minutes: packageMinutes, priceCents: packagePriceCents },
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
async function subscribe(req, res) {
  if (!stripeService.isConfigured()) {
    return res.status(400).json({ error: 'Pagamento por cartao ainda nao esta disponivel - fale com o suporte.' });
  }

  const plan = await subscriptionPlansRepository.findByKey(String(req.body.planKey || ''));
  if (!plan || !plan.stripe_price_id) {
    return res.status(400).json({ error: 'Plano invalido.' });
  }

  const clientUserId = req.session.user.id;
  const subscription = await clientSubscriptionsRepository.getOrCreate(clientUserId);
  const customerId = await resolveStripeCustomerId(clientUserId, subscription);

  const origin = `${req.protocol}://${req.get('host')}`;
  const session = await stripeService.createCheckoutSessionForSubscription({
    customerId,
    priceId: plan.stripe_price_id,
    successUrl: `${origin}/client/billing?assinatura=sucesso`,
    cancelUrl: `${origin}/client/billing?assinatura=cancelado`,
    metadata: { clientUserId: String(clientUserId), planKey: plan.key },
  });

  res.json({ checkoutUrl: session.url });
}

// Pacote avulso de credito - preco/tamanho vem da tabela settings (ver
// migration 039), nao fica fixo no codigo.
async function buyPackage(req, res) {
  if (!stripeService.isConfigured()) {
    return res.status(400).json({ error: 'Pagamento por cartao ainda nao esta disponivel - fale com o suporte.' });
  }

  const bucket = req.body.bucket === 'bonus' ? 'bonus' : 'normal';
  const clientUserId = req.session.user.id;
  const [subscription, minutes, priceCents] = await Promise.all([
    clientSubscriptionsRepository.getOrCreate(clientUserId),
    settingsRepository.getValue('credit_package_minutes', 100),
    settingsRepository.getValue('credit_package_price_cents', 4990),
  ]);

  const customerId = await resolveStripeCustomerId(clientUserId, subscription);

  const origin = `${req.protocol}://${req.get('host')}`;
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
  });

  res.json({ checkoutUrl: session.url });
}

// Cadastra cartao pra cobranca automatica de excedente (modo "setup" - nao
// cobra nada na hora, so guarda o cartao pro overageBillingJob semanal usar).
async function setupOverageCard(req, res) {
  if (!stripeService.isConfigured()) {
    return res.status(400).json({ error: 'Cadastro de cartao ainda nao esta disponivel - fale com o suporte.' });
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

// Desliga a cobranca automatica de excedente (nao mexe no cartao salvo na
// Stripe, so para de usar - o cliente pode ligar de novo depois sem
// recadastrar o cartao).
async function disableOverageCard(req, res) {
  const updated = await clientSubscriptionsRepository.setOverageCard(req.session.user.id, { enabled: false });
  if (!updated) return res.status(404).json({ error: 'Assinatura nao encontrada.' });
  res.json({ overageCardEnabled: updated.overage_card_enabled });
}

module.exports = { overview, subscribe, buyPackage, setupOverageCard, disableOverageCard };
