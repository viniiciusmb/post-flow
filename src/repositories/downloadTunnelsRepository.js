'use strict';

const crypto = require('crypto');
const pool = require('../db/pool');

const PORT_BASE = 20000;
const PAIRING_CODE_TTL_MS = 15 * 60 * 1000;

function generatePairingCode() {
  // 6 caracteres, sem 0/O/1/I (evita confusao ao digitar).
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += alphabet[crypto.randomInt(alphabet.length)];
  }
  return code;
}

async function findByClientId(clientUserId) {
  const { rows } = await pool.query(
    "SELECT * FROM download_tunnels WHERE client_user_id = $1 AND owner_type = 'client'",
    [clientUserId]
  );
  return rows[0] || null;
}

async function findFounderTunnel() {
  const { rows } = await pool.query("SELECT * FROM download_tunnels WHERE owner_type = 'founder'");
  return rows[0] || null;
}

async function findByPairingCode(pairingCode) {
  const { rows } = await pool.query(
    'SELECT * FROM download_tunnels WHERE pairing_code = $1 AND pairing_code_expires_at > now()',
    [pairingCode]
  );
  return rows[0] || null;
}

// Reserva o id primeiro (nextval isolado) pra poder calcular a porta
// (PORT_BASE + id) dentro do mesmo INSERT, sem precisar de um UPDATE
// separado nem risco de duas portas iguais.
async function createPendingPairing({ publicKey, label }) {
  const { rows: idRows } = await pool.query(
    "SELECT nextval(pg_get_serial_sequence('download_tunnels', 'id')) AS id"
  );
  const id = Number(idRows[0].id);
  const pairingCode = generatePairingCode();
  const { rows } = await pool.query(
    `INSERT INTO download_tunnels (id, owner_type, client_user_id, label, public_key, assigned_port, pairing_code, pairing_code_expires_at)
     VALUES ($1, 'client', NULL, $2, $3, $4, $5, now() + make_interval(secs => $6))
     RETURNING *`,
    [id, label || null, publicKey, PORT_BASE + id, pairingCode, PAIRING_CODE_TTL_MS / 1000]
  );
  return rows[0];
}

// Cliente cola o codigo de pareamento no painel - vincula a linha pendente
// ao client_user_id dele e encerra o pareamento (codigo nao serve mais).
async function completePairing(pairingCode, clientUserId) {
  const { rows } = await pool.query(
    `UPDATE download_tunnels
     SET client_user_id = $2, pairing_code = NULL, pairing_code_expires_at = NULL
     WHERE pairing_code = $1 AND pairing_code_expires_at > now()
     RETURNING *`,
    [pairingCode, clientUserId]
  );
  return rows[0] || null;
}

async function markTestResult(id, { connected, result }) {
  const { rows } = await pool.query(
    `UPDATE download_tunnels
     SET connected = $2, last_test_result = $3, last_checked_at = now()
     WHERE id = $1
     RETURNING *`,
    [id, connected, JSON.stringify(result)]
  );
  return rows[0] || null;
}

async function listAll() {
  const { rows } = await pool.query('SELECT * FROM download_tunnels ORDER BY id');
  return rows;
}

// Usado pelo creditsService pra decidir o bolso (bonus se o cliente tem
// tunel proprio conectado agora, normal senao) - so olha essa flag direto,
// sem duplicar a logica de prioridade de candidatos do ytDlpService.
async function hasConnectedClientTunnel(clientUserId) {
  const { rows } = await pool.query(
    "SELECT 1 FROM download_tunnels WHERE client_user_id = $1 AND owner_type = 'client' AND connected = true",
    [clientUserId]
  );
  return rows.length > 0;
}

// O cliente pediu pra so baixar quando o computador dele estiver ligado?
// Devolve tambem se ele esta conectado agora, porque quem chama precisa dos
// dois pra decidir (esperar x baixar pela nossa banda).
async function clientTunnelPolicy(clientUserId) {
  if (!clientUserId) return { exige: false, conectado: false, temTunel: false };
  const { rows } = await pool.query(
    `SELECT connected, enabled, require_client_tunnel
       FROM download_tunnels
      WHERE client_user_id = $1 AND owner_type = 'client'
      LIMIT 1`,
    [clientUserId]
  );
  const t = rows[0];
  if (!t) return { exige: false, conectado: false, temTunel: false };
  return {
    // Tunel desligado no painel do admin nao pode segurar a fila do cliente:
    // ele nao tem como saber que foi desligado nem como religar.
    exige: t.require_client_tunnel && t.enabled,
    conectado: t.connected === true,
    temTunel: true,
  };
}

async function setRequireClientTunnel(clientUserId, exigir) {
  const { rows } = await pool.query(
    `UPDATE download_tunnels SET require_client_tunnel = $2
      WHERE client_user_id = $1 AND owner_type = 'client'
      RETURNING *`,
    [clientUserId, Boolean(exigir)]
  );
  return rows[0] || null;
}

async function countConnectedClients() {
  const { rows } = await pool.query(
    "SELECT count(*)::int AS count FROM download_tunnels WHERE owner_type = 'client' AND connected = true"
  );
  return rows[0].count;
}

async function removeByClientId(clientUserId) {
  await pool.query("DELETE FROM download_tunnels WHERE client_user_id = $1 AND owner_type = 'client'", [
    clientUserId,
  ]);
}

// Liga/desliga sem derrubar a conexao SSH em si - so tira/poe esse tunel
// como candidato em ytDlpService.getCandidates().
async function setEnabled(id, enabled) {
  const { rows } = await pool.query(
    'UPDATE download_tunnels SET enabled = $2 WHERE id = $1 RETURNING *',
    [id, enabled]
  );
  return rows[0] || null;
}

module.exports = {
  findByClientId,
  findFounderTunnel,
  findByPairingCode,
  createPendingPairing,
  completePairing,
  markTestResult,
  listAll,
  hasConnectedClientTunnel,
  clientTunnelPolicy,
  setRequireClientTunnel,
  countConnectedClients,
  removeByClientId,
  setEnabled,
};
