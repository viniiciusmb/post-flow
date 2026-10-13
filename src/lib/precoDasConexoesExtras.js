// Quanto custa comprar conexões extras.
//
// Até 01/09/2026 "conexão extra" era um pacote fechado: 1 canal do YouTube + 1
// conta do TikTok, indivisível. Quem queria só mais um canal pagava pelos dois.
// Viraram dois produtos, com desconto para quem levava o par (01/09/2026:
// canal R$ 14,90, conta R$ 29,90, os dois R$ 39,90). Preços de hoje, desde
// 12/10/2026: canal R$ 14,90, conta R$ 9,90, sem par - ver abaixo.
//
// O desconto do par vale POR PAR, não uma vez só: quem leva 2 canais e 2 contas
// paga dois combos. Cobrar o combo uma vez e o resto cheio seria uma conta que
// ninguém consegue conferir de cabeça, e a primeira reclamação seria sobre o
// preço estar "errado" numa tela de pagamento — o pior lugar para isso.
//
// Desde 12/10/2026 também existe a conta extra nas REDES SOCIAIS (Instagram,
// Facebook, Threads, LinkedIn, Pinterest, Bluesky): R$ 9,90 por conta por mês,
// a rede escolhida na compra, em TODOS os planos. Sem desconto de combo - é um
// preço por conta.
//
// Ajuste do mesmo dia (migration 116): a conta do TikTok passou a R$ 9,90 e o
// canal do YouTube ficou em R$ 14,90, os dois em todos os planos, e o combo
// acabou (extra_both_price_cents NULL). Com `ambos` vazio, canal e conta são
// cobrados cada um pelo seu preço - o código do par continua aqui para o caso
// de um combo voltar a existir.
//
// O YouTube (Shorts) NÃO vende conta extra: a publicação nele passa por uma cota
// diária compartilhada por todos os clientes (ver socialPostingService), e mais
// contas só disputariam a mesma vaga.
'use strict';

const redesSociais = require('./redesSociais');

const REDES_SEM_CONTA_EXTRA = ['youtube'];
const REDES_COM_CONTA_EXTRA = redesSociais.LISTA.filter((r) => !REDES_SEM_CONTA_EXTRA.includes(r));

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

  // Sem preço de par, não há par: cada um sai pelo seu preço.
  const combos = precos.ambos ? Math.min(c, t) : 0;
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
// Desde a migration 116 os três planos vendem canal, conta do TikTok e conta
// nas redes; um plano sem preço (null) continua significando "não vende".
// Quem chama confere o que o pedido usa.
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

module.exports = {
  precoDosExtras,
  mensalidadeDosExtras,
  precosDoPlano,
  normalizarRedes,
  totalDeRedes,
  REDES_COM_CONTA_EXTRA,
  REDES_SEM_CONTA_EXTRA,
};
