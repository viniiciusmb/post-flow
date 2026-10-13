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
const redesSociais = require('../lib/redesSociais');
const { normalizarRedes } = require('../lib/precoDasConexoesExtras');

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

// Pode comprar credito avulso? So quem tem plano ATIVO (decisao do fundador,
// 29/09/2026). Sem plano o cliente nao conecta conta do TikTok nem canal
// (limite 0), entao o minuto comprado nao tinha como virar corte publicado -
// quatro clientes pagaram por credito que nao conseguiam usar, e um deles
// pediu devolucao pelo MED do PIX. Inadimplente e cancelado tambem ficam de
// fora: o plano que da sentido ao credito nao esta valendo.
const MENSAGEM_CREDITO_SEM_PLANO =
  'Minutos avulsos são um complemento do plano. Assine um plano para poder comprar.';

function podeComprarCreditoAvulso(subscription) {
  return Boolean(subscription && subscription.plan_id && subscription.status === 'ativo');
}

function comoConseguirMais(subscription) {
  return podeComprarExtras(subscription)
    ? 'Compre uma conexão extra em "Plano e uso" ou troque de plano.'
    : 'Troque de plano pra adicionar mais.';
}

// ------------------------------------------------ redes sociais e lives
//
// Contas por rede (Instagram, Facebook, Threads, LinkedIn, Pinterest, Bluesky,
// YouTube): o número do plano vale pra CADA rede - Starter 1, Pro 3, Max 6
// (decisão do fundador, 12/10/2026). Lives: quantos canais acompanhar e
// quantas lives clipadas ao mesmo tempo.
//
// Diferente de canal/conta do TikTok, aqui assinatura CANCELADA conta como sem
// plano: são as novidades que geram custo por uso (Outstand cobra por post,
// live gasta IA), e quem cancelou não tem mais o que justifique o gasto.
// Inadimplente continua com o limite (é a carência até o pagamento).
//
// O admin não tem limite: é quem testa tudo, com quantas contas precisar.
// `extrasPorRede`: as contas extras compradas ({instagram: 1}), que somam ao
// número do plano SÓ naquela rede (R$ 9,90 cada, 12/10/2026).
function limitesDasNovidades(subscription, { admin = false } = {}) {
  if (admin) return { semPlano: false, contasPorRede: null, extrasPorRede: {}, canaisDeLive: null, livesAoMesmoTempo: null };
  if (!subscription || !subscription.plan_id || subscription.status === 'cancelado') {
    return { semPlano: true, contasPorRede: 0, extrasPorRede: {}, canaisDeLive: 0, livesAoMesmoTempo: 0 };
  }
  const n = (v) => (v === null || v === undefined ? null : Number(v));
  return {
    semPlano: false,
    contasPorRede: n(subscription.max_contas_por_rede),
    extrasPorRede: normalizarRedes(subscription.extra_redes),
    canaisDeLive: n(subscription.max_canais_de_live),
    livesAoMesmoTempo: n(subscription.max_lives_ao_mesmo_tempo),
  };
}

// O limite EFETIVO numa rede: plano + extras daquela rede. null = sem limite.
function limiteNaRede(limites, network) {
  if (limites.semPlano) return 0;
  if (limites.contasPorRede === null) return null;
  return limites.contasPorRede + ((limites.extrasPorRede || {})[network] || 0);
}

async function limitesDasNovidadesDoCliente(clientUserId, opcoes = {}) {
  const subscription = await clientSubscriptionsRepository.getOrCreate(clientUserId);
  return { ...limitesDasNovidades(subscription, opcoes), plano: subscription && subscription.plan_name ? subscription.plan_name : null };
}

const TROCAR_DE_PLANO = 'Para conectar mais, troque de plano em "Plano e uso".';

// `contasNaRede`: quantas contas ATIVAS desta rede o cliente já tem.
// `network`: a chave da rede (instagram, facebook...).
async function checkSocialAccountLimit(clientUserId, network, contasNaRede, opcoes = {}) {
  const l = await limitesDasNovidadesDoCliente(clientUserId, opcoes);
  if (l.semPlano) return { allowed: false, limite: 0, reason: NO_PLAN_MESSAGE };
  const limite = limiteNaRede(l, network);
  if (limite === null) return { allowed: true, limite: null };
  if (contasNaRede >= limite) {
    const nome = (redesSociais.info(network) || {}).nome || network;
    return {
      allowed: false,
      limite,
      reason: `Seu plano${l.plano ? ` ${l.plano}` : ''} permite ${plural(limite, 'conta', 'contas')} do ${nome}, e você já tem ${plural(contasNaRede, 'conta', 'contas')}. Compre uma conta extra por R$ 9,90/mês ou troque de plano em "Plano e uso".`,
    };
  }
  return { allowed: true, limite };
}

async function checkLiveChannelLimit(clientUserId, canaisAcompanhados, opcoes = {}) {
  const l = await limitesDasNovidadesDoCliente(clientUserId, opcoes);
  if (l.semPlano) return { allowed: false, limite: 0, reason: NO_PLAN_MESSAGE };
  if (l.canaisDeLive === null) return { allowed: true, limite: null };
  if (canaisAcompanhados >= l.canaisDeLive) {
    return {
      allowed: false,
      limite: l.canaisDeLive,
      reason: `Seu plano${l.plano ? ` ${l.plano}` : ''} acompanha ${plural(l.canaisDeLive, 'canal de live', 'canais de live')}. Remova um canal ou troque de plano em "Plano e uso".`,
    };
  }
  return { allowed: true, limite: l.canaisDeLive };
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

module.exports = {
  limiteNaRede,
  limitesDasNovidades,
  limitesDasNovidadesDoCliente,
  checkSocialAccountLimit,
  checkLiveChannelLimit,
  checkChannelLimit,
  checkTiktokAccountLimit,
  limitesDe,
  podeComprarExtras,
  podeComprarCreditoAvulso,
  MENSAGEM_CREDITO_SEM_PLANO,
};
