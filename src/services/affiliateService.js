'use strict';

// Orquestrador do programa de afiliados - mesmo papel que creditsService.js
// tem pro sistema de credito. Duas responsabilidades: capturar de onde um
// usuario novo veio (captureAttribution, chamado no cadastro) e calcular
// comissao quando a Stripe confirma um pagamento de mensalidade
// (recordCommissionForInvoice, chamado do webhook).
const pool = require('../db/pool');
const affiliateLinksRepository = require('../repositories/affiliateLinksRepository');
const affiliatesRepository = require('../repositories/affiliatesRepository');
const referralsRepository = require('../repositories/referralsRepository');
const commissionEntriesRepository = require('../repositories/commissionEntriesRepository');
const clientSubscriptionsRepository = require('../repositories/clientSubscriptionsRepository');
const settingsRepository = require('../repositories/settingsRepository');
const usersRepository = require('../repositories/usersRepository');
const logger = require('../lib/logger');

const SETTINGS_KEYS = {
  percentDefault: 'affiliate_commission_percent_default',
  minWithdrawCents: 'affiliate_min_withdraw_cents',
  maxMonths: 'affiliate_commission_max_months',
};

const DEFAULTS = {
  percentDefault: 10,
  minWithdrawCents: 10000,
  maxMonths: 6,
};

async function getSettings() {
  const [percentDefault, minWithdrawCents, maxMonths] = await Promise.all([
    settingsRepository.getValue(SETTINGS_KEYS.percentDefault, DEFAULTS.percentDefault),
    settingsRepository.getValue(SETTINGS_KEYS.minWithdrawCents, DEFAULTS.minWithdrawCents),
    settingsRepository.getValue(SETTINGS_KEYS.maxMonths, DEFAULTS.maxMonths),
  ]);
  return { percentDefault, minWithdrawCents, maxMonths };
}

async function setSettings({ percentDefault, minWithdrawCents, maxMonths }) {
  if (percentDefault !== undefined) await settingsRepository.setValue(SETTINGS_KEYS.percentDefault, percentDefault);
  if (minWithdrawCents !== undefined) await settingsRepository.setValue(SETTINGS_KEYS.minWithdrawCents, minWithdrawCents);
  if (maxMonths !== undefined) await settingsRepository.setValue(SETTINGS_KEYS.maxMonths, maxMonths);
  return getSettings();
}

// Chamado logo depois de criar um usuario novo (cadastro normal ou primeira
// vez pelo Google) - NUNCA em login de conta ja existente. `refCode`/`utm`
// vem da sessao (ver middleware/affiliateAttribution.js), que sobrevive ao
// roundtrip OAuth do Google porque o cookie de sessao e sameSite=lax.
async function captureAttribution({ referredUserId, refCode, utm, landingPath }) {
  let affiliateLinkId = null;
  let referrerUserId = null;

  if (refCode) {
    const link = await affiliateLinksRepository.findByCode(refCode);
    // Guarda contra autoindicação: nunca deveria acontecer (o codigo só é
    // gerado depois que a conta existe), mas é barato conferir.
    if (link && link.owner_user_id !== referredUserId) {
      affiliateLinkId = link.id;
      referrerUserId = link.owner_user_id;
    }
  }

  // Sem link nenhum mas com UTM: ainda vale registrar a origem (pedido
  // explicito de ver UTM de qualquer usuario, nao so indicado).
  if (!affiliateLinkId && !referrerUserId && !(utm && (utm.source || utm.medium || utm.campaign))) {
    return null;
  }

  return referralsRepository.create({ referredUserId, affiliateLinkId, referrerUserId, utm, landingPath });
}

// Calcula e credita a comissao de uma fatura paga (webhook invoice.paid da
// Stripe). So processa fatura de MENSALIDADE (invoice.subscription presente)
// - excedente/credito avulso nao geram comissao (decisao do usuario). Sai
// silenciosamente (sem lancar erro) em qualquer caso onde nao ha o que
// creditar, pra nunca derrubar o processamento do webhook.
// Adaptador da Stripe: traduz o formato de fatura dela e delega. A regra de
// comissao em si nao conhece provedor nenhum - ver recordCommissionForPayment.
async function recordCommissionForInvoice(invoice) {
  if (!invoice || !invoice.subscription) return { skipped: 'naoEhMensalidade' };

  const subscription = await clientSubscriptionsRepository.findByStripeCustomerId(invoice.customer);
  if (!subscription) return { skipped: 'clienteNaoEncontrado' };

  return recordCommissionForPayment({
    clientUserId: subscription.client_user_id,
    provider: 'stripe',
    externalPaymentId: invoice.id,
    amountPaidCents: Number(invoice.amount_paid || 0),
  });
}

// A regra de comissao, sem saber de qual provedor veio o dinheiro. Recebe
// quem pagou, quanto, e um id que identifica o pagamento de forma unica -
// e esse id que garante que reenvio de aviso nao paga comissao duas vezes.
async function recordCommissionForPayment({ clientUserId, provider, externalPaymentId, amountPaidCents }) {
  if (!clientUserId || !externalPaymentId) return { skipped: 'dadosInsuficientes' };

  const referredUserId = clientUserId;
  const referral = await referralsRepository.findByReferredUserId(referredUserId);
  if (!referral || !referral.referrer_user_id) return { skipped: 'semIndicacao' };

  const affiliateUserId = referral.referrer_user_id;
  // O admin e isento de ganhar comissao sobre os proprios links de campanha
  // (mesmo espirito do isento() do sistema de credito) - eles servem so pra
  // rastrear origem, nao pra pagar o admin a si mesmo.
  const ownerUser = await usersRepository.findById(affiliateUserId);
  if (!ownerUser || ownerUser.role === 'admin') return { skipped: 'donoDoLinkEhAdmin' };

  const { maxMonths, percentDefault } = await getSettings();
  if (maxMonths && maxMonths > 0) {
    const already = await commissionEntriesRepository.countByReferredUser(referredUserId);
    if (already >= maxMonths) return { skipped: 'tetoDeMesesAtingido' };
  }

  const affiliate = await affiliatesRepository.getOrCreate(affiliateUserId);
  const percent = affiliate.commission_percent_override !== null && affiliate.commission_percent_override !== undefined
    ? Number(affiliate.commission_percent_override)
    : Number(percentDefault);

  const commissionCents = Math.round((Number(amountPaidCents) * percent) / 100);
  if (commissionCents <= 0) return { skipped: 'valorZerado' };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const entry = await commissionEntriesRepository.insertIfNotExists(client, {
      affiliateUserId,
      referredUserId,
      externalPaymentId,
      provider,
      amountPaidCents: Number(amountPaidCents),
      commissionPercent: percent,
      commissionCents,
    });
    if (!entry) {
      // Pagamento ja processado antes (reenvio de aviso) - nada a fazer.
      await client.query('ROLLBACK');
      return { skipped: 'jaProcessada' };
    }
    await affiliatesRepository.credit(client, affiliateUserId, commissionCents);
    await client.query('COMMIT');
    logger.info(
      `Comissao de ${commissionCents} centavos creditada ao afiliado ${affiliateUserId} (${provider} ${externalPaymentId}).`
    );
    return { credited: commissionCents, affiliateUserId };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  getSettings,
  setSettings,
  captureAttribution,
  recordCommissionForInvoice,
  recordCommissionForPayment,
};
