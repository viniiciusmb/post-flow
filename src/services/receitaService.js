// Receita: quanto dinheiro entrou, de onde veio, e quanto entra todo mês.
//
// Duas metades que não podem se misturar:
//
//   - REGISTRO (registrar*, marcarEstorno, desfazerEstorno): chamado de dentro
//     dos fluxos de pagamento, no instante em que o dinheiro entra ou volta.
//     NUNCA lança: um erro ao anotar a receita não pode impedir o plano de
//     ativar nem o crédito de cair. No pior caso falta uma linha no relatório,
//     e o log diz qual.
//
//   - LEITURA (painel, resumoParaInicio): usada pelas telas do admin.
//
// A regra de "quanto entra por mês" (MRR) mora aqui e só aqui. A tela de
// Receita e a tela Início mostram o mesmo número porque chamam a mesma função.
'use strict';

const pool = require('../db/pool');
const logger = require('../lib/logger');
const { mensalidadeDosExtras, precosDoPlano } = require('../lib/precoDasConexoesExtras');

const MENSALIDADE = ['primeira_mensalidade', 'recorrencia'];
const EXTRAS = ['credito_avulso', 'excedente', 'conexoes_extras'];

// ---------------------------------------------------------------------------
// Registro
// ---------------------------------------------------------------------------

async function registrar({ clientUserId, kind, provider, externalId, planId = null, amountCents, billingType = null, paidAt = null }) {
  if (!externalId || !Number.isFinite(Number(amountCents))) return null;
  try {
    const { rows } = await pool.query(
      `INSERT INTO revenue_entries (client_user_id, kind, provider, external_id, plan_id, amount_cents, billing_type, paid_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8::timestamptz, now()))
       ON CONFLICT (provider, external_id) DO NOTHING
       RETURNING *`,
      [clientUserId, kind, provider, String(externalId), planId, Math.round(Number(amountCents)), billingType, paidAt]
    );
    return rows[0] || null;
  } catch (err) {
    logger.error(`Receita: nao consegui registrar ${kind} ${provider}/${externalId} (o pagamento segue valendo):`, err.message);
    return null;
  }
}

// Mensalidade: primeira ou recorrência, decidido AQUI e congelado na linha.
//
// É a primeira quando o cliente não tem nenhuma mensalidade anterior no livro -
// estornada inclusive. Contar só as não estornadas faria "pagar, estornar,
// pagar de novo" virar uma segunda primeira venda, e o relatório de novas
// assinaturas contaria o mesmo cliente duas vezes.
//
// Decidido numa instrução só (INSERT ... SELECT) em vez de ler e depois
// escrever: o caminho síncrono do checkout e o webhook chegam juntos.
async function registrarMensalidade({ clientUserId, provider, externalId, planId = null, amountCents, billingType = null, paidAt = null }) {
  if (!externalId || !Number.isFinite(Number(amountCents))) return null;
  try {
    const { rows } = await pool.query(
      `INSERT INTO revenue_entries (client_user_id, kind, provider, external_id, plan_id, amount_cents, billing_type, paid_at)
       -- Tipos explícitos em todo parâmetro: num INSERT ... SELECT o Postgres
       -- não deduz o tipo pela coluna de destino, e sem os casts a instrução
       -- falhava - em silêncio, porque este registro nunca lança.
       SELECT $1::bigint,
              CASE WHEN EXISTS (
                     SELECT 1 FROM revenue_entries
                      WHERE client_user_id = $1::bigint AND kind = ANY($8::text[]))
                   THEN 'recorrencia' ELSE 'primeira_mensalidade' END,
              $2::text, $3::text, $4::bigint, $5::integer, $6::text, COALESCE($7::timestamptz, now())
       ON CONFLICT (provider, external_id) DO NOTHING
       RETURNING *`,
      [clientUserId, provider, String(externalId), planId, Math.round(Number(amountCents)), billingType, paidAt, MENSALIDADE]
    );
    return rows[0] || null;
  } catch (err) {
    logger.error(`Receita: nao consegui registrar a mensalidade ${provider}/${externalId} (o pagamento segue valendo):`, err.message);
    return null;
  }
}

async function marcarEstorno({ provider, externalId }) {
  if (!externalId) return;
  try {
    await pool.query(
      `UPDATE revenue_entries SET refunded_at = now()
        WHERE provider = $1 AND external_id = $2 AND refunded_at IS NULL`,
      [provider, String(externalId)]
    );
  } catch (err) {
    logger.error(`Receita: nao consegui marcar o estorno de ${provider}/${externalId}:`, err.message);
  }
}

async function desfazerEstorno({ provider, externalId }) {
  if (!externalId) return;
  try {
    await pool.query('UPDATE revenue_entries SET refunded_at = NULL WHERE provider = $1 AND external_id = $2', [
      provider,
      String(externalId),
    ]);
  } catch (err) {
    logger.error(`Receita: nao consegui desfazer o estorno de ${provider}/${externalId}:`, err.message);
  }
}

// ---------------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------------

// Meses inteiros entre duas datas ("assina há 3 meses"). Um mês só conta
// quando o dia do mês é alcançado: de 15/jan a 14/fev ainda é 0.
function mesesEntre(inicio, fim) {
  const a = new Date(inicio);
  const b = new Date(fim);
  let meses = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
  if (b.getUTCDate() < a.getUTCDate()) meses -= 1;
  return Math.max(0, meses);
}

// Pagante é quem tem cobrança automática ligada em algum provedor. Plano
// atribuído à mão pelo admin (como todos os clientes eram ativados até a
// primeira venda, em 13/09/2026) é CORTESIA: tem plano ativo e não paga nada.
// Somar cortesia no MRR faria o número dizer que entra dinheiro que não entra.
function ehPagante(linha) {
  return Boolean(linha.asaas_subscription_id || linha.asaas_pix_authorization_id || linha.stripe_subscription_id);
}

function meioDePagamento(linha) {
  if (linha.asaas_pix_authorization_id && linha.subscription_provider === 'asaas_pix') return 'pix';
  if (linha.asaas_subscription_id) return 'cartao';
  if (linha.stripe_subscription_id) return 'cartao_stripe';
  return 'manual';
}

// Quanto este cliente paga por mês HOJE: a mensalidade CHEIA do plano (o preço
// de estreia acontece uma vez só - usá-lo aqui faria o MRR encolher justamente
// quando entra cliente novo) mais as conexões extras recorrentes.
function mensalidadeDe(linha) {
  if (!linha.plan_price_cents) return 0;
  const precos = precosDoPlano(linha);
  const extras = precos ? mensalidadeDosExtras(linha, precos) : 0;
  return Number(linha.plan_price_cents) + extras;
}

async function listarAssinaturas() {
  const { rows } = await pool.query(
    `SELECT cs.client_user_id, cs.status, cs.first_plan_at, cs.canceled_at, cs.created_at,
            cs.asaas_subscription_id, cs.asaas_pix_authorization_id, cs.stripe_subscription_id,
            cs.subscription_provider, cs.asaas_card_brand, cs.asaas_card_last4,
            cs.extra_channels, cs.extra_tiktok_accounts,
            u.email, u.business_name,
            sp.id AS plan_id, sp.key AS plan_key, sp.name AS plan_name, sp.price_cents AS plan_price_cents,
            sp.extra_channel_price_cents, sp.extra_tiktok_price_cents, sp.extra_both_price_cents,
            COALESCE(r.total_pago, 0) AS total_pago,
            COALESCE(r.parcelas, 0) AS parcelas,
            r.primeiro_pagamento, r.ultimo_pagamento
       FROM client_subscriptions cs
       JOIN users u ON u.id = cs.client_user_id
       LEFT JOIN subscription_plans sp ON sp.id = cs.plan_id
       -- Subconsulta agregada, nunca JOIN direto nas linhas do livro: juntar
       -- linha a linha multiplicaria a assinatura pelo número de pagamentos.
       LEFT JOIN (
         SELECT client_user_id,
                sum(amount_cents) FILTER (WHERE refunded_at IS NULL) AS total_pago,
                count(*) FILTER (WHERE kind = ANY($1::text[]) AND refunded_at IS NULL) AS parcelas,
                min(paid_at) FILTER (WHERE kind = ANY($1::text[])) AS primeiro_pagamento,
                max(paid_at) FILTER (WHERE refunded_at IS NULL) AS ultimo_pagamento
           FROM revenue_entries
          GROUP BY client_user_id
       ) r ON r.client_user_id = cs.client_user_id
      WHERE cs.status <> 'sem_plano' AND u.role = 'client'
      ORDER BY cs.first_plan_at DESC NULLS LAST`,
    [MENSALIDADE]
  );

  const agora = new Date();
  return rows.map((l) => {
    const pagante = ehPagante(l);
    const inicio = l.primeiro_pagamento || l.first_plan_at || l.created_at;
    const fim = l.status === 'cancelado' && l.canceled_at ? l.canceled_at : agora;
    return {
      clientUserId: Number(l.client_user_id),
      email: l.email,
      nome: l.business_name,
      status: l.status,
      pagante,
      meioDePagamento: meioDePagamento(l),
      cartao: l.asaas_card_last4 ? { bandeira: l.asaas_card_brand, final: l.asaas_card_last4 } : null,
      planKey: l.plan_key,
      planName: l.plan_name,
      mensalidadeCents: mensalidadeDe(l),
      extraChannels: Number(l.extra_channels) || 0,
      extraTiktokAccounts: Number(l.extra_tiktok_accounts) || 0,
      assinanteDesde: inicio,
      canceladoEm: l.canceled_at,
      meses: mesesEntre(inicio, fim),
      parcelasPagas: Number(l.parcelas) || 0,
      totalPagoCents: Number(l.total_pago) || 0,
      ultimoPagamento: l.ultimo_pagamento,
    };
  });
}

// O que vale AGORA, independente do filtro de período: MRR é uma foto do
// presente, não uma soma do passado.
function fotoAtual(assinaturas) {
  const ativasPagantes = assinaturas.filter((a) => a.status === 'ativo' && a.pagante);
  const mrrCents = ativasPagantes.reduce((s, a) => s + a.mensalidadeCents, 0);

  const porPlano = new Map();
  for (const a of ativasPagantes) {
    const chave = a.planKey || 'sem_plano';
    const atual = porPlano.get(chave) || { key: chave, name: a.planName || '—', assinaturas: 0, mrrCents: 0 };
    atual.assinaturas += 1;
    atual.mrrCents += a.mensalidadeCents;
    porPlano.set(chave, atual);
  }

  return {
    mrrCents,
    arrCents: mrrCents * 12,
    pagantes: ativasPagantes.length,
    // Ticket médio só existe com pelo menos um pagante: dividir por zero
    // viraria "R$ 0,00", que parece um número e não é.
    ticketMedioCents: ativasPagantes.length ? Math.round(mrrCents / ativasPagantes.length) : null,
    cortesia: assinaturas.filter((a) => a.status === 'ativo' && !a.pagante).length,
    inadimplentes: assinaturas.filter((a) => a.status === 'inadimplente').length,
    // Quanto do MRR está parado esperando o cliente acertar o pagamento.
    mrrEmRiscoCents: assinaturas
      .filter((a) => a.status === 'inadimplente' && a.pagante)
      .reduce((s, a) => s + a.mensalidadeCents, 0),
    canceladas: assinaturas.filter((a) => a.status === 'cancelado').length,
    mrrPorPlano: [...porPlano.values()].sort((x, y) => y.mrrCents - x.mrrCents),
  };
}

// Receita do período, em regime de CAIXA: o pagamento conta no dia em que
// entrou, e o estorno conta (negativo) no dia em que saiu. Assim o mês passado
// não muda sozinho quando alguém estorna hoje - o que muda é o mês de hoje.
async function resumoDoPeriodo({ since, until }) {
  const [{ rows: porTipo }, { rows: [estornos] }, { rows: [cancelamentos] }] = await Promise.all([
    pool.query(
      `SELECT kind, count(*)::int AS n, COALESCE(sum(amount_cents), 0)::bigint AS cents
         FROM revenue_entries
        WHERE paid_at >= $1 AND paid_at <= $2
        GROUP BY kind`,
      [since, until]
    ),
    pool.query(
      `SELECT count(*)::int AS n, COALESCE(sum(amount_cents), 0)::bigint AS cents
         FROM revenue_entries
        WHERE refunded_at >= $1 AND refunded_at <= $2`,
      [since, until]
    ),
    pool.query(
      `SELECT count(*)::int AS n
         FROM client_subscriptions cs JOIN users u ON u.id = cs.client_user_id
        WHERE cs.canceled_at >= $1 AND cs.canceled_at <= $2 AND u.role = 'client'`,
      [since, until]
    ),
  ]);

  const de = (kind) => porTipo.find((r) => r.kind === kind) || { n: 0, cents: 0 };
  const cents = (kind) => Number(de(kind).cents) || 0;

  const primeiraCents = cents('primeira_mensalidade');
  const recorrenciaCents = cents('recorrencia');
  const extras = {
    creditoAvulsoCents: cents('credito_avulso'),
    excedenteCents: cents('excedente'),
    conexoesExtrasCents: cents('conexoes_extras'),
  };
  const extrasCents = extras.creditoAvulsoCents + extras.excedenteCents + extras.conexoesExtrasCents;
  const brutoCents = primeiraCents + recorrenciaCents + extrasCents;
  const estornosCents = Number(estornos.cents) || 0;

  return {
    brutoCents,
    estornosCents,
    estornosQtd: estornos.n,
    liquidoCents: brutoCents - estornosCents,
    primeiraCents,
    recorrenciaCents,
    extrasCents,
    extras,
    pagamentos: porTipo.reduce((s, r) => s + r.n, 0),
    novasAssinaturas: de('primeira_mensalidade').n,
    renovacoes: de('recorrencia').n,
    cancelamentos: cancelamentos.n,
  };
}

// Últimos 12 meses, sempre - o gráfico mostra tendência, e tendência não cabe
// num filtro de "hoje". O mês é o de Brasília, como o resto do painel.
async function porMes() {
  const { rows } = await pool.query(
    `WITH meses AS (
       SELECT to_char(m, 'YYYY-MM') AS mes
         FROM generate_series(
                date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo') - interval '11 months',
                date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo'),
                interval '1 month') AS m
     )
     SELECT meses.mes,
            COALESCE(sum(re.amount_cents) FILTER (WHERE re.kind = 'primeira_mensalidade'), 0)::bigint AS primeira,
            COALESCE(sum(re.amount_cents) FILTER (WHERE re.kind = 'recorrencia'), 0)::bigint AS recorrencia,
            COALESCE(sum(re.amount_cents) FILTER (WHERE re.kind = ANY($1::text[])), 0)::bigint AS extras
       FROM meses
       LEFT JOIN revenue_entries re
              ON to_char(date_trunc('month', re.paid_at AT TIME ZONE 'America/Sao_Paulo'), 'YYYY-MM') = meses.mes
      GROUP BY meses.mes
      ORDER BY meses.mes`,
    [EXTRAS]
  );
  return rows.map((r) => ({
    mes: r.mes,
    primeiraCents: Number(r.primeira),
    recorrenciaCents: Number(r.recorrencia),
    extrasCents: Number(r.extras),
  }));
}

async function listarPagamentos({ since, until, limite = 300 }) {
  const { rows } = await pool.query(
    `SELECT re.id, re.kind, re.provider, re.amount_cents, re.billing_type, re.paid_at, re.refunded_at,
            re.client_user_id, u.email, u.business_name, sp.name AS plan_name
       FROM revenue_entries re
       LEFT JOIN users u ON u.id = re.client_user_id
       LEFT JOIN subscription_plans sp ON sp.id = re.plan_id
      WHERE re.paid_at >= $1 AND re.paid_at <= $2
      ORDER BY re.paid_at DESC
      LIMIT $3`,
    [since, until, limite]
  );
  return rows.map((r) => ({
    id: Number(r.id),
    kind: r.kind,
    provider: r.provider,
    amountCents: Number(r.amount_cents),
    billingType: r.billing_type,
    paidAt: r.paid_at,
    refundedAt: r.refunded_at,
    clientUserId: r.client_user_id === null ? null : Number(r.client_user_id),
    email: r.email,
    nome: r.business_name,
    planName: r.plan_name,
  }));
}

async function painel({ since, until }) {
  const [assinaturas, periodo, meses, pagamentos] = await Promise.all([
    listarAssinaturas(),
    resumoDoPeriodo({ since, until }),
    porMes(),
    listarPagamentos({ since, until }),
  ]);
  return { atual: fotoAtual(assinaturas), periodo, porMes: meses, assinaturas, pagamentos };
}

// Os poucos números da tela Início. Mesmas funções da tela de Receita, pra os
// dois lugares nunca discordarem.
async function resumoParaInicio({ since, until }) {
  const [assinaturas, periodo] = await Promise.all([listarAssinaturas(), resumoDoPeriodo({ since, until })]);
  const atual = fotoAtual(assinaturas);
  return {
    liquidoCents: periodo.liquidoCents,
    primeiraCents: periodo.primeiraCents,
    recorrenciaCents: periodo.recorrenciaCents,
    extrasCents: periodo.extrasCents,
    mrrCents: atual.mrrCents,
    pagantes: atual.pagantes,
    cortesia: atual.cortesia,
    inadimplentes: atual.inadimplentes,
  };
}

module.exports = {
  registrar,
  registrarMensalidade,
  marcarEstorno,
  desfazerEstorno,
  painel,
  resumoParaInicio,
  mesesEntre,
};
