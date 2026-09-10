'use strict';

// Monta o painel do afiliado. Fica separado do controller porque são muitas
// consultas e uma conta (o MRR previsto) que precisa ser testada sozinha, sem
// subir servidor HTTP.
const affiliateLinksRepository = require('../repositories/affiliateLinksRepository');
const affiliateLinkClicksRepository = require('../repositories/affiliateLinkClicksRepository');
const affiliatesRepository = require('../repositories/affiliatesRepository');
const referralsRepository = require('../repositories/referralsRepository');
const commissionEntriesRepository = require('../repositories/commissionEntriesRepository');
const affiliateWithdrawalsRepository = require('../repositories/affiliateWithdrawalsRepository');
const affiliateService = require('./affiliateService');
const { CONTACT } = require('../config/constants');

function urlDoLink(code) {
  // Montado no servidor, nunca no navegador: o endereço do site é
  // configuração, não o domínio de onde a tela por acaso foi aberta.
  return `${CONTACT.siteUrl}/?ref=${code}`;
}

// Quanto o afiliado deve receber por mês se ninguém cancelar: a soma das
// mensalidades ativas dos indicados dele, aplicada no percentual de
// RECORRÊNCIA (não no da primeira venda - a primeira já aconteceu).
//
// É previsão, não promessa: o teto de meses de comissão pode encerrar a
// recorrência de um indicado antes, e cancelamento derruba o número no mês
// seguinte. Por isso a tela chama de "previsto".
function mrrPrevistoCents(mrrBrutoCents, percentRecorrencia) {
  return Math.round((Number(mrrBrutoCents || 0) * Number(percentRecorrencia || 0)) / 100);
}

async function montar({ userId, since, until, rangeKey }) {
  // O link padrão precisa existir antes de tudo: é ele que garante que a tela
  // nunca abre sem nenhum link para copiar.
  await affiliateLinksRepository.getOrCreateDefault(userId);

  const [
    links,
    affiliate,
    settings,
    cliquesPeriodo,
    cliquesTotal,
    cliquesPorDia,
    referralCount,
    periodReferralCount,
    assinaturas,
    resumoComissao,
    extrato,
    indicacoes,
    saques,
  ] = await Promise.all([
    affiliateLinksRepository.listByOwnerWithStats(userId, { from: since, to: until }),
    affiliatesRepository.getOrCreate(userId),
    affiliateService.getSettings(),
    affiliateLinkClicksRepository.summaryByOwner(userId, { from: since, to: until }),
    affiliateLinkClicksRepository.summaryByOwner(userId, {}),
    affiliateLinkClicksRepository.dailyByOwner(userId, { from: since, to: until }),
    referralsRepository.countByReferrer(userId, {}),
    referralsRepository.countByReferrer(userId, { from: since, to: until }),
    referralsRepository.subscriptionStatsByReferrer(userId),
    commissionEntriesRepository.summaryByAffiliate(userId, { from: since, to: until }),
    commissionEntriesRepository.listRecentByAffiliate(userId, { from: since, to: until, limit: 30 }),
    referralsRepository.listRecentByReferrer(userId, 20),
    affiliateWithdrawalsRepository.listByAffiliate(userId, 10),
  ]);

  const percentPrimeira = affiliateService.percentualPara(affiliate, settings, 'primeira');
  const percentRecorrencia = affiliateService.percentualPara(affiliate, settings, 'recorrencia');
  const padrao = links.find((l) => l.is_default) || links[0];

  return {
    range: { key: rangeKey, since, until },
    // Mantido como estava para quem só quer "o link": é o padrão, o que todo
    // afiliado tem desde sempre.
    link: { code: padrao.code, url: urlDoLink(padrao.code) },
    links: links.map((l) => ({
      id: Number(l.id),
      code: l.code,
      url: urlDoLink(l.code),
      label: l.label,
      isDefault: l.is_default,
      archivedAt: l.archived_at,
      clicksTotal: l.clicks_total,
      clicksPeriod: l.clicks_period,
      visitorsPeriod: l.visitors_period,
      referralCount: l.referral_count,
      activeCount: l.active_count,
      commissionCents: l.commission_cents,
      createdAt: l.created_at,
    })),
    balance: {
      availableCents: affiliate.balance_available_cents,
      reservedCents: affiliate.balance_reserved_cents,
      totalEarnedCents: affiliate.total_earned_cents,
    },
    percent: { first: percentPrimeira, recurring: percentRecorrencia },
    clicks: {
      period: cliquesPeriodo.clicks,
      visitorsPeriod: cliquesPeriodo.visitors,
      total: cliquesTotal.clicks,
      byDay: cliquesPorDia,
    },
    referralCount,
    periodReferralCount,
    subscriptions: {
      active: assinaturas.ativos,
      canceled: assinaturas.cancelados,
      overdue: assinaturas.inadimplentes,
      withoutPlan: assinaturas.sem_plano,
      mrrBaseCents: assinaturas.mrr_bruto_cents,
      mrrCents: mrrPrevistoCents(assinaturas.mrr_bruto_cents, percentRecorrencia),
    },
    // Os dois cartões que não podem virar um só: venda nova é evento, e
    // recorrência é o que já estava rodando. Somados, escondem exatamente a
    // informação que faz o afiliado decidir se vale continuar divulgando.
    sales: {
      count: resumoComissao.primeira.n,
      commissionCents: resumoComissao.primeira.commissionCents,
      paidCents: resumoComissao.primeira.paidCents,
    },
    recurring: {
      count: resumoComissao.recorrencia.n,
      commissionCents: resumoComissao.recorrencia.commissionCents,
      paidCents: resumoComissao.recorrencia.paidCents,
    },
    periodTotalCents: resumoComissao.primeira.commissionCents + resumoComissao.recorrencia.commissionCents,
    // Compatibilidade com o formato antigo da tela.
    activeSubscriptionCount: assinaturas.ativos,
    minWithdrawCents: settings.minWithdrawCents,
    pix: { key: affiliate.pix_key, type: affiliate.pix_key_type },
    recentCommissions: extrato.map((e) => ({
      id: Number(e.id),
      referredEmail: e.referred_email,
      referredBusinessName: e.referred_business_name,
      amountPaidCents: e.amount_paid_cents,
      commissionPercent: Number(e.commission_percent),
      commissionCents: e.commission_cents,
      kind: e.kind,
      // O lançamento estornado continua no extrato, marcado. Sumir deixaria um
      // buraco inexplicável ("recebi isso mês passado e agora não existe").
      reversedAt: e.reversed_at,
      createdAt: e.created_at,
    })),
    recentReferrals: indicacoes.map((r) => ({
      id: Number(r.id),
      email: r.email,
      businessName: r.business_name,
      subscriptionStatus: r.subscription_status,
      planName: r.plan_name,
      linkLabel: r.link_is_default ? null : r.link_label,
      linkCode: r.link_code,
      createdAt: r.created_at,
    })),
    recentWithdrawals: saques.map((w) => ({
      id: Number(w.id),
      amountCents: w.amount_cents,
      status: w.status,
      requestedAt: w.requested_at,
      resolvedAt: w.resolved_at,
    })),
  };
}

module.exports = { montar, mrrPrevistoCents, urlDoLink };
