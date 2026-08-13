'use strict';

// Painel "Comissões" do cliente: link de afiliado, saldo, indicações,
// assinaturas ativas na base dele, extrato e pedido de saque via Pix.
const affiliateLinksRepository = require('../../../repositories/affiliateLinksRepository');
const affiliatesRepository = require('../../../repositories/affiliatesRepository');
const referralsRepository = require('../../../repositories/referralsRepository');
const commissionEntriesRepository = require('../../../repositories/commissionEntriesRepository');
const affiliateWithdrawalsRepository = require('../../../repositories/affiliateWithdrawalsRepository');
const affiliateService = require('../../../services/affiliateService');
const { CONTACT } = require('../../../config/constants');
// Mesmo filtro de periodo (hoje/ontem/7 dias/mes atual/mes passado) ja usado
// nos outros dashboards - ver DateRangeFilter.tsx no frontend.
const { resolveRange } = require('../../../lib/dateRanges');

const PIX_KEY_TYPES = ['cpf', 'cnpj', 'email', 'telefone', 'aleatoria'];

async function overview(req, res) {
  const userId = req.session.user.id;
  const { range, since, until } = resolveRange(req.query.range);

  const [
    link,
    affiliate,
    referralCount,
    periodReferralCount,
    activeCount,
    periodEntries,
    recentReferrals,
    settings,
    withdrawals,
  ] = await Promise.all([
    affiliateLinksRepository.getOrCreateDefault(userId),
    affiliatesRepository.getOrCreate(userId),
    referralsRepository.countByReferrer(userId, {}),
    referralsRepository.countByReferrer(userId, { from: since, to: until }),
    referralsRepository.countActiveSubscriptionsByReferrer(userId),
    commissionEntriesRepository.listRecentByAffiliate(userId, { from: since, to: until, limit: 30 }),
    referralsRepository.listRecentByReferrer(userId, 20),
    affiliateService.getSettings(),
    affiliateWithdrawalsRepository.listByAffiliate(userId, 10),
  ]);

  const periodTotalCents = periodEntries.reduce((sum, e) => sum + e.commission_cents, 0);

  res.json({
    range: { key: range, since, until },
    link: {
      code: link.code,
      url: `${CONTACT.siteUrl}/?ref=${link.code}`,
    },
    balance: {
      availableCents: affiliate.balance_available_cents,
      reservedCents: affiliate.balance_reserved_cents,
      totalEarnedCents: affiliate.total_earned_cents,
    },
    referralCount,
    periodReferralCount,
    activeSubscriptionCount: activeCount,
    periodTotalCents,
    minWithdrawCents: settings.minWithdrawCents,
    pix: { key: affiliate.pix_key, type: affiliate.pix_key_type },
    recentCommissions: periodEntries.map((e) => ({
      id: e.id,
      referredEmail: e.referred_email,
      referredBusinessName: e.referred_business_name,
      amountPaidCents: e.amount_paid_cents,
      commissionPercent: Number(e.commission_percent),
      commissionCents: e.commission_cents,
      createdAt: e.created_at,
    })),
    recentReferrals: recentReferrals.map((r) => ({
      id: r.id,
      email: r.email,
      businessName: r.business_name,
      subscriptionStatus: r.subscription_status,
      createdAt: r.created_at,
    })),
    recentWithdrawals: withdrawals.map((w) => ({
      id: w.id,
      amountCents: w.amount_cents,
      status: w.status,
      requestedAt: w.requested_at,
      resolvedAt: w.resolved_at,
    })),
  });
}

async function updatePixKey(req, res) {
  const userId = req.session.user.id;
  const { pixKey, pixKeyType } = req.body;

  if (!pixKey || typeof pixKey !== 'string' || pixKey.trim().length < 3) {
    return res.status(400).json({ error: res.locals.t('erros.chavePixInvalida') });
  }
  if (!PIX_KEY_TYPES.includes(pixKeyType)) {
    return res.status(400).json({ error: res.locals.t('erros.tipoChavePixInvalido') });
  }

  const affiliate = await affiliatesRepository.setPixKey(userId, { pixKey: pixKey.trim(), pixKeyType });
  res.json({ pix: { key: affiliate.pix_key, type: affiliate.pix_key_type } });
}

// Saca o saldo disponivel inteiro de uma vez (nao pede valor - o cliente so
// decide QUANDO sacar, o quanto ja esta certo no saldo). O valor nunca vem
// do corpo da requisicao, sempre lido do banco na hora.
async function requestWithdrawal(req, res) {
  const userId = req.session.user.id;
  const affiliate = await affiliatesRepository.getOrCreate(userId);

  if (!affiliate.pix_key || !affiliate.pix_key_type) {
    return res.status(400).json({ error: res.locals.t('erros.cadastrePixAntes') });
  }

  const settings = await affiliateService.getSettings();
  if (affiliate.balance_available_cents < settings.minWithdrawCents) {
    return res.status(400).json({ error: res.locals.t('erros.saldoAbaixoDoMinimo') });
  }

  const amountCents = affiliate.balance_available_cents;
  const reserved = await affiliatesRepository.reserveForWithdrawal(userId, amountCents);
  if (!reserved) {
    return res.status(400).json({ error: res.locals.t('erros.saldoInsuficiente') });
  }

  const withdrawal = await affiliateWithdrawalsRepository.create({
    affiliateUserId: userId,
    amountCents,
    pixKey: affiliate.pix_key,
    pixKeyType: affiliate.pix_key_type,
  });

  res.json({ withdrawal: { id: withdrawal.id, amountCents: withdrawal.amount_cents, status: withdrawal.status } });
}

module.exports = { overview, updatePixKey, requestWithdrawal };
