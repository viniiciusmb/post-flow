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
'use strict';

/**
 * @param {{canais:number, contas:number}} quantidade o que está sendo comprado
 * @param {{canal:number, conta:number, ambos:number}} precos em centavos
 * @returns {{totalCents:number, combos:number, canaisSozinhos:number, contasSozinhas:number}}
 */
function precoDosExtras({ canais = 0, contas = 0 }, precos) {
  const c = Math.max(0, Math.trunc(Number(canais) || 0));
  const t = Math.max(0, Math.trunc(Number(contas) || 0));

  const combos = Math.min(c, t);
  const canaisSozinhos = c - combos;
  const contasSozinhas = t - combos;

  const totalCents =
    combos * precos.ambos + canaisSozinhos * precos.canal + contasSozinhas * precos.conta;

  return { totalCents, combos, canaisSozinhos, contasSozinhas };
}

// Preço da MENSALIDADE recorrente do que o cliente tem hoje. É a mesma conta,
// e é de propósito que ela seja a mesma função: se a recorrência usasse outra
// regra, o cliente pagaria um valor na compra e outro todo mês, e descobriria
// isso na segunda fatura.
function mensalidadeDosExtras(subscription, precos) {
  return precoDosExtras(
    { canais: Number(subscription.extra_channels) || 0, contas: Number(subscription.extra_tiktok_accounts) || 0 },
    precos
  ).totalCents;
}

// Os preços do plano do cliente, no formato que as funções acima esperam.
// Devolve null quando o plano não vende conexão extra — quem chama trata isso
// como "não dá para comprar", em vez de cair num preço zero e liberar de graça.
function precosDoPlano(subscription) {
  if (!subscription || !subscription.extra_channel_price_cents) return null;
  return {
    canal: Number(subscription.extra_channel_price_cents),
    conta: Number(subscription.extra_tiktok_price_cents),
    ambos: Number(subscription.extra_both_price_cents),
  };
}

module.exports = { precoDosExtras, mensalidadeDosExtras, precosDoPlano };
