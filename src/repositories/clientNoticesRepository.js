'use strict';

const pool = require('../db/pool');

async function create({ clientUserId, title, body }) {
  const { rows } = await pool.query(
    `INSERT INTO client_notices (client_user_id, title, body) VALUES ($1, $2, $3) RETURNING *`,
    [clientUserId, title, body]
  );
  return rows[0];
}

// Os que o cliente ainda nao fechou, do mais antigo pro mais novo: dois avisos
// aparecem um depois do outro na ordem em que foram escritos.
async function listOpen(clientUserId) {
  const { rows } = await pool.query(
    `SELECT id, title, body, created_at FROM client_notices
     WHERE client_user_id = $1 AND dismissed_at IS NULL
     ORDER BY created_at, id`,
    [clientUserId]
  );
  return rows;
}

// Filtra pelo dono: sem isso, qualquer cliente fecharia o aviso de outro
// trocando o numero na URL.
async function dismiss(id, clientUserId) {
  const { rows } = await pool.query(
    `UPDATE client_notices SET dismissed_at = now()
     WHERE id = $1 AND client_user_id = $2 AND dismissed_at IS NULL
     RETURNING id`,
    [id, clientUserId]
  );
  return rows[0] || null;
}

module.exports = { create, listOpen, dismiss };
