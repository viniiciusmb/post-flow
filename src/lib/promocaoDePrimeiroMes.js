// Quem tem direito ao preço promocional de estreia.
//
// A regra, definida pelo fundador em 01/09/2026: é um desconto de ESTREIA.
// Vale para usuário NOVO — que nunca assinou nem teve plano nenhum — e só na
// primeira mensalidade. Assinou com o desconto, o desconto some.
//
// São DUAS travas, e cada uma fecha uma porta diferente:
//
//   first_plan_at       já teve um plano alguma vez, por qualquer caminho
//                       (atribuído pelo admin, herdado, comprado). Foi esta
//                       que faltava: a conta de teste do fundador tinha plano
//                       ativo atribuído na mão, nunca tinha PAGO nada, e por
//                       isso continuava vendo "R$59,90 no 1º mês".
//   first_month_used_at já pagou uma primeira mensalidade promocional. Impede
//                       cancelar e reassinar virar desconto infinito.
//
// Nenhuma das duas volta a NULL depois de escrita — é o que torna a regra
// impossível de burlar mudando de plano ou de status.
'use strict';

function promocaoDisponivel(subscription) {
  if (!subscription) return false;
  return !subscription.first_plan_at && !subscription.first_month_used_at;
}

// O preço promocional só existe se o plano tiver um, e ele tem que ser MENOR
// que o cheio. Um plano com `first_month_price_cents` igual ou maior não é
// promoção nenhuma, e anunciar "1º mês por R$99,90 · depois R$99,90" faria a
// tela parecer quebrada.
function temPrecoPromocional(plan) {
  return Boolean(plan && plan.first_month_price_cents && plan.first_month_price_cents < plan.price_cents);
}

// A pergunta que as telas e o checkout fazem de verdade: este cliente paga o
// promocional NESTE plano?
function aplicaPromocao(plan, subscription) {
  return temPrecoPromocional(plan) && promocaoDisponivel(subscription);
}

module.exports = { promocaoDisponivel, temPrecoPromocional, aplicaPromocao };
