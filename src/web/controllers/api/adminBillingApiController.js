// Visao do admin: atribuicao manual de plano (sem depender da Stripe - ver
// CLAUDE.md, decisao confirmada de que cliente sem cartao ainda fica
// bloqueado ate o admin atribuir um plano na mao) e faturamento de
// excedente por cliente.
'use strict';

const clientSubscriptionsRepository = require('../../../repositories/clientSubscriptionsRepository');
const clientCreditsRepository = require('../../../repositories/clientCreditsRepository');
const subscriptionPlansRepository = require('../../../repositories/subscriptionPlansRepository');
const overageChargesRepository = require('../../../repositories/overageChargesRepository');
const creditsUnlockService = require('../../../services/creditsUnlockService');

async function listClients(req, res) {
  const subscriptions = await clientSubscriptionsRepository.listAllWithPlan();
  res.json({
    clients: subscriptions.map((s) => ({
      clientUserId: s.client_user_id,
      email: s.email,
      businessName: s.business_name,
      planKey: s.plan_key,
      planName: s.plan_name,
      status: s.status,
      overageCardEnabled: s.overage_card_enabled,
    })),
  });
}

async function listPlans(req, res) {
  const plans = await subscriptionPlansRepository.listActive();
  res.json({
    plans: plans.map((p) => ({
      id: p.id,
      key: p.key,
      name: p.name,
      priceCents: p.price_cents,
      weeklyMinutesNormal: p.weekly_minutes_normal,
      weeklyMinutesBonus: p.weekly_minutes_bonus,
      maxYoutubeChannels: p.max_youtube_channels,
      maxTiktokAccounts: p.max_tiktok_accounts,
    })),
  });
}

// Atribuicao manual - funciona pra ativar um cliente sem plano nenhum ou
// trocar o plano de um cliente ja ativo. Primeira ativacao aplica a cota
// nova na hora (nao ha ciclo atual pra proteger); troca de plano de quem ja
// estava ativo so muda plan_id/limites/prioridade na hora, a cota espera o
// proximo reset semanal (ver creditWeeklyResetJob) - mesma regra que vale
// quando o cliente troca de plano sozinho via Stripe.
async function assignPlan(req, res) {
  const clientUserId = Number(req.params.clientUserId);
  const plan = await subscriptionPlansRepository.findByKey(String(req.body.planKey || ''));
  if (!plan) return res.status(400).json({ error: 'Plano invalido.' });

  const before = await clientSubscriptionsRepository.getOrCreate(clientUserId);
  const firstActivation = before.status === 'sem_plano' || !before.plan_id;

  await clientSubscriptionsRepository.setPlan(clientUserId, plan.id);
  if (firstActivation) {
    await clientCreditsRepository.applyPlanQuotaNow(clientUserId, plan.id);
  }
  await creditsUnlockService.unlockAwaitingCreditsForClient(clientUserId);

  res.json({ clientUserId, planKey: plan.key, firstActivation });
}

async function overageSummary(req, res) {
  const summary = await overageChargesRepository.summaryByClient();
  res.json({
    clients: summary.map((c) => ({
      clientUserId: c.client_user_id,
      email: c.email,
      businessName: c.business_name,
      pendingCents: Number(c.pending_cents),
      billedCents: Number(c.billed_cents),
    })),
  });
}

module.exports = { listClients, listPlans, assignPlan, overageSummary };
