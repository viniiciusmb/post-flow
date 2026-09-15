// Os eventos que o webhook do Asaas precisa ASSINAR para o sistema funcionar.
//
// Mora num arquivo próprio (e não dentro de scripts/asaas-setup.js) para um
// teste poder comparar esta lista com os `case` do webhook. Em 15/09/2026 a
// conta de produção estava assinando só 10 eventos: todo o tratamento de
// estorno, contestação no cartão e cobrança apagada (feito em 09/09) existia
// no código e NUNCA recebia aviso nenhum, porque ninguém tinha acrescentado
// os eventos aqui. Tratar um evento que não é assinado é o mesmo que não
// tratar - e nada avisa.
'use strict';

module.exports = [
  // checkout hospedado (legado, só para os que já existiam)
  'CHECKOUT_PAID',
  'CHECKOUT_EXPIRED',
  'CHECKOUT_CANCELED',

  // dinheiro entrando
  'PAYMENT_CONFIRMED',
  'PAYMENT_RECEIVED',

  // dinheiro que não veio
  'PAYMENT_OVERDUE',
  'PAYMENT_CREDIT_CARD_CAPTURE_REFUSED',
  'PAYMENT_REPROVED_BY_RISK_ANALYSIS',

  // dinheiro devolvido ou retido
  'PAYMENT_REFUNDED',
  'PAYMENT_PARTIALLY_REFUNDED',
  'PAYMENT_CHARGEBACK_REQUESTED',
  'PAYMENT_CHARGEBACK_DISPUTE',
  'PAYMENT_AWAITING_CHARGEBACK_REVERSAL',
  'PAYMENT_DELETED',

  // caminho de volta do estorno
  'PAYMENT_REFUND_DENIED',
  'PAYMENT_RESTORED',

  // assinatura encerrada (cancelada no painel do Asaas, removida, inativada)
  'SUBSCRIPTION_INACTIVATED',
  'SUBSCRIPTION_DELETED',

  // PIX Automático
  'PIX_AUTOMATIC_RECURRING_AUTHORIZATION_ACTIVATED',
  'PIX_AUTOMATIC_RECURRING_AUTHORIZATION_REFUSED',
  'PIX_AUTOMATIC_RECURRING_AUTHORIZATION_EXPIRED',
  'PIX_AUTOMATIC_RECURRING_AUTHORIZATION_CANCELLED',
];
