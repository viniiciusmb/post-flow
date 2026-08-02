// Limite de canais do YouTube / contas TikTok por plano. NULL no banco
// (subscription_plans.max_youtube_channels/max_tiktok_accounts) = sem limite
// (plano Max). Cliente sem plano ativo (plan_id NULL - ver
// clientSubscriptionsRepository) e tratado como limite 0, bloqueado ate o
// admin atribuir um plano manualmente.
'use strict';

const clientSubscriptionsRepository = require('../repositories/clientSubscriptionsRepository');

// As mensagens daqui aparecem direto na tela do cliente, entao sao escritas
// como frase, com acento e plural de verdade. "1 canal(is) monitorado(s)" era
// o jeito preguicoso de fugir do plural e denunciava mensagem escrita por
// desenvolvedor, nao pra quem le.
const NO_PLAN_MESSAGE =
  'Você ainda não tem um plano ativo. Fale com o suporte pra ativar sua assinatura.';

function plural(quantidade, singular, plural_) {
  return `${quantidade} ${quantidade === 1 ? singular : plural_}`;
}

async function checkChannelLimit(clientUserId, currentCount) {
  const subscription = await clientSubscriptionsRepository.getOrCreate(clientUserId);
  if (!subscription.plan_id) return { allowed: false, reason: NO_PLAN_MESSAGE };
  if (subscription.max_youtube_channels === null) return { allowed: true };
  if (currentCount >= subscription.max_youtube_channels) {
    return {
      allowed: false,
      reason: `Seu plano acompanha ${plural(subscription.max_youtube_channels, 'canal', 'canais')} do YouTube. Troque de plano pra adicionar mais.`,
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
      reason: `Seu plano publica em ${plural(subscription.max_tiktok_accounts, 'conta', 'contas')} do TikTok. Troque de plano pra conectar mais.`,
    };
  }
  return { allowed: true };
}

module.exports = { checkChannelLimit, checkTiktokAccountLimit };
