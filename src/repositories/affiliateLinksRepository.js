'use strict';

const crypto = require('crypto');
const pool = require('../db/pool');

// 7 caracteres, sem 0/O/1/I (evita confusao ao digitar/ler em voz alta) -
// mesmo alfabeto usado no codigo de pareamento do tunel (downloadTunnelsRepository).
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateCode(length = 7) {
  let code = '';
  for (let i = 0; i < length; i++) {
    code += ALPHABET[crypto.randomInt(ALPHABET.length)];
  }
  return code;
}

async function findByCode(code) {
  const { rows } = await pool.query(
    `SELECT al.*, u.role AS owner_role, u.email AS owner_email, u.business_name AS owner_business_name
     FROM affiliate_links al
     JOIN users u ON u.id = al.owner_user_id
     WHERE al.code = $1`,
    [code]
  );
  return rows[0] || null;
}

async function findDefaultByOwner(ownerUserId) {
  const { rows } = await pool.query(
    `SELECT * FROM affiliate_links WHERE owner_user_id = $1 AND is_default = true`,
    [ownerUserId]
  );
  return rows[0] || null;
}

// Cria o link automatico na primeira vez que o afiliado precisa dele (mesmo
// espirito de client_subscriptions.getOrCreate) - tenta gerar um codigo, e se
// colidir (extremamente raro, 33^7 possibilidades) tenta de novo.
async function getOrCreateDefault(ownerUserId) {
  const existing = await findDefaultByOwner(ownerUserId);
  if (existing) return existing;

  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateCode();
    try {
      const { rows } = await pool.query(
        `INSERT INTO affiliate_links (code, owner_user_id, is_default)
         VALUES ($1, $2, true)
         RETURNING *`,
        [code, ownerUserId]
      );
      return rows[0];
    } catch (err) {
      if (err.code === '23505') continue; // unique_violation - tenta outro codigo
      throw err;
    }
  }
  throw new Error('Nao foi possivel gerar um codigo de afiliado unico.');
}

async function createCustom(ownerUserId, { code, label }) {
  const { rows } = await pool.query(
    `INSERT INTO affiliate_links (code, owner_user_id, label, is_default)
     VALUES ($1, $2, $3, false)
     RETURNING *`,
    [code, ownerUserId, label || null]
  );
  return rows[0];
}

async function listByOwner(ownerUserId) {
  const { rows } = await pool.query(
    `SELECT * FROM affiliate_links WHERE owner_user_id = $1 ORDER BY is_default DESC, created_at DESC`,
    [ownerUserId]
  );
  return rows;
}

// Estatisticas por link (pra tela "Meus links" do admin) - conta indicacoes
// e quantas delas ja viraram assinatura ativa.
async function listCustomWithStats(ownerUserId) {
  const { rows } = await pool.query(
    `SELECT al.*,
            count(r.id)::int AS referral_count,
            count(r.id) FILTER (WHERE cs.status = 'ativo')::int AS active_count
     FROM affiliate_links al
     LEFT JOIN referrals r ON r.affiliate_link_id = al.id
     LEFT JOIN client_subscriptions cs ON cs.client_user_id = r.referred_user_id
     WHERE al.owner_user_id = $1 AND al.is_default = false
     GROUP BY al.id
     ORDER BY al.created_at DESC`,
    [ownerUserId]
  );
  return rows;
}

module.exports = {
  findByCode,
  findDefaultByOwner,
  getOrCreateDefault,
  createCustom,
  listByOwner,
  listCustomWithStats,
};
