// Limite de canais do YouTube / contas TikTok por plano. NULL no banco
// (subscription_plans.max_youtube_channels/max_tiktok_accounts) = sem limite
// (plano Max). Cliente sem plano ativo (plan_id NULL - ver
// clientSubscriptionsRepository) e tratado como limite 0, bloqueado ate o
// admin atribuir um plano manualmente.
'use strict';

const clientSubscriptionsRepository = require('../repositories/clientSubscriptionsRepository');

const NO_PLAN_MESSAGE = 'Voce ainda nao tem um plano ativo - fale com o suporte pra ativar sua assinatura.';

async function checkChannelLimit(clientUserId, currentCount) {
  const subscription = await clientSubscriptionsRepository.getOrCreate(clientUserId);
  if (!subscription.plan_id) return { allowed: false, reason: NO_PLAN_MESSAGE };
  if (subscription.max_youtube_channels === null) return { allowed: true };
  if (currentCount >= subscription.max_youtube_channels) {
    return {
      allowed: false,
      reason: `Seu plano permite ate ${subscription.max_youtube_channels} canal(is) do YouTube monitorado(s). Faca upgrade pra adicionar mais.`,
    };
  }
  return { allowed: true };
}

async function checkTiktokAccountLimit(clientUserId, currentCount) {
  const subscription = await clientSubscriptionsRepository.getOrCreate(clientUserId);
  if (!subscription.plan_id) return { allowed: false, reason: NO_PLAN_MESSAGE };
  if (subscription.max_tiktok_accounts === null) return { allowed: true };
  if (currentCount >= subscription.max_tiktok_accounts) {
    return {
      allowed: false,
      reason: `Seu plano permite ate ${subscription.max_tiktok_accounts} conta(s) TikTok conectada(s). Faca upgrade pra conectar mais.`,
    };
  }
  return { allowed: true };
}

module.exports = { checkChannelLimit, checkTiktokAccountLimit };
