'use strict';

const pool = require('../db/pool');

// Expressão SQL: a conta `alias` está dentro do limite do plano do dono?
//
// O limite é por rede (Starter 1, Pro 3, Max 6). Quem passou do limite - trocou
// pra um plano menor, cancelou - NÃO perde nada: as contas mais antigas de cada
// rede continuam publicando, e as que sobram ficam com a fila parada até o
// cliente desconectar uma ou voltar a um plano maior. Sem isto, assinar o Max,
// conectar 6 Instagrams e voltar pro Starter manteria os 6 publicando.
// Admin não tem limite; assinatura cancelada conta como sem plano (ver
// planLimitsService.limitesDasNovidades - as duas regras precisam bater).
function dentroDoPlanoSql(alias) {
  return `EXISTS (
    SELECT 1
      FROM (SELECT x.id, row_number() OVER (PARTITION BY x.network ORDER BY x.connected_at, x.id) AS posicao
              FROM social_accounts x
             WHERE x.client_user_id = ${alias}.client_user_id AND x.disconnected_at IS NULL) r
      JOIN users u ON u.id = ${alias}.client_user_id
      LEFT JOIN client_subscriptions cs ON cs.client_user_id = ${alias}.client_user_id
      LEFT JOIN subscription_plans pl ON pl.id = cs.plan_id
     WHERE r.id = ${alias}.id
       AND (u.role = 'admin'
            OR (cs.plan_id IS NOT NULL AND cs.status <> 'cancelado'
                AND (pl.max_contas_por_rede IS NULL OR r.posicao <= pl.max_contas_por_rede))))`;
}

const CAMPOS = `id, client_user_id, network, outstand_account_id, username, display_name, avatar_url, account_type, connected_at,
  conferida_em, precisa_reconectar_em, motivo_reconectar`;

async function listActive(clientUserId) {
  const { rows } = await pool.query(
    `SELECT ${CAMPOS}, ${dentroDoPlanoSql('social_accounts')} AS dentro_do_plano FROM social_accounts
     WHERE client_user_id = $1 AND disconnected_at IS NULL
     ORDER BY connected_at, id`,
    [clientUserId]
  );
  return rows;
}

// Grava (ou reativa) o vínculo da conta com o cliente.
//
// A conta já vinculada a OUTRO cliente não é tomada: o WHERE do DO UPDATE só
// deixa atualizar quando o dono é o mesmo ou quando a linha antiga já foi
// desconectada. Sem isso, um cliente conectando o mesmo perfil roubaria o
// vínculo de outro, e os cortes de um iriam pro perfil do outro.
async function upsert({ clientUserId, network, outstandAccountId, networkUniqueId, username, displayName, avatarUrl, accountType }) {
  const { rows } = await pool.query(
    `INSERT INTO social_accounts
       (client_user_id, network, outstand_account_id, network_unique_id, username, display_name, avatar_url, account_type)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (outstand_account_id) DO UPDATE SET
       client_user_id = EXCLUDED.client_user_id,
       network_unique_id = COALESCE(EXCLUDED.network_unique_id, social_accounts.network_unique_id),
       username = COALESCE(EXCLUDED.username, social_accounts.username),
       display_name = COALESCE(EXCLUDED.display_name, social_accounts.display_name),
       avatar_url = COALESCE(EXCLUDED.avatar_url, social_accounts.avatar_url),
       account_type = COALESCE(EXCLUDED.account_type, social_accounts.account_type),
       connected_at = CASE WHEN social_accounts.disconnected_at IS NULL THEN social_accounts.connected_at ELSE now() END,
       disconnected_at = NULL,
       -- Reconectar é justamente o que resolve o "precisa reconectar".
       precisa_reconectar_em = NULL,
       motivo_reconectar = NULL,
       conferida_em = now()
     WHERE social_accounts.client_user_id = EXCLUDED.client_user_id OR social_accounts.disconnected_at IS NOT NULL
     RETURNING ${CAMPOS}`,
    [clientUserId, network, outstandAccountId, networkUniqueId || null, username || null, displayName || null, avatarUrl || null, accountType || null]
  );
  return rows[0] || null;
}

// Filtra pelo dono: sem isso, qualquer cliente desconectaria a conta de outro
// trocando o número na URL.
async function findOwned(id, clientUserId) {
  const { rows } = await pool.query(
    `SELECT ${CAMPOS}, ${dentroDoPlanoSql('social_accounts')} AS dentro_do_plano
       FROM social_accounts WHERE id = $1 AND client_user_id = $2 AND disconnected_at IS NULL`,
    [id, clientUserId]
  );
  return rows[0] || null;
}

async function markDisconnected(id, clientUserId) {
  await pool.query(
    `UPDATE social_accounts SET disconnected_at = now() WHERE id = $1 AND client_user_id = $2 AND disconnected_at IS NULL`,
    [id, clientUserId]
  );
}

// A conta (pelo id da Outstand) já é deste cliente e está ativa? Reconectar a
// mesma conta nunca esbarra no limite do plano - ela já está contada.
async function jaConectadaPor(clientUserId, outstandAccountId) {
  const { rows } = await pool.query(
    `SELECT 1 FROM social_accounts WHERE client_user_id = $1 AND outstand_account_id = $2 AND disconnected_at IS NULL`,
    [clientUserId, outstandAccountId]
  );
  return rows.length > 0;
}

async function contarNaRede(clientUserId, network) {
  const { rows } = await pool.query(
    `SELECT count(*)::int AS n FROM social_accounts WHERE client_user_id = $1 AND network = $2 AND disconnected_at IS NULL`,
    [clientUserId, network]
  );
  return rows[0].n;
}

module.exports = { listActive, upsert, findOwned, markDisconnected, jaConectadaPor, contarNaRede, dentroDoPlanoSql };
