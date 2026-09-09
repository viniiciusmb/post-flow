'use strict';

const crypto = require('crypto');
const pool = require('../db/pool');

// O IP nunca é gravado. Ele entra num resumo irreversível junto com o
// navegador e um segredo da aplicação (sem o segredo, quem tivesse a tabela
// poderia testar IP por IP até achar qual gerou cada hash - a lista de IPs
// possíveis é pequena o suficiente pra isso).
function visitorHash(ip, userAgent) {
  const segredo = process.env.SESSION_SECRET || 'post-flow';
  return crypto
    .createHash('sha256')
    .update(`${segredo}|${ip || ''}|${userAgent || ''}`)
    .digest('hex')
    .slice(0, 32);
}

async function record({ affiliateLinkId, visitorHash: hash, landingPath, utmSource }) {
  await pool.query(
    `INSERT INTO affiliate_link_clicks (affiliate_link_id, visitor_hash, landing_path, utm_source)
     VALUES ($1, $2, $3, $4)`,
    [affiliateLinkId, hash || null, landingPath || null, utmSource || null]
  );
}

// Cliques e visitantes distintos de todos os links de um dono, no período.
async function summaryByOwner(ownerUserId, { from, to } = {}) {
  const { rows } = await pool.query(
    `SELECT count(c.id)::int AS clicks,
            count(DISTINCT c.visitor_hash)::int AS visitors
     FROM affiliate_link_clicks c
     JOIN affiliate_links al ON al.id = c.affiliate_link_id
     WHERE al.owner_user_id = $1
       AND ($2::timestamptz IS NULL OR c.created_at >= $2)
       AND ($3::timestamptz IS NULL OR c.created_at <= $3)`,
    [ownerUserId, from || null, to || null]
  );
  return { clicks: rows[0].clicks, visitors: rows[0].visitors };
}

// Cliques por dia, pro gráfico. Devolve só os dias que tiveram clique - quem
// desenha completa os buracos (o banco não sabe o fuso de quem está olhando).
async function dailyByOwner(ownerUserId, { from, to } = {}) {
  const { rows } = await pool.query(
    `SELECT date_trunc('day', c.created_at) AS dia, count(*)::int AS clicks
     FROM affiliate_link_clicks c
     JOIN affiliate_links al ON al.id = c.affiliate_link_id
     WHERE al.owner_user_id = $1
       AND ($2::timestamptz IS NULL OR c.created_at >= $2)
       AND ($3::timestamptz IS NULL OR c.created_at <= $3)
     GROUP BY 1
     ORDER BY 1`,
    [ownerUserId, from || null, to || null]
  );
  return rows.map((r) => ({ dia: r.dia, clicks: r.clicks }));
}

module.exports = { visitorHash, record, summaryByOwner, dailyByOwner };
