'use strict';

const pool = require('../db/pool');

const CAMPOS = `id, network, outstand_account_id, username, display_name, avatar_url, account_type, connected_at,
  conferida_em, precisa_reconectar_em, motivo_reconectar`;

async function listActive(clientUserId) {
  const { rows } = await pool.query(
    `SELECT ${CAMPOS} FROM social_accounts
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
    `SELECT ${CAMPOS} FROM social_accounts WHERE id = $1 AND client_user_id = $2 AND disconnected_at IS NULL`,
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

module.exports = { listActive, upsert, findOwned, markDisconnected };
