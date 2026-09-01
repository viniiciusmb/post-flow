// Limite de canais do YouTube / contas TikTok por plano.
//
// O limite efetivo e a soma de duas coisas: o que o PLANO da
// (subscription_plans.max_youtube_channels/max_tiktok_accounts) mais as
// CONEXOES EXTRAS que o cliente comprou.
//
// Ate 01/09/2026 extra era um pacote fechado (1 canal E 1 conta, sempre em
// par). Agora sao dois contadores independentes - extra_channels e
// extra_tiktok_accounts - porque quem so queria mais um canal estava pagando
// pelos dois. Quem leva o par continua ganhando desconto no PRECO (ver
// lib/precoDasConexoesExtras), mas o limite de cada lado e contado separado.
//
// NULL no banco = sem limite (nao ha plano assim hoje, mas a coluna continua
// aceitando). Cliente sem plano ativo (plan_id NULL) e tratado como limite 0,
// bloqueado ate assinar ou ate o admin atribuir um plano manualmente.
'use strict';

const clientSubscriptionsRepository = require('../repositories/clientSubscriptionsRepository');

// As mensagens daqui aparecem direto na tela do cliente, entao sao escritas
// como frase, com acento e plural de verdade. "1 canal(is) monitorado(s)" era
// o jeito preguicoso de fugir do plural e denunciava mensagem escrita por
// desenvolvedor, nao pra quem le.
const NO_PLAN_MESSAGE =
  'Você ainda não tem um plano ativo. Assine um plano pra começar a usar.';

function plural(quantidade, singular, plural_) {
  return `${quantidade} ${quantidade === 1 ? singular : plural_}`;
}

// Quantas conexoes o cliente tem direito, ja somando o que ele comprou.
// Exportada porque a TELA precisa do mesmo numero: mostrar "1 canal" enquanto
// o servidor aceita 3 (ou o contrario) e o tipo de divergencia que faz o
// cliente achar que pagou por algo que nao recebeu.
function limitesDe(subscription) {
  if (!subscription || !subscription.plan_id) return { canais: 0, contas: 0, extras: 0, semPlano: true };

  const extraCanais = Number(subscription.extra_channels) || 0;
  const extraContas = Number(subscription.extra_tiktok_accounts) || 0;
  const canaisDoPlano = subscription.max_youtube_channels;
  const contasDoPlano = subscription.max_tiktok_accounts;

  return {
    semPlano: false,
    extraCanais,
    extraContas,
    // Plano "sem limite" continua sem limite mesmo com extras comprados -
    // somar a null daria NaN e o limite viraria uma comparacao sempre falsa,
    // que na pratica libera tudo por acidente em vez de por decisao.
    canais: canaisDoPlano === null ? null : Number(canaisDoPlano) + extraCanais,
    contas: contasDoPlano === null ? null : Number(contasDoPlano) + extraContas,
  };
}

// Pode comprar conexao extra? So nos planos que trazem preco.
//
// Continua sendo so o plano maior, como antes desta mudanca: quem esta no
// Starter ou no Pro sobe de plano, que sai mais barato pra ele do que comprar
// avulso. Liberar extras em todos os planos seria outra decisao de negocio, e
// nao foi o que foi pedido - o pedido foi separar canal de conta.
function podeComprarExtras(subscription) {
  return Boolean(subscription && subscription.plan_id && subscription.extra_channel_price_cents);
}

function comoConseguirMais(subscription) {
  return podeComprarExtras(subscription)
    ? 'Compre uma conexão extra em "Plano e uso" ou troque de plano.'
    : 'Troque de plano pra adicionar mais.';
}

async function checkChannelLimit(clientUserId, currentCount) {
  const subscription = await clientSubscriptionsRepository.getOrCreate(clientUserId);
  const limites = limitesDe(subscription);
  if (limites.semPlano) return { allowed: false, reason: NO_PLAN_MESSAGE };
  if (limites.canais === null) return { allowed: true };
  if (currentCount >= limites.canais) {
    return {
      allowed: false,
      reason: `Seu plano acompanha ${plural(limites.canais, 'canal', 'canais')} do YouTube. ${comoConseguirMais(subscription)}`,
    };
  }
  return { allowed: true };
}

async function checkTiktokAccountLimit(clientUserId, currentCount) {
  const subscription = await clientSubscriptionsRepository.getOrCreate(clientUserId);
  const limites = limitesDe(subscription);
  if (limites.semPlano) return { allowed: false, reason: NO_PLAN_MESSAGE };
  if (limites.contas === null) return { allowed: true };
  if (currentCount >= limites.contas) {
    return {
      allowed: false,
      reason: `Seu plano publica em ${plural(limites.contas, 'conta', 'contas')} do TikTok. ${comoConseguirMais(subscription)}`,
    };
  }
  return { allowed: true };
}

module.exports = { checkChannelLimit, checkTiktokAccountLimit, limitesDe, podeComprarExtras };
