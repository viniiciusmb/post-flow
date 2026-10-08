'use strict';

const pool = require('../db/pool');

// Todas as consultas filtram pelo dono: um cliente nunca lista, aplica ou apaga
// o modelo de outro trocando o número na URL.

async function listByClient(clientUserId) {
  const { rows } = await pool.query(
    'SELECT id, name, campos, created_at FROM clip_style_models WHERE client_user_id = $1 ORDER BY created_at, id',
    [clientUserId]
  );
  return rows;
}

async function countByClient(clientUserId) {
  const { rows } = await pool.query('SELECT count(*)::int AS n FROM clip_style_models WHERE client_user_id = $1', [clientUserId]);
  return rows[0].n;
}

// Mesmo nome (sem diferenciar maiúscula) substitui o modelo antigo em vez de
// criar um segundo "Meu estilo": é o que a pessoa espera ao salvar de novo com
// o mesmo nome depois de ajustar alguma coisa.
async function salvar(clientUserId, nome, campos) {
  const { rows } = await pool.query(
    `INSERT INTO clip_style_models (client_user_id, name, campos)
     VALUES ($1, btrim($2), $3)
     ON CONFLICT (client_user_id, lower(btrim(name))) DO UPDATE SET campos = EXCLUDED.campos, updated_at = now()
     RETURNING id, name, campos, created_at, (xmax <> 0) AS substituido`,
    [clientUserId, nome, JSON.stringify(campos)]
  );
  return rows[0];
}

async function findOwned(id, clientUserId) {
  const { rows } = await pool.query(
    'SELECT id, name, campos FROM clip_style_models WHERE id = $1 AND client_user_id = $2',
    [id, clientUserId]
  );
  return rows[0] || null;
}

async function remove(id, clientUserId) {
  const { rowCount } = await pool.query('DELETE FROM clip_style_models WHERE id = $1 AND client_user_id = $2', [id, clientUserId]);
  return rowCount > 0;
}

module.exports = { listByClient, countByClient, salvar, findOwned, remove };
