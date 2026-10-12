// Limites do plano nas lives (12/10/2026): quantos canais o cliente acompanha
// (Starter 1, Pro 2, Max 3) e quantas lives são clipadas pra ele ao mesmo
// tempo (1 em todos os planos). Ver planLimitsService.limitesDasNovidades - as
// duas regras precisam dar o mesmo resultado (admin sem limite, cancelado e
// sem plano = 0).
//
// O resultado fica gravado em live_channel_follows.bloqueio, e é ele que o
// RECEBE_CORTES do livesRepository respeita. Gravar (em vez de calcular em
// cada consulta) tem dois motivos: as três consultas que decidem "quem recebe
// corte" usam o mesmo filtro, e a tela precisa dizer POR QUE um canal ao vivo
// não está sendo clipado.
//
//   fora_do_plano: acompanha mais canais do que o plano dá (trocou pra um plano
//                  menor ou cancelou). Ficam valendo os mais antigos; nada é
//                  apagado, e voltar a um plano maior libera na hora.
//   outra_live:    dois canais ao vivo ao mesmo tempo num plano de 1 live por
//                  vez. Fica a que já estava sendo clipada; depois a que o
//                  cliente pediu à mão ("Clipar esta live"); depois a que
//                  começou primeiro. Quando a primeira acaba, a outra começa
//                  sozinha na volta seguinte do supervisor.
'use strict';

const pool = require('../../db/pool');

const RECALCULAR_SQL = `
WITH base AS (
  SELECT f.user_id, f.live_channel_id, f.created_at, f.paused_at, f.clip_this_live_at,
         c.is_live, c.live_started_at,
         CASE WHEN u.role = 'admin' THEN NULL
              WHEN cs.plan_id IS NULL OR cs.status = 'cancelado' THEN 0
              ELSE pl.max_canais_de_live END AS lim_canais,
         CASE WHEN u.role = 'admin' THEN NULL
              WHEN cs.plan_id IS NULL OR cs.status = 'cancelado' THEN 0
              ELSE pl.max_lives_ao_mesmo_tempo END AS lim_simult,
         row_number() OVER (PARTITION BY f.user_id ORDER BY f.created_at, f.live_channel_id) AS pos_canal,
         EXISTS (SELECT 1 FROM live_sessions s
                   JOIN live_credit_usage cu ON cu.session_id = s.id AND cu.user_id = f.user_id
                  WHERE s.live_channel_id = f.live_channel_id AND s.status = 'gravando') AS ja_recebendo
    FROM live_channel_follows f
    JOIN live_channels c ON c.id = f.live_channel_id
    JOIN users u ON u.id = f.user_id
    LEFT JOIN client_subscriptions cs ON cs.client_user_id = f.user_id
    LEFT JOIN subscription_plans pl ON pl.id = cs.plan_id
   WHERE f.is_active
),
dentro AS (
  SELECT *, (lim_canais IS NULL OR pos_canal <= lim_canais) AS no_plano FROM base
),
querendo AS (
  SELECT user_id, live_channel_id,
         row_number() OVER (
           PARTITION BY user_id
           ORDER BY ja_recebendo DESC, (clip_this_live_at IS NOT NULL) DESC,
                    live_started_at NULLS LAST, created_at, live_channel_id
         ) AS pos_live
    FROM dentro
   WHERE no_plano AND is_live AND (paused_at IS NULL OR clip_this_live_at IS NOT NULL)
),
novo AS (
  SELECT d.user_id, d.live_channel_id,
         CASE WHEN NOT d.no_plano THEN 'fora_do_plano'
              WHEN q.pos_live IS NOT NULL AND d.lim_simult IS NOT NULL AND q.pos_live > d.lim_simult THEN 'outra_live'
              ELSE NULL END AS bloqueio
    FROM dentro d
    LEFT JOIN querendo q ON q.user_id = d.user_id AND q.live_channel_id = d.live_channel_id
)
UPDATE live_channel_follows f
   SET bloqueio = n.bloqueio
  FROM novo n
 WHERE f.user_id = n.user_id AND f.live_channel_id = n.live_channel_id
   AND f.bloqueio IS DISTINCT FROM n.bloqueio
RETURNING f.user_id, f.live_channel_id, f.bloqueio`;

// Recalcula o bloqueio de todo mundo (uma consulta só; roda a cada volta do
// supervisor e depois de cada ação do cliente na tela). Devolve o que mudou.
async function recalcular() {
  const { rows } = await pool.query(RECALCULAR_SQL);
  return rows.map((r) => ({ userId: Number(r.user_id), canalId: Number(r.live_channel_id), bloqueio: r.bloqueio }));
}

module.exports = { recalcular };
