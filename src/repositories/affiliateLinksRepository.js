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

// Link extra criado pelo próprio afiliado (bio do TikTok, descrição do
// YouTube, grupo...). O CÓDIGO é sempre gerado por nós, ao contrário dos links
// de campanha do admin, que têm slug escolhido a dedo: se cada cliente pudesse
// escolher o texto do código, o primeiro a pedir "promo" ou "postflow" ficaria
// com ele para sempre, e o admin perderia os nomes que ele usa nas campanhas.
// O que o afiliado escolhe é o RÓTULO, que é o que ele lê na tela - o código é
// só o endereço.
async function createForOwner(ownerUserId, { label }) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateCode();
    try {
      const { rows } = await pool.query(
        `INSERT INTO affiliate_links (code, owner_user_id, label, is_default)
         VALUES ($1, $2, $3, false)
         RETURNING *`,
        [code, ownerUserId, label || null]
      );
      return rows[0];
    } catch (err) {
      if (err.code === '23505') continue; // colisao de codigo - tenta outro
      throw err;
    }
  }
  throw new Error('Nao foi possivel gerar um codigo de afiliado unico.');
}

async function countByOwner(ownerUserId) {
  const { rows } = await pool.query(
    'SELECT count(*)::int AS n FROM affiliate_links WHERE owner_user_id = $1',
    [ownerUserId]
  );
  return rows[0].n;
}

async function setLabel(id, ownerUserId, label) {
  const { rows } = await pool.query(
    `UPDATE affiliate_links SET label = $3 WHERE id = $1 AND owner_user_id = $2 RETURNING *`,
    [id, ownerUserId, label || null]
  );
  return rows[0] || null;
}

// Arquiva (ou desarquiva) um link - só organização de tela: o link arquivado
// continua contando clique e continua atribuindo venda (ver o comentário da
// migration 079). O link PADRÃO nunca é arquivável; o banco também recusa
// (CHECK), isto aqui só evita a viagem até lá.
async function setArchived(id, ownerUserId, arquivar) {
  const { rows } = await pool.query(
    `UPDATE affiliate_links SET archived_at = CASE WHEN $3 THEN now() ELSE NULL END
     WHERE id = $1 AND owner_user_id = $2 AND (is_default = false OR $3 = false)
     RETURNING *`,
    [id, ownerUserId, arquivar]
  );
  return rows[0] || null;
}

// Um link com todos os números que interessam ao afiliado: cliques, cadastros,
// assinaturas ativas e comissão que ele já gerou.
//
// Cada número sai de uma SUBCONSULTA, nunca de mais um JOIN somado. Juntar
// cliques com indicações na mesma consulta multiplicaria as linhas uma pela
// outra (um link com 40 cliques e 2 indicações reportaria 80 cliques) - é
// exatamente o defeito de fan-out que já apareceu na tela "Clientes" do admin.
async function listByOwnerWithStats(ownerUserId, { from, to } = {}) {
  const { rows } = await pool.query(
    `SELECT al.*,
            (SELECT count(*)::int FROM affiliate_link_clicks c
              WHERE c.affiliate_link_id = al.id) AS clicks_total,
            (SELECT count(*)::int FROM affiliate_link_clicks c
              WHERE c.affiliate_link_id = al.id
                AND ($2::timestamptz IS NULL OR c.created_at >= $2)
                AND ($3::timestamptz IS NULL OR c.created_at <= $3)) AS clicks_period,
            (SELECT count(DISTINCT c.visitor_hash)::int FROM affiliate_link_clicks c
              WHERE c.affiliate_link_id = al.id
                AND ($2::timestamptz IS NULL OR c.created_at >= $2)
                AND ($3::timestamptz IS NULL OR c.created_at <= $3)) AS visitors_period,
            (SELECT count(*)::int FROM referrals r
              WHERE r.affiliate_link_id = al.id) AS referral_count,
            (SELECT count(*)::int FROM referrals r
              JOIN client_subscriptions cs ON cs.client_user_id = r.referred_user_id
              WHERE r.affiliate_link_id = al.id AND cs.status = 'ativo') AS active_count,
            (SELECT coalesce(sum(ce.commission_cents), 0)::int
               FROM commission_entries ce
               JOIN referrals r ON r.referred_user_id = ce.referred_user_id
              WHERE r.affiliate_link_id = al.id
                AND ce.affiliate_user_id = al.owner_user_id) AS commission_cents
     FROM affiliate_links al
     WHERE al.owner_user_id = $1
     ORDER BY al.is_default DESC, (al.archived_at IS NOT NULL), al.created_at DESC`,
    [ownerUserId, from || null, to || null]
  );
  return rows;
}

module.exports = {
  findByCode,
  findDefaultByOwner,
  getOrCreateDefault,
  createCustom,
  createForOwner,
  countByOwner,
  setLabel,
  setArchived,
  listByOwner,
  listByOwnerWithStats,
};
