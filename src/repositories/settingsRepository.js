'use strict';

const pool = require('../db/pool');

async function getValue(key, fallback) {
  const { rows } = await pool.query('SELECT value FROM settings WHERE key = $1', [key]);
  return rows[0] ? rows[0].value : fallback;
}

module.exports = { getValue };
