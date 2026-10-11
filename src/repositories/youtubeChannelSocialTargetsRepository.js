'use strict';

const pool = require('../db/pool');

// Em quais contas de Instagram/Facebook/Threads/... os cortes de um canal do
// YouTube são publicados (migration 111). O TikTok continua na coluna
// youtube_channels.tiktok_account_id.

// Contas ATIVAS ligadas ao canal, com a configuração de publicação de cada uma.
async function contasDoCanal(youtubeChannelId) {
  const { rows } = await pool.query(
    `SELECT sa.*, COALESCE(s.auto_post_enabled, true) AS auto_post_enabled
       FROM youtube_channel_social_targets t
       JOIN social_accounts sa ON sa.id = t.social_account_id
       LEFT JOIN social_posting_settings s ON s.social_account_id = sa.id
      WHERE t.youtube_channel_id = $1 AND sa.disconnected_at IS NULL
      ORDER BY sa.network, sa.id`,
    [youtubeChannelId]
  );
  return rows;
}

// { canalId: [ids das contas] } de todos os canais do cliente, pra tela.
async function mapaDoCliente(clientUserId) {
  const { rows } = await pool.query(
    `SELECT t.youtube_channel_id, t.social_account_id
       FROM youtube_channel_social_targets t
       JOIN youtube_channels yc ON yc.id = t.youtube_channel_id
       JOIN social_accounts sa ON sa.id = t.social_account_id
      WHERE yc.client_user_id = $1 AND sa.disconnected_at IS NULL`,
    [clientUserId]
  );
  const mapa = new Map();
  for (const r of rows) {
    const k = Number(r.youtube_channel_id);
    if (!mapa.has(k)) mapa.set(k, []);
    mapa.get(k).push(Number(r.social_account_id));
  }
  return mapa;
}

// Troca a lista inteira de contas do canal. Quem chama já conferiu que o canal
// e as contas são do cliente. Devolve os ids que entraram agora (pra
// enfileirar os cortes prontos só nessas).
async function definir(youtubeChannelId, accountIds) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: antes } = await client.query(
      'SELECT social_account_id FROM youtube_channel_social_targets WHERE youtube_channel_id = $1',
      [youtubeChannelId]
    );
    await client.query(
      'DELETE FROM youtube_channel_social_targets WHERE youtube_channel_id = $1 AND NOT (social_account_id = ANY($2::bigint[]))',
      [youtubeChannelId, accountIds]
    );
    for (const id of accountIds) {
      await client.query(
        'INSERT INTO youtube_channel_social_targets (youtube_channel_id, social_account_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [youtubeChannelId, id]
      );
    }
    await client.query('COMMIT');
    const tinha = new Set(antes.map((r) => Number(r.social_account_id)));
    return accountIds.filter((id) => !tinha.has(Number(id)));
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { contasDoCanal, mapaDoCliente, definir };
