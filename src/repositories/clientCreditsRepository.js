'use strict';

const pool = require('../db/pool');

const BUCKET_COLUMNS = {
  normal: { quota: 'quota_normal', used: 'used_normal', extra: 'extra_normal' },
  bonus: { quota: 'quota_bonus', used: 'used_bonus', extra: 'extra_bonus' },
};

function columnsFor(bucket) {
  const columns = BUCKET_COLUMNS[bucket];
  if (!columns) throw new Error(`Bolso de credito invalido: ${bucket}`);
  return columns;
}

async function getOrCreate(clientUserId) {
  await pool.query(
    `INSERT INTO client_credits (client_user_id) VALUES ($1) ON CONFLICT (client_user_id) DO NOTHING`,
    [clientUserId]
  );
  const { rows } = await pool.query('SELECT * FROM client_credits WHERE client_user_id = $1', [clientUserId]);
  return rows[0];
}

// Debito atomico com verificacao de saldo - o UPDATE inteiro (CTE "old" com
// FOR UPDATE trava a linha, o UPDATE seguinte so confirma se o total
// disponivel bastar) roda como uma unica ida ao banco, entao duas chamadas
// concorrentes pro mesmo cliente sempre serializam (a segunda so ve o saldo
// ja atualizado pela primeira) - e assim que garantimos nunca debitar mais
// credito do que existe, mesmo se um dia o video-processing deixar de ser
// estritamente 1 por vez. Devolve null se o saldo nao bastar (nada e
// debitado); senao devolve quanto saiu da cota e quanto saiu do avulso, pra
// o chamador guardar em credit_transactions e poder devolver exato se
// precisar liberar depois.
async function reserve(clientUserId, bucket, minutes) {
  const { quota, used, extra } = columnsFor(bucket);
  const { rows } = await pool.query(
    `WITH old AS (
       SELECT ${quota} AS quota, ${used} AS used, ${extra} AS extra
       FROM client_credits WHERE client_user_id = $1 FOR UPDATE
     ),
     calc AS (
       SELECT quota, used, extra, GREATEST(quota - used, 0) AS available_quota FROM old
     )
     UPDATE client_credits cc
     SET ${used} = LEAST(calc.quota, calc.used + $2),
         ${extra} = calc.extra - GREATEST($2 - calc.available_quota, 0)
     FROM calc
     WHERE cc.client_user_id = $1
       AND (calc.available_quota + calc.extra) >= $2
     RETURNING LEAST($2, calc.available_quota) AS minutes_from_quota,
               GREATEST($2 - calc.available_quota, 0) AS minutes_from_extra`,
    [clientUserId, minutes]
  );
  if (!rows[0]) return null;
  return { minutesFromQuota: rows[0].minutes_from_quota, minutesFromExtra: rows[0].minutes_from_extra };
}

// Reverte exatamente o que reserve() tirou de cada parte do bolso (download
// falhou antes de completar - ver regra "nao debita nada" no processVideoJob).
async function release(clientUserId, bucket, { minutesFromQuota, minutesFromExtra }) {
  const { used, extra } = columnsFor(bucket);
  await pool.query(
    `UPDATE client_credits
     SET ${used} = GREATEST(${used} - $2, 0), ${extra} = ${extra} + $3, updated_at = now()
     WHERE client_user_id = $1`,
    [clientUserId, minutesFromQuota, minutesFromExtra]
  );
}

// Usado so na reconciliacao rara de bolso (egress real != bolso reservado,
// ver creditsService) - forca o debito direto no "used" sem checar saldo,
// porque o download ja aconteceu de verdade (custo ja foi gasto) e nao ha
// como desfazer isso; loga aviso e segue (pode deixar o bolso negativo nesse
// caso raro, aceito documentado no plano).
async function forceDebitUsed(clientUserId, bucket, minutes) {
  const { used } = columnsFor(bucket);
  await pool.query(
    `UPDATE client_credits SET ${used} = ${used} + $2, updated_at = now() WHERE client_user_id = $1`,
    [clientUserId, minutes]
  );
}

// Credito avulso comprado - nunca expira sozinho, carrega de ciclo em ciclo
// (nao mexe em quota_*/used_*).
async function addExtra(clientUserId, bucket, minutes) {
  const { extra } = columnsFor(bucket);
  await pool.query(
    `UPDATE client_credits SET ${extra} = ${extra} + $2, updated_at = now() WHERE client_user_id = $1`,
    [clientUserId, minutes]
  );
}

// Reset semanal (job) - so mexe nos clientes com assinatura ativa cujo
// ciclo ja completou 7 dias. Zera used_* (cota nao acumula sobra) e aplica a
// cota do plano ATUAL (pode ter mudado no meio do ciclo anterior); extra_*
// (avulso comprado) fica intocado, carrega pro proximo ciclo.
async function resetDueCycles() {
  const { rows } = await pool.query(
    `UPDATE client_credits cc
     SET quota_normal = sp.weekly_minutes_normal,
         quota_bonus = sp.weekly_minutes_bonus,
         used_normal = 0,
         used_bonus = 0,
         cycle_start_at = now(),
         updated_at = now()
     FROM client_subscriptions cs
     JOIN subscription_plans sp ON sp.id = cs.plan_id
     WHERE cc.client_user_id = cs.client_user_id
       AND cs.status = 'ativo'
       AND cc.cycle_start_at <= now() - interval '7 days'
     RETURNING cc.client_user_id`,
    []
  );
  return rows.map((r) => r.client_user_id);
}

// Primeira ativacao de plano (cliente estava 'sem_plano' ou nunca teve
// client_credits) - aplica a cota nova na hora, sem ciclo atual pra proteger.
async function applyPlanQuotaNow(clientUserId, planId) {
  await getOrCreate(clientUserId);
  await pool.query(
    `UPDATE client_credits cc
     SET quota_normal = sp.weekly_minutes_normal,
         quota_bonus = sp.weekly_minutes_bonus,
         used_normal = 0,
         used_bonus = 0,
         cycle_start_at = now(),
         updated_at = now()
     FROM subscription_plans sp
     WHERE cc.client_user_id = $1 AND sp.id = $2`,
    [clientUserId, planId]
  );
}

module.exports = {
  getOrCreate,
  reserve,
  release,
  forceDebitUsed,
  addExtra,
  resetDueCycles,
  applyPlanQuotaNow,
};
