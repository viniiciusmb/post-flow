// Fecha a fatura de excedente do ciclo - roda de hora em hora (mesmo
// cadenciamento do reset semanal de credito). So cobra cliente com cartao de
// excedente ligado; sem isso (ou sem a Stripe configurada ainda) a cobranca
// fica acumulada como 'pendente' pro proximo ciclo, sem travar nem falhar o
// job - o admin ve o acumulado no painel de faturamento de excedente.
'use strict';

const clientSubscriptionsRepository = require('../../repositories/clientSubscriptionsRepository');
const overageChargesRepository = require('../../repositories/overageChargesRepository');
const stripeService = require('../../services/stripeService');
const logger = require('../../lib/logger');

async function run() {
  if (!stripeService.isConfigured()) return;

  const clientIds = await overageChargesRepository.listClientsWithPending();
  for (const clientUserId of clientIds) {
    const subscription = await clientSubscriptionsRepository.getOrCreate(clientUserId);
    if (!subscription.overage_card_enabled || !subscription.stripe_customer_id || !subscription.stripe_default_payment_method_id) {
      continue;
    }

    const charges = await overageChargesRepository.listPendingByClient(clientUserId);
    if (charges.length === 0) continue;

    const items = charges.map((c) => ({
      description: `Excedente (${c.bucket === 'bonus' ? 'app do cliente' : 'VPS/proxy'}) - ${c.minutes} min x R$${(c.rate_cents_per_min / 100).toFixed(2)}`,
      amountCents: c.amount_cents,
    }));

    try {
      const invoice = await stripeService.createInvoiceItemsAndPay({
        customerId: subscription.stripe_customer_id,
        paymentMethodId: subscription.stripe_default_payment_method_id,
        items,
      });
      const ids = charges.map((c) => c.id);
      await overageChargesRepository.markInvoiced(ids, invoice.id);
      await overageChargesRepository.markPaid(ids);
      logger.info(`Fatura de excedente cobrada do cliente ${clientUserId} (${charges.length} cobranca(s)).`);
    } catch (err) {
      // Fica 'pendente' de proposito (nao marca 'falhou') - tenta de novo
      // sozinho no proximo ciclo, sem perder o acumulado.
      logger.error(`Falha ao cobrar excedente do cliente ${clientUserId} - fica acumulado pro proximo ciclo:`, err);
    }
  }
}

module.exports = { run };
