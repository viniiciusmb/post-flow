'use strict';

// Controle do admin sobre o programa de afiliados: totais globais, tabela de
// todo afiliado (com % individual editável), saques pendentes de aprovação,
// configurações globais (%, saque mínimo, teto de meses) e links de
// divulgação próprios do admin (bio do Instagram, TikTok, curso etc).
const affiliatesRepository = require('../../../repositories/affiliatesRepository');
const affiliateLinksRepository = require('../../../repositories/affiliateLinksRepository');
const affiliateWithdrawalsRepository = require('../../../repositories/affiliateWithdrawalsRepository');
const commissionEntriesRepository = require('../../../repositories/commissionEntriesRepository');
const referralsRepository = require('../../../repositories/referralsRepository');
const affiliateService = require('../../../services/affiliateService');
const { resolveRange } = require('../../../lib/dateRanges');

const CODE_PATTERN = /^[a-zA-Z0-9_-]{3,32}$/;

async function overview(req, res) {
  const { range, since, until } = resolveRange(req.query.range);

  const [periodSummary, lifetimeSummary, affiliates] = await Promise.all([
    commissionEntriesRepository.sumTotal({ from: since, to: until }),
    commissionEntriesRepository.sumTotal({}),
    affiliatesRepository.listAllWithStats({}),
  ]);

  const totalReferrals = affiliates.reduce((sum, a) => sum + a.referral_count, 0);
  const totalActiveSubscriptions = affiliates.reduce((sum, a) => sum + a.active_subscription_count, 0);
  const totalPendingReserved = affiliates.reduce((sum, a) => sum + Number(a.balance_reserved_cents), 0);

  res.json({
    range: { key: range, since, until },
    periodCommissionCents: periodSummary.total_cents,
    periodCommissionCount: periodSummary.n,
    lifetimeCommissionCents: lifetimeSummary.total_cents,
    affiliateCount: affiliates.length,
    totalReferrals,
    totalActiveSubscriptions,
    totalPendingWithdrawalCents: totalPendingReserved,
  });
}

async function listAffiliates(req, res) {
  const affiliates = await affiliatesRepository.listAllWithStats({});
  res.json({
    affiliates: affiliates.map((a) => ({
      userId: a.user_id,
      email: a.email,
      businessName: a.business_name,
      commissionPercentOverride: a.commission_percent_override !== null ? Number(a.commission_percent_override) : null,
      referralCount: a.referral_count,
      activeSubscriptionCount: a.active_subscription_count,
      totalEarnedCents: a.total_earned_cents,
      balanceAvailableCents: a.balance_available_cents,
      balanceReservedCents: a.balance_reserved_cents,
    })),
  });
}

async function setAffiliatePercent(req, res) {
  const userId = Number(req.params.userId);
  const { percent } = req.body;

  if (percent !== null && (typeof percent !== 'number' || Number.isNaN(percent) || percent < 0 || percent > 100)) {
    return res.status(400).json({ error: res.locals.t('erros.percentualInvalido') });
  }

  const affiliate = await affiliatesRepository.setPercentOverride(userId, percent);
  res.json({
    userId,
    commissionPercentOverride: affiliate.commission_percent_override !== null ? Number(affiliate.commission_percent_override) : null,
  });
}

async function getSettings(req, res) {
  const settings = await affiliateService.getSettings();
  res.json(settings);
}

async function putSettings(req, res) {
  const { percentDefault, minWithdrawCents, maxMonths } = req.body;

  if (percentDefault !== undefined && (typeof percentDefault !== 'number' || percentDefault < 0 || percentDefault > 100)) {
    return res.status(400).json({ error: res.locals.t('erros.percentualInvalido') });
  }
  if (minWithdrawCents !== undefined && (typeof minWithdrawCents !== 'number' || minWithdrawCents < 0)) {
    return res.status(400).json({ error: res.locals.t('erros.valorInvalido') });
  }
  if (maxMonths !== undefined && (typeof maxMonths !== 'number' || maxMonths < 0)) {
    return res.status(400).json({ error: res.locals.t('erros.valorInvalido') });
  }

  const settings = await affiliateService.setSettings({ percentDefault, minWithdrawCents, maxMonths });
  res.json(settings);
}

async function listWithdrawals(req, res) {
  const status = ['pendente', 'pago', 'recusado'].includes(req.query.status) ? req.query.status : null;
  const withdrawals = await affiliateWithdrawalsRepository.listByStatus(status);
  res.json({
    withdrawals: withdrawals.map((w) => ({
      id: w.id,
      affiliateUserId: w.affiliate_user_id,
      email: w.email,
      businessName: w.business_name,
      amountCents: w.amount_cents,
      pixKey: w.pix_key,
      pixKeyType: w.pix_key_type,
      status: w.status,
      adminNote: w.admin_note,
      requestedAt: w.requested_at,
      resolvedAt: w.resolved_at,
    })),
  });
}

async function approveWithdrawal(req, res) {
  const id = Number(req.params.id);
  const withdrawal = await affiliateWithdrawalsRepository.findById(id);
  if (!withdrawal || withdrawal.status !== 'pendente') {
    return res.status(400).json({ error: res.locals.t('erros.saqueNaoPendente') });
  }

  await affiliatesRepository.confirmWithdrawn(withdrawal.affiliate_user_id, withdrawal.amount_cents);
  const resolved = await affiliateWithdrawalsRepository.resolve(id, {
    status: 'pago',
    adminId: req.session.user.id,
    note: req.body.note,
  });
  res.json({ withdrawal: { id: resolved.id, status: resolved.status } });
}

async function rejectWithdrawal(req, res) {
  const id = Number(req.params.id);
  const withdrawal = await affiliateWithdrawalsRepository.findById(id);
  if (!withdrawal || withdrawal.status !== 'pendente') {
    return res.status(400).json({ error: res.locals.t('erros.saqueNaoPendente') });
  }

  await affiliatesRepository.releaseReserved(withdrawal.affiliate_user_id, withdrawal.amount_cents);
  const resolved = await affiliateWithdrawalsRepository.resolve(id, {
    status: 'recusado',
    adminId: req.session.user.id,
    note: req.body.note,
  });
  res.json({ withdrawal: { id: resolved.id, status: resolved.status } });
}

async function listLinks(req, res) {
  const adminId = req.session.user.id;
  const links = await affiliateLinksRepository.listCustomWithStats(adminId);
  res.json({
    links: links.map((l) => ({
      id: l.id,
      code: l.code,
      label: l.label,
      referralCount: l.referral_count,
      activeCount: l.active_count,
      createdAt: l.created_at,
    })),
  });
}

async function createLink(req, res) {
  const adminId = req.session.user.id;
  const { code, label } = req.body;

  if (typeof code !== 'string' || !CODE_PATTERN.test(code)) {
    return res.status(400).json({ error: res.locals.t('erros.codigoDeLinkInvalido') });
  }

  const existing = await affiliateLinksRepository.findByCode(code);
  if (existing) {
    return res.status(400).json({ error: res.locals.t('erros.codigoDeLinkJaExiste') });
  }

  const link = await affiliateLinksRepository.createCustom(adminId, {
    code,
    label: typeof label === 'string' ? label.trim().slice(0, 100) : null,
  });
  res.json({ link: { id: link.id, code: link.code, label: link.label } });
}

module.exports = {
  overview,
  listAffiliates,
  setAffiliatePercent,
  getSettings,
  putSettings,
  listWithdrawals,
  approveWithdrawal,
  rejectWithdrawal,
  listLinks,
  createLink,
};
