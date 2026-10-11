'use strict';

const pool = require('../db/pool');

// Fila de publicação no Instagram e no Facebook (migration 110). Ver
// socialPostingService para o ciclo de vida.

function colunaDoCorte(tipo) {
  return tipo === 'live' ? 'live_clip_id' : 'clip_id';
}

// Põe o corte na fila da conta. Se ele já está lá:
//  - com erro: volta pra fila numa tentativa NOVA (o cliente pediu de novo, e
//    sabemos que a anterior não saiu);
//  - em qualquer outro estado: não mexe, e devolve como está.
// Devolve { linha, resultado: 'enfileirado' | 'ja_na_fila' | 'ja_publicado' }.
async function enfileirar({ clientUserId, socialAccountId, tipo, clipId, caption }) {
  const coluna = colunaDoCorte(tipo);
  const { rows } = await pool.query(
    `INSERT INTO social_postings (client_user_id, social_account_id, ${coluna}, caption)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (social_account_id, ${coluna}) WHERE ${coluna} IS NOT NULL DO UPDATE SET
       status = 'pending',
       tentativa = social_postings.tentativa + 1,
       falhas_de_envio = 0,
       proxima_tentativa_em = NULL,
       outstand_media_url = NULL,
       outstand_post_id = NULL,
       error_message = NULL,
       caption = EXCLUDED.caption,
       updated_at = now()
     WHERE social_postings.status = 'error'
     RETURNING *`,
    [clientUserId, socialAccountId, clipId, caption || null]
  );
  if (rows[0]) return { linha: rows[0], resultado: 'enfileirado' };
  const { rows: existentes } = await pool.query(
    `SELECT * FROM social_postings WHERE social_account_id = $1 AND ${coluna} = $2`,
    [socialAccountId, clipId]
  );
  const existente = existentes[0];
  return { linha: existente, resultado: existente.status === 'posted' ? 'ja_publicado' : 'ja_na_fila' };
}

// Pega a próxima postagem pra enviar, marcando-a como 'sending' na MESMA
// instrução: dois trabalhadores nunca pegam a mesma (SKIP LOCKED).
async function pegarParaEnviar() {
  const { rows } = await pool.query(
    `UPDATE social_postings SET status = 'sending', updated_at = now()
      WHERE id = (
        SELECT id FROM social_postings
         WHERE status = 'pending' AND (proxima_tentativa_em IS NULL OR proxima_tentativa_em <= now())
         ORDER BY created_at, id
         LIMIT 1
         FOR UPDATE SKIP LOCKED)
      RETURNING *`
  );
  return rows[0] || null;
}

// Dados que o envio precisa: a conta na Outstand e o arquivo do corte.
async function detalhesParaEnviar(id) {
  const { rows } = await pool.query(
    `SELECT sp.*, sa.network, sa.outstand_account_id, sa.disconnected_at,
            COALESCE(c.local_clip_path, k.local_clip_path) AS caminho
       FROM social_postings sp
       JOIN social_accounts sa ON sa.id = sp.social_account_id
       LEFT JOIN clips c ON c.id = sp.clip_id
       LEFT JOIN live_clips k ON k.id = sp.live_clip_id
      WHERE sp.id = $1`,
    [id]
  );
  return rows[0] || null;
}

async function guardarMidia(id, url) {
  await pool.query(`UPDATE social_postings SET outstand_media_url = $2, updated_at = now() WHERE id = $1`, [id, url]);
}

async function marcarEnviada(id, outstandPostId) {
  await pool.query(
    `UPDATE social_postings SET status = 'processing', outstand_post_id = $2, sent_at = now(), updated_at = now() WHERE id = $1`,
    [id, outstandPostId]
  );
}

// Falha passageira no envio: volta pra fila com espera, na MESMA tentativa
// (a chave de idempotência se repete, então se a Outstand chegou a criar a
// publicação, ela devolve a mesma em vez de criar outra).
async function adiarEnvio(id, esperaMinutos, mensagem) {
  await pool.query(
    `UPDATE social_postings
        SET status = 'pending', falhas_de_envio = falhas_de_envio + 1,
            proxima_tentativa_em = now() + make_interval(mins => $2::int),
            error_message = $3, updated_at = now()
      WHERE id = $1`,
    [id, esperaMinutos, mensagem]
  );
}

async function marcarPublicada(id, url) {
  await pool.query(
    `UPDATE social_postings SET status = 'posted', platform_post_url = $2, posted_at = now(), error_message = NULL, updated_at = now() WHERE id = $1`,
    [id, url || null]
  );
}

async function marcarErro(id, mensagem) {
  await pool.query(`UPDATE social_postings SET status = 'error', error_message = $2, updated_at = now() WHERE id = $1`, [id, mensagem]);
}

async function emAndamento() {
  const { rows } = await pool.query(
    `SELECT sp.*, sa.outstand_account_id
       FROM social_postings sp JOIN social_accounts sa ON sa.id = sp.social_account_id
      WHERE sp.status = 'processing' ORDER BY sp.sent_at`
  );
  return rows;
}

// 'sending' parado há muito tempo = o processo caiu no meio do envio. Volta pra
// fila na mesma tentativa (mesma chave de idempotência: se a publicação chegou a
// ser criada, a Outstand devolve a mesma).
async function devolverEnviosTravados(minutos = 20) {
  const { rowCount } = await pool.query(
    `UPDATE social_postings SET status = 'pending', updated_at = now()
      WHERE status = 'sending' AND updated_at < now() - make_interval(mins => $1::int)`,
    [minutos]
  );
  return rowCount;
}

// "Tentar de novo" do painel de erros do admin: só mexe em quem está com erro,
// e numa tentativa nova (a anterior sabidamente não saiu).
async function devolverParaFila(id) {
  const { rowCount } = await pool.query(
    `UPDATE social_postings
        SET status = 'pending', tentativa = tentativa + 1, falhas_de_envio = 0, proxima_tentativa_em = NULL,
            outstand_media_url = NULL, outstand_post_id = NULL, error_message = NULL, updated_at = now()
      WHERE id = $1 AND status = 'error'`,
    [id]
  );
  return rowCount > 0;
}

module.exports = {
  devolverParaFila,
  enfileirar,
  pegarParaEnviar,
  detalhesParaEnviar,
  guardarMidia,
  marcarEnviada,
  adiarEnvio,
  marcarPublicada,
  marcarErro,
  emAndamento,
  devolverEnviosTravados,
};
