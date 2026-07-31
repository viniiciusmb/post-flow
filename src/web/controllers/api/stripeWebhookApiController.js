// Webhook publico da Stripe (sem sessao - a Stripe chama isso direto). A
// rota precisa do corpo BRUTO (nao JSON-parseado) pra verificar a assinatura
// - ver express.raw() montado em src/web/app.js antes do express.json()
// global. Sem STRIPE_WEBHOOK_SECRET configurada, constructWebhookEvent
// lanca erro e devolvemos 400 (a Stripe tenta de novo sozinha).
'use strict';

const stripeService = require('../../../services/stripeService');
const clientSubscriptionsRepository = require('../../../repositories/clientSubscriptionsRepository');
const clientCreditsRepository = require('../../../repositories/clientCreditsRepository');
const subscriptionPlansRepository = require('../../../repositories/subscriptionPlansRepository');
const creditPurchasesRepository = require('../../../repositories/creditPurchasesRepository');
const creditsUnlockService = require('../../../services/creditsUnlockService');
const logger = require('../../../lib/logger');

async function handleCheckoutCompleted(session) {
  const clientUserId = Number(session.metadata && session.metadata.clientUserId);
  if (!Number.isInteger(clientUserId)) {
    logger.error(`Webhook checkout.session.completed sem clientUserId no metadata (session ${session.id}).`);
    return;
  }

  if (session.mode === 'subscription') {
    const planKey = session.metadata.planKey;
    const plan = await subscriptionPlansRepository.findByKey(planKey);
    if (!plan) {
      logger.error(`Webhook checkout.session.completed: plano "${planKey}" nao encontrado (session ${session.id}).`);
      return;
    }
    const before = await clientSubscriptionsRepository.getOrCreate(clientUserId);
    const firstActivation = before.status === 'sem_plano' || !before.plan_id;
    await clientSubscriptionsRepository.setPlan(clientUserId, plan.id);
    await clientSubscriptionsRepository.setStripeSubscription(clientUserId, session.subscription);
    if (firstActivation) {
      await clientCreditsRepository.applyPlanQuotaNow(clientUserId, plan.id);
    }
    await creditsUnlockService.unlockAwaitingCreditsForClient(clientUserId);
    return;
  }

  if (session.mode === 'payment') {
    const purchase = await creditPurchasesRepository.markPaidByCheckoutSession(session.id, session.payment_intent);
    if (!purchase) {
      logger.error(`Webhook checkout.session.completed (pagamento): compra nao encontrada pra session ${session.id}.`);
      return;
    }
    await clientCreditsRepository.addExtra(clientUserId, purchase.bucket, purchase.minutes);
    await creditsUnlockService.unlockAwaitingCreditsForClient(clientUserId);
    return;
  }

  if (session.mode === 'setup') {
    const setupIntent = await stripeService.retrieveSetupIntent(session.setup_intent);
    await stripeService.setDefaultPaymentMethod(session.customer, setupIntent.payment_method);
    await clientSubscriptionsRepository.setOverageCard(clientUserId, {
      enabled: true,
      stripeDefaultPaymentMethodId: setupIntent.payment_method,
    });
    await creditsUnlockService.unlockAwaitingCreditsForClient(clientUserId);
  }
}

// Sincroniza status (ativo/inadimplente/cancelado) quando a Stripe muda a
// assinatura por conta propria (falha de cobranca, cliente cancela no
// portal etc) - nao mexe na cota de credito aqui, so no proximo reset
// semanal (ver creditWeeklyResetJob).
async function handleSubscriptionUpdated(subscription) {
  const existing = await clientSubscriptionsRepository.findByStripeCustomerId(subscription.customer);
  if (!existing) return;
  const clientUserId = existing.client_user_id;

  if (subscription.status === 'active' || subscription.status === 'trialing') {
    await clientSubscriptionsRepository.setStatus(clientUserId, 'ativo');
  } else if (subscription.status === 'past_due' || subscription.status === 'unpaid') {
    await clientSubscriptionsRepository.setStatus(clientUserId, 'inadimplente');
  } else if (subscription.status === 'canceled') {
    await clientSubscriptionsRepository.setStatus(clientUserId, 'cancelado');
  }
}

async function webhook(req, res) {
  let event;
  try {
    event = stripeService.constructWebhookEvent(req.body, req.headers['stripe-signature']);
  } catch (err) {
    logger.error('Webhook da Stripe com assinatura invalida:', err.message);
    return res.status(400).json({ error: `Webhook invalido: ${err.message}` });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutCompleted(event.data.object);
        break;
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
        await handleSubscriptionUpdated(event.data.object);
        break;
      default:
        break;
    }
    res.json({ received: true });
  } catch (err) {
    logger.error(`Falha ao processar webhook da Stripe (${event.type}):`, err);
    res.status(500).json({ error: 'Falha ao processar evento.' });
  }
}

module.exports = { webhook };
