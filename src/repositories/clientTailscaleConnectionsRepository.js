'use strict';

const pool = require('../db/pool');

async function findByClientId(clientUserId) {
  const { rows } = await pool.query(
    'SELECT * FROM client_tailscale_connections WHERE client_user_id = $1',
    [clientUserId]
  );
  return rows[0] || null;
}

async function upsert(clientUserId, tailscaleHostname) {
  const { rows } = await pool.query(
    `INSERT INTO client_tailscale_connections (client_user_id, tailscale_hostname)
     VALUES ($1, $2)
     ON CONFLICT (client_user_id) DO UPDATE SET tailscale_hostname = $2, connected_at = now()
     RETURNING *`,
    [clientUserId, tailscaleHostname]
  );
  return rows[0];
}

async function removeByClientId(clientUserId) {
  await pool.query('DELETE FROM client_tailscale_connections WHERE client_user_id = $1', [clientUserId]);
}

async function saveTestResult(clientUserId, result) {
  const { rows } = await pool.query(
    `UPDATE client_tailscale_connections
     SET last_test_result = $2, last_tested_at = now()
     WHERE client_user_id = $1
     RETURNING *`,
    [clientUserId, JSON.stringify(result)]
  );
  return rows[0] || null;
}

// Usado pelo pipeline de video (processVideoJob) pra saber, dado o dono do
// video-fonte, se ha um aparelho Tailscale conectado pra usar como saida.
async function findHostnameByClientId(clientUserId) {
  const connection = await findByClientId(clientUserId);
  return connection ? connection.tailscale_hostname : null;
}

module.exports = {
  findByClientId,
  upsert,
  removeByClientId,
  saveTestResult,
  findHostnameByClientId,
};
