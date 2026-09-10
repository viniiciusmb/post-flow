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
  recurringPercentDefault: 'affiliate_commission_recurring_percent_default',
  minWithdrawCents: 'affiliate_min_withdraw_cents',
  maxMonths: 'affiliate_commission_max_months',
};

// Primeiro argumento do advisory lock: um número qualquer, fixo, que separa
// este uso de qualquer outro lock por id que venha a existir no projeto.
const LOCK_COMISSAO = 79001;

const DEFAULTS = {
  percentDefault: 10,
  minWithdrawCents: 10000,
  maxMonths: 6,
};

// São DOIS percentuais desde a migration 079: o da primeira venda (a
// assinatura nova) e o da recorrência (as mensalidades seguintes do mesmo
// indicado). O da recorrência nasce valendo o mesmo que o outro - foi assim
// que a migration o criou -, então ligar a separação não mudou o quanto
// ninguém recebe até o admin decidir mexer.
async function getSettings() {
  const [percentDefault, minWithdrawCents, maxMonths] = await Promise.all([
    settingsRepository.getValue(SETTINGS_KEYS.percentDefault, DEFAULTS.percentDefault),
    settingsRepository.getValue(SETTINGS_KEYS.minWithdrawCents, DEFAULTS.minWithdrawCents),
    settingsRepository.getValue(SETTINGS_KEYS.maxMonths, DEFAULTS.maxMonths),
  ]);
  // O fallback da recorrência é o percentual da primeira venda, e não a
  // constante 10: numa base onde o admin já tinha configurado 15% e a linha da
  // recorrência ainda não existe, cair na constante daria um corte silencioso
  // no que o afiliado recebe.
  const recurringPercentDefault = await settingsRepository.getValue(
    SETTINGS_KEYS.recurringPercentDefault,
    percentDefault
  );
  return { percentDefault, recurringPercentDefault, minWithdrawCents, maxMonths };
}

async function setSettings({ percentDefault, recurringPercentDefault, minWithdrawCents, maxMonths }) {
  if (percentDefault !== undefined) await settingsRepository.setValue(SETTINGS_KEYS.percentDefault, percentDefault);
  if (recurringPercentDefault !== undefined) {
    await settingsRepository.setValue(SETTINGS_KEYS.recurringPercentDefault, recurringPercentDefault);
  }
  if (minWithdrawCents !== undefined) await settingsRepository.setValue(SETTINGS_KEYS.minWithdrawCents, minWithdrawCents);
  if (maxMonths !== undefined) await settingsRepository.setValue(SETTINGS_KEYS.maxMonths, maxMonths);
  return getSettings();
}

// O percentual que vale para um afiliado, por tipo de pagamento. Override
// individual manda; sem ele, o padrão global daquele tipo.
//
// Os dois são independentes de propósito: um afiliado com 20% de override na
// primeira venda e nada na recorrência continua na recorrência PADRÃO. A tela
// do admin mostra o padrão como texto de fundo no campo vazio, senão essa
// combinação pareceria "20% em tudo".
function percentualPara(affiliate, settings, kind) {
  if (kind === 'primeira') {
    const override = affiliate && affiliate.commission_percent_override;
    return override !== null && override !== undefined ? Number(override) : Number(settings.percentDefault);
  }
  const override = affiliate && affiliate.commission_recurring_percent_override;
  return override !== null && override !== undefined
    ? Number(override)
    : Number(settings.recurringPercentDefault);
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

  const settings = await getSettings();
  const affiliate = await affiliatesRepository.getOrCreate(affiliateUserId);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Serializa por INDICADO: sem isto, dois pagamentos do mesmo cliente
    // chegando junto contariam os dois "nenhuma comissão ainda" e nasceriam
    // duas primeiras vendas, cada uma com o percentual de entrada. O lock é da
    // transação e cai sozinho no COMMIT/ROLLBACK.
    await client.query('SELECT pg_advisory_xact_lock($1, $2)', [LOCK_COMISSAO, Number(referredUserId)]);

    const already = await commissionEntriesRepository.countByReferredUserInTx(client, referredUserId);
    if (settings.maxMonths && settings.maxMonths > 0 && already >= settings.maxMonths) {
      await client.query('ROLLBACK');
      return { skipped: 'tetoDeMesesAtingido' };
    }

    const kind = already === 0 ? 'primeira' : 'recorrencia';
    const percent = percentualPara(affiliate, settings, kind);
    const commissionCents = Math.round((Number(amountPaidCents) * percent) / 100);
    if (commissionCents <= 0) {
      await client.query('ROLLBACK');
      return { skipped: 'valorZerado' };
    }

    const entry = await commissionEntriesRepository.insertIfNotExists(client, {
      affiliateUserId,
      referredUserId,
      externalPaymentId,
      provider,
      amountPaidCents: Number(amountPaidCents),
      commissionPercent: percent,
      commissionCents,
      kind,
    });
    if (!entry) {
      // Pagamento ja processado antes (reenvio de aviso) - nada a fazer.
      await client.query('ROLLBACK');
      return { skipped: 'jaProcessada' };
    }
    await affiliatesRepository.credit(client, affiliateUserId, commissionCents);
    await client.query('COMMIT');
    logger.info(
      `Comissao ${kind} de ${commissionCents} centavos (${percent}%) creditada ao afiliado ${affiliateUserId} (${provider} ${externalPaymentId}).`
    );
    return { credited: commissionCents, affiliateUserId, kind, percent };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Pagamento estornado, contestado no cartão, ou cobrança apagada: a comissão
// que ele gerou é desfeita.
//
// Sem isto o prejuízo era DOBRADO no mesmo evento - o dinheiro voltava para o
// cliente e a comissão continuava creditada e sacável. Era o buraco mais caro
// do programa de afiliados, e o único que ninguém percebe olhando a tela: os
// números continuam plausíveis.
//
// Idempotente: o UPDATE só pega a entrada que ainda não está marcada, então
// reenvio de aviso (que é o normal nos dois provedores) não debita duas vezes.
async function reverseCommissionForPayment({ externalPaymentId, motivo }) {
  if (!externalPaymentId) return { skipped: 'semPagamento' };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const entry = await commissionEntriesRepository.markReversed(client, externalPaymentId, motivo);
    if (!entry) {
      await client.query('ROLLBACK');
      // Nenhuma comissão para aquele pagamento, ou já estornada antes. Não é
      // erro: a maioria dos pagamentos não tem afiliado por trás.
      return { skipped: 'semComissaoAtiva' };
    }
    await affiliatesRepository.debit(client, entry.affiliate_user_id, entry.commission_cents);
    await client.query('COMMIT');
    logger.warn(
      `Comissao de ${entry.commission_cents} centavos do afiliado ${entry.affiliate_user_id} ESTORNADA (${externalPaymentId}: ${motivo}).`
    );
    return { reversed: entry.commission_cents, affiliateUserId: Number(entry.affiliate_user_id) };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// O caminho de volta: a contestação foi ganha, ou o estorno foi negado - o
// dinheiro ficou com a gente afinal, então a comissão volta a valer.
async function restoreCommissionForPayment({ externalPaymentId }) {
  if (!externalPaymentId) return { skipped: 'semPagamento' };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const entry = await commissionEntriesRepository.markRestored(client, externalPaymentId);
    if (!entry) {
      await client.query('ROLLBACK');
      return { skipped: 'nadaParaRestaurar' };
    }
    await affiliatesRepository.credit(client, entry.affiliate_user_id, entry.commission_cents);
    await client.query('COMMIT');
    logger.info(
      `Comissao de ${entry.commission_cents} centavos do afiliado ${entry.affiliate_user_id} restaurada (${externalPaymentId}).`
    );
    return { restored: entry.commission_cents, affiliateUserId: Number(entry.affiliate_user_id) };
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
  percentualPara,
  captureAttribution,
  recordCommissionForInvoice,
  recordCommissionForPayment,
  reverseCommissionForPayment,
  restoreCommissionForPayment,
};
