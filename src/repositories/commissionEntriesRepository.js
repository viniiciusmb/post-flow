'use strict';

const pool = require('../db/pool');

// Inserida dentro da MESMA transacao que credita affiliates (ver
// affiliateService.recordCommissionForInvoice) - por isso recebe o `client`
// da transacao em vez de usar o pool direto. ON CONFLICT DO NOTHING e a
// trava de idempotencia: reenvio do mesmo webhook nunca duplica.
// external_payment_id e o id do pagamento no provedor (fatura da Stripe ou
// cobranca do Asaas). O indice unico nessa coluna e o que impede pagar a
// mesma comissao duas vezes quando o aviso e reenviado - e reenvio e
// comportamento normal nos dois provedores, nao excecao.
async function insertIfNotExists(client, {
  affiliateUserId,
  referredUserId,
  externalPaymentId,
  provider = 'stripe',
  amountPaidCents,
  commissionPercent,
  commissionCents,
  kind,
}) {
  const { rows } = await client.query(
    `INSERT INTO commission_entries
       (affiliate_user_id, referred_user_id, external_payment_id, provider,
        amount_paid_cents, commission_percent, commission_cents, kind)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (external_payment_id) DO NOTHING
     RETURNING *`,
    [affiliateUserId, referredUserId, externalPaymentId, provider, amountPaidCents, commissionPercent, commissionCents, kind]
  );
  return rows[0] || null;
}

// Este indicado já gerou alguma comissão? É o que decide se o pagamento que
// está chegando é a PRIMEIRA VENDA ou uma RECORRÊNCIA.
//
// Recebe o `client` da transação de propósito: a decisão precisa acontecer
// dentro do mesmo bloco que insere o lançamento, senão dois pagamentos do
// mesmo cliente chegando junto leriam "nenhuma comissão ainda" os dois e
// nasceriam duas "primeiras vendas".
async function countByReferredUserInTx(client, referredUserId) {
  const { rows } = await client.query(
    'SELECT count(*)::int AS n FROM commission_entries WHERE referred_user_id = $1',
    [referredUserId]
  );
  return rows[0].n;
}

// Marca a comissão de um pagamento como estornada. O UPDATE só pega quem
// ainda não está marcado, e é isso que torna a operação idempotente: o Asaas
// reenvia aviso, e reenvio não pode debitar o afiliado duas vezes.
//
// Recebe o `client` da transação porque o débito no saldo tem que acontecer
// junto - marcar sem debitar deixaria a tela mostrando um saldo que não
// existe mais.
async function markReversed(client, externalPaymentId, motivo) {
  const { rows } = await client.query(
    `UPDATE commission_entries
     SET reversed_at = now(), reversal_reason = $2
     WHERE external_payment_id = $1 AND reversed_at IS NULL
     RETURNING *`,
    [externalPaymentId, motivo || null]
  );
  return rows[0] || null;
}

// O caminho de volta: contestação que a gente ganhou, ou estorno negado. Só
// desmarca quem está marcado, pela mesma razão de idempotência.
async function markRestored(client, externalPaymentId) {
  const { rows } = await client.query(
    `UPDATE commission_entries
     SET reversed_at = NULL, reversal_reason = NULL
     WHERE external_payment_id = $1 AND reversed_at IS NOT NULL
     RETURNING *`,
    [externalPaymentId]
  );
  return rows[0] || null;
}

// Conta TODAS as comissões daquele indicado, estornadas inclusive - e isso é
// deliberado. Este número decide duas coisas: se o próximo pagamento é a
// primeira venda ou recorrência, e se o teto de meses já foi atingido.
// Ignorando as estornadas, um cliente que pagasse, estornasse e pagasse de
// novo geraria uma segunda "primeira venda", com o percentual de entrada, pelo
// mesmo cliente - transformando estorno numa forma de ganhar comissão.
async function countByReferredUser(referredUserId) {
  const { rows } = await pool.query(
    'SELECT count(*)::int AS n FROM commission_entries WHERE referred_user_id = $1',
    [referredUserId]
  );
  return rows[0].n;
}

async function sumTotal({ from, to } = {}) {
  const { rows } = await pool.query(
    `SELECT coalesce(sum(commission_cents), 0)::int AS total_cents, count(*)::int AS n
     FROM commission_entries
     WHERE reversed_at IS NULL
       AND ($1::timestamptz IS NULL OR created_at >= $1)
       AND ($2::timestamptz IS NULL OR created_at <= $2)`,
    [from || null, to || null]
  );
  return rows[0];
}

async function listRecentByAffiliate(affiliateUserId, { from, to, limit = 20 } = {}) {
  const { rows } = await pool.query(
    `SELECT ce.*, u.email AS referred_email, u.business_name AS referred_business_name
     FROM commission_entries ce
     JOIN users u ON u.id = ce.referred_user_id
     WHERE ce.affiliate_user_id = $1
       AND ($2::timestamptz IS NULL OR ce.created_at >= $2)
       AND ($3::timestamptz IS NULL OR ce.created_at <= $3)
     ORDER BY ce.created_at DESC
     LIMIT $4`,
    [affiliateUserId, from || null, to || null, limit]
  );
  return rows;
}

// Totais do período separados por tipo. É o que alimenta os dois cartões que
// não podem ser somados num só: "vendas no mês" (assinatura nova) e
// "recorrência do mês" (mensalidade de quem já era cliente).
async function summaryByAffiliate(affiliateUserId, { from, to } = {}) {
  const { rows } = await pool.query(
    `SELECT kind,
            count(*)::int AS n,
            coalesce(sum(commission_cents), 0)::int AS commission_cents,
            coalesce(sum(amount_paid_cents), 0)::int AS paid_cents
     FROM commission_entries
     WHERE affiliate_user_id = $1
       AND reversed_at IS NULL
       AND ($2::timestamptz IS NULL OR created_at >= $2)
       AND ($3::timestamptz IS NULL OR created_at <= $3)
     GROUP BY kind`,
    [affiliateUserId, from || null, to || null]
  );
  const vazio = { n: 0, commissionCents: 0, paidCents: 0 };
  const resumo = { primeira: { ...vazio }, recorrencia: { ...vazio } };
  for (const r of rows) {
    resumo[r.kind] = { n: r.n, commissionCents: r.commission_cents, paidCents: r.paid_cents };
  }
  return resumo;
}

// Mesma separação, mas global (painel do admin).
async function summaryTotal({ from, to } = {}) {
  const { rows } = await pool.query(
    `SELECT kind,
            count(*)::int AS n,
            coalesce(sum(commission_cents), 0)::int AS commission_cents
     FROM commission_entries
     WHERE reversed_at IS NULL
       AND ($1::timestamptz IS NULL OR created_at >= $1)
       AND ($2::timestamptz IS NULL OR created_at <= $2)
     GROUP BY kind`,
    [from || null, to || null]
  );
  const resumo = { primeira: { n: 0, commissionCents: 0 }, recorrencia: { n: 0, commissionCents: 0 } };
  for (const r of rows) resumo[r.kind] = { n: r.n, commissionCents: r.commission_cents };
  return resumo;
}

module.exports = {
  insertIfNotExists,
  markReversed,
  markRestored,
  countByReferredUser,
  countByReferredUserInTx,
  sumTotal,
  summaryByAffiliate,
  summaryTotal,
  listRecentByAffiliate,
};
