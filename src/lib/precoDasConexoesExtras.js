// Quanto custa comprar conexões extras.
//
// Até 01/09/2026 "conexão extra" era um pacote fechado: 1 canal do YouTube + 1
// conta do TikTok, indivisível. Quem queria só mais um canal pagava pelos dois.
// Agora são dois produtos, com desconto para quem leva o par:
//
//   canal do YouTube ....... R$ 14,90
//   conta do TikTok ........ R$ 29,90
//   os dois juntos ......... R$ 39,90   (R$ 4,90 mais barato que separado)
//
// O desconto do par vale POR PAR, não uma vez só: quem leva 2 canais e 2 contas
// paga dois combos. Cobrar o combo uma vez e o resto cheio seria uma conta que
// ninguém consegue conferir de cabeça, e a primeira reclamação seria sobre o
// preço estar "errado" numa tela de pagamento — o pior lugar para isso.
//
// Desde 12/10/2026 também existe a conta extra nas REDES SOCIAIS (Instagram,
// Facebook, Threads, LinkedIn, Pinterest, Bluesky, YouTube): R$ 9,90 por conta
// por mês, a rede escolhida na compra, em TODOS os planos. Sem desconto de
// combo - é um preço por conta.
'use strict';

const redesSociais = require('./redesSociais');

// {instagram: 2, lixo: 5, facebook: -1} -> {instagram: 2}. Só redes que existem
// e quantidades inteiras positivas: o pedido vem do navegador.
function normalizarRedes(redes) {
  const saida = {};
  if (!redes || typeof redes !== 'object') return saida;
  for (const [rede, n] of Object.entries(redes)) {
    const q = Math.trunc(Number(n) || 0);
    if (redesSociais.LISTA.includes(rede) && q > 0) saida[rede] = q;
  }
  return saida;
}

function totalDeRedes(redes) {
  return Object.values(normalizarRedes(redes)).reduce((a, b) => a + b, 0);
}

/**
 * @param {{canais:number, contas:number}} quantidade o que está sendo comprado
 * @param {{canal:number, conta:number, ambos:number}} precos em centavos
 * @returns {{totalCents:number, combos:number, canaisSozinhos:number, contasSozinhas:number}}
 */
function precoDosExtras({ canais = 0, contas = 0, redes = {} }, precos) {
  const c = Math.max(0, Math.trunc(Number(canais) || 0));
  const t = Math.max(0, Math.trunc(Number(contas) || 0));
  const r = totalDeRedes(redes);

  const combos = Math.min(c, t);
  const canaisSozinhos = c - combos;
  const contasSozinhas = t - combos;

  const totalCents =
    (combos ? combos * precos.ambos : 0) +
    (canaisSozinhos ? canaisSozinhos * precos.canal : 0) +
    (contasSozinhas ? contasSozinhas * precos.conta : 0) +
    (r ? r * precos.rede : 0);

  return { totalCents, combos, canaisSozinhos, contasSozinhas, contasNasRedes: r };
}

// Preço da MENSALIDADE recorrente do que o cliente tem hoje. É a mesma conta,
// e é de propósito que ela seja a mesma função: se a recorrência usasse outra
// regra, o cliente pagaria um valor na compra e outro todo mês, e descobriria
// isso na segunda fatura.
function mensalidadeDosExtras(subscription, precos) {
  return precoDosExtras(
    {
      canais: Number(subscription.extra_channels) || 0,
      contas: Number(subscription.extra_tiktok_accounts) || 0,
      redes: subscription.extra_redes || {},
    },
    precos
  ).totalCents;
}

// Os preços do plano do cliente, no formato que as funções acima esperam.
// Devolve null quando o plano não vende conexão extra — quem chama trata isso
// como "não dá para comprar", em vez de cair num preço zero e liberar de graça.
//
// Canal/conta do TikTok só no plano maior (`canal` null nos outros); conta nas
// redes em todos (`rede`). Quem chama confere o que o pedido usa.
function precosDoPlano(subscription) {
  if (!subscription || !subscription.plan_id) return null;
  const n = (v) => (v === null || v === undefined ? null : Number(v));
  const precos = {
    canal: n(subscription.extra_channel_price_cents),
    conta: n(subscription.extra_tiktok_price_cents),
    ambos: n(subscription.extra_both_price_cents),
    rede: n(subscription.extra_rede_price_cents),
  };
  if (!precos.canal && !precos.rede) return null;
  return precos;
}

module.exports = { precoDosExtras, mensalidadeDosExtras, precosDoPlano, normalizarRedes, totalDeRedes };
