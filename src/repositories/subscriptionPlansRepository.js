'use strict';

const pool = require('../db/pool');

async function listActive() {
  const { rows } = await pool.query(
    'SELECT * FROM subscription_plans WHERE is_active = true ORDER BY price_cents ASC'
  );
  return rows;
}

async function findById(id) {
  const { rows } = await pool.query('SELECT * FROM subscription_plans WHERE id = $1', [id]);
  return rows[0] || null;
}

async function findByKey(key) {
  const { rows } = await pool.query('SELECT * FROM subscription_plans WHERE key = $1', [key]);
  return rows[0] || null;
}

module.exports = {
  listActive,
  findById,
  findByKey,
};
