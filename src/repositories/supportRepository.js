// Leituras e escritas do suporte com IA.
//
// REGRA DESTE ARQUIVO: toda consulta que devolve dado de cliente recebe o
// clientUserId e filtra por ele no SQL. E isso que faz o papel de "RLS" pra
// IA: as ferramentas dela so chamam funcoes daqui, sempre com o id que veio da
// SESSAO (nunca de algo que a IA ou o cliente escreveu). Nao existe funcao
// aqui que busque video, cobranca ou postagem sem dono.
'use strict';

const pool = require('../db/pool');

// Dono de um video: o canal (video de canal tem client_user_id NULL) ou o
// proprio video (avulso/upload) - mesma regra de findByIdOwnedByClient.
const DONO_DO_VIDEO = 'coalesce(yc.client_user_id, sv.client_user_id)';

const COLUNAS_DO_VIDEO = `
  sv.id, sv.title, sv.status, sv.created_at, sv.updated_at, sv.duration_seconds, sv.input_type,
  sv.download_completed_at, sv.transcription_completed_at, sv.clip_selection_completed_at,
  sv.transcript_reused, sv.error_transient, sv.auto_retry_count, sv.auto_skipped_reason,
  sv.billing_block_reason, yc.channel_name,
  ct.status AS tx_status, ct.minutes_charged AS tx_minutes_charged, ct.bucket AS tx_bucket,
  ct.minutes_from_quota AS tx_minutes_from_quota, ct.minutes_from_extra AS tx_minutes_from_extra,
  ct.created_at AS tx_created_at,
  (SELECT count(*)::int FROM clips c WHERE c.source_video_id = sv.id AND c.status = 'ready') AS cortes_prontos,
  (SELECT count(*)::int FROM clips c WHERE c.source_video_id = sv.id) AS cortes_total,
  scr.minutes AS devolvido_minutos, scr.created_at AS devolvido_em`;

const JOINS_DO_VIDEO = `
  FROM source_videos sv
  LEFT JOIN youtube_channels yc ON yc.id = sv.youtube_channel_id
  LEFT JOIN credit_transactions ct ON ct.source_video_id = sv.id
  LEFT JOIN support_credit_refunds scr ON scr.source_video_id = sv.id`;

async function listVideosForClient(clientUserId, { limit = 15 } = {}) {
  const { rows } = await pool.query(
    `SELECT ${COLUNAS_DO_VIDEO} ${JOINS_DO_VIDEO}
     WHERE ${DONO_DO_VIDEO} = $1
     ORDER BY sv.created_at DESC
     LIMIT $2`,
    [clientUserId, Math.min(Math.max(Number(limit) || 15, 1), 30)]
  );
  return rows;
}

async function findVideoForClient(videoId, clientUserId) {
  const { rows } = await pool.query(
    `SELECT ${COLUNAS_DO_VIDEO} ${JOINS_DO_VIDEO}
     WHERE sv.id = $1 AND ${DONO_DO_VIDEO} = $2`,
    [videoId, clientUserId]
  );
  return rows[0] || null;
}

// Minutos de videos que o proprio cliente apagou. O registro de cobranca cai
// junto com o video (cascade), mas o livro de custo sobrevive - e a unica
// forma de explicar "usei 89 minutos e so vejo 28 na tela".
async function minutesOnDeletedVideos(clientUserId, { days = 30 } = {}) {
  const { rows } = await pool.query(
    `SELECT count(*)::int AS videos, coalesce(sum(ceil(video_seconds / 60.0)), 0)::int AS minutos
     FROM video_costs
     WHERE client_user_id = $1 AND source_video_id IS NULL AND narrated_video_id IS NULL
       AND origem = 'pipeline'
       AND occurred_at > now() - ($2 || ' days')::interval`,
    [clientUserId, String(days)]
  );
  return rows[0];
}

async function postingsSummaryForClient(clientUserId) {
  const { rows } = await pool.query(
    `SELECT ta.id, ta.display_name, ta.is_active, ta.auto_post_enabled,
            pss.paused, pss.mode, pss.videos_per_day,
            (SELECT count(*)::int FROM postings p WHERE p.tiktok_account_id = ta.id AND p.status = 'pending') AS na_fila,
            (SELECT min(p.scheduled_for) FROM postings p WHERE p.tiktok_account_id = ta.id AND p.status = 'pending') AS proxima,
            (SELECT max(p.posted_at) FROM postings p WHERE p.tiktok_account_id = ta.id AND p.status = 'posted') AS ultima_postagem,
            (SELECT count(*)::int FROM postings p WHERE p.tiktok_account_id = ta.id AND p.status = 'posted' AND p.posted_at > now() - interval '7 days') AS postados_7d,
            (SELECT count(*)::int FROM postings p WHERE p.tiktok_account_id = ta.id AND p.status = 'error' AND p.updated_at > now() - interval '7 days') AS erros_7d
     FROM tiktok_accounts ta
     LEFT JOIN posting_schedule_settings pss ON pss.tiktok_account_id = ta.id
     WHERE ta.client_user_id = $1
     ORDER BY ta.is_active DESC, ta.id`,
    [clientUserId]
  );
  return rows;
}

// Mensagens de erro de postagem dos ultimos 7 dias, por conta, so do cliente.
// Quem chama traduz em categoria antes de mostrar a IA - o texto cru nunca
// vai pra conversa.
async function recentPostingErrorsForClient(clientUserId) {
  const { rows } = await pool.query(
    `SELECT se.message, se.last_seen_at, p.tiktok_account_id
     FROM system_errors se
     JOIN postings p ON p.id::text = se.entity_id::text
     JOIN tiktok_accounts ta ON ta.id = p.tiktok_account_id
     WHERE se.entity_type = 'posting' AND ta.client_user_id = $1
       AND se.last_seen_at > now() - interval '7 days'
     ORDER BY se.last_seen_at DESC
     LIMIT 20`,
    [clientUserId]
  );
  return rows;
}

// --- conversas ---

async function createConversation(clientUserId) {
  const { rows } = await pool.query(
    'INSERT INTO support_conversations (client_user_id) VALUES ($1) RETURNING *',
    [clientUserId]
  );
  return rows[0];
}

async function findConversationForClient(conversationId, clientUserId) {
  const { rows } = await pool.query(
    'SELECT * FROM support_conversations WHERE id = $1 AND client_user_id = $2',
    [conversationId, clientUserId]
  );
  return rows[0] || null;
}

async function latestConversationForClient(clientUserId) {
  const { rows } = await pool.query(
    'SELECT * FROM support_conversations WHERE client_user_id = $1 ORDER BY updated_at DESC LIMIT 1',
    [clientUserId]
  );
  return rows[0] || null;
}

async function listMessages(conversationId) {
  const { rows } = await pool.query(
    'SELECT * FROM support_messages WHERE conversation_id = $1 ORDER BY id',
    [conversationId]
  );
  return rows;
}

async function addMessage(conversationId, { role, content, visibleText = null, inputTokens = 0, outputTokens = 0, costUsd = 0 }) {
  const { rows } = await pool.query(
    `INSERT INTO support_messages (conversation_id, role, content, visible_text, input_tokens, output_tokens, cost_usd)
     VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7) RETURNING *`,
    [conversationId, role, JSON.stringify(content), visibleText, inputTokens, outputTokens, costUsd]
  );
  await pool.query('UPDATE support_conversations SET updated_at = now() WHERE id = $1', [conversationId]);
  return rows[0];
}

// Mensagens que o CLIENTE escreveu (nao as de ferramenta) desde um instante -
// e o limite diario de uso.
async function countClientMessagesSince(clientUserId, since) {
  const { rows } = await pool.query(
    `SELECT count(*)::int AS n
     FROM support_messages m
     JOIN support_conversations c ON c.id = m.conversation_id
     WHERE c.client_user_id = $1 AND m.role = 'user' AND m.visible_text IS NOT NULL AND m.created_at >= $2`,
    [clientUserId, since]
  );
  return rows[0].n;
}

async function escalate(conversationId, clientUserId, summary) {
  const { rows } = await pool.query(
    `UPDATE support_conversations
     SET status = 'encaminhada', escalation_summary = $3, escalated_at = now(), updated_at = now()
     WHERE id = $1 AND client_user_id = $2
     RETURNING *`,
    [conversationId, clientUserId, summary]
  );
  return rows[0] || null;
}

// --- devolucoes ---

async function refundsInWindow(clientUserId, { hours }) {
  const { rows } = await pool.query(
    `SELECT count(*)::int AS quantidade, coalesce(sum(minutes), 0)::int AS minutos
     FROM support_credit_refunds
     WHERE client_user_id = $1 AND created_at > now() - ($2 || ' hours')::interval`,
    [clientUserId, String(hours)]
  );
  return rows[0];
}

// --- admin ---

async function listConversationsForAdmin({ status = null, limit = 100 } = {}) {
  const { rows } = await pool.query(
    `SELECT c.*, u.email, u.business_name,
            (SELECT count(*)::int FROM support_messages m WHERE m.conversation_id = c.id AND m.visible_text IS NOT NULL) AS mensagens,
            (SELECT coalesce(sum(m.cost_usd), 0) FROM support_messages m WHERE m.conversation_id = c.id) AS custo_usd,
            (SELECT coalesce(sum(r.minutes), 0)::int FROM support_credit_refunds r WHERE r.conversation_id = c.id) AS minutos_devolvidos,
            (SELECT m.visible_text FROM support_messages m WHERE m.conversation_id = c.id AND m.role = 'user' AND m.visible_text IS NOT NULL ORDER BY m.id LIMIT 1) AS primeira_mensagem
     FROM support_conversations c
     JOIN users u ON u.id = c.client_user_id
     WHERE ($1::text IS NULL OR c.status = $1)
     ORDER BY c.updated_at DESC
     LIMIT $2`,
    [status, limit]
  );
  return rows;
}

async function findConversationForAdmin(conversationId) {
  const { rows } = await pool.query(
    `SELECT c.*, u.email, u.business_name FROM support_conversations c JOIN users u ON u.id = c.client_user_id WHERE c.id = $1`,
    [conversationId]
  );
  return rows[0] || null;
}

async function listRefundsForConversation(conversationId) {
  const { rows } = await pool.query(
    'SELECT * FROM support_credit_refunds WHERE conversation_id = $1 ORDER BY id',
    [conversationId]
  );
  return rows;
}

async function setConversationStatus(conversationId, status) {
  const { rows } = await pool.query(
    'UPDATE support_conversations SET status = $2, updated_at = now() WHERE id = $1 RETURNING *',
    [conversationId, status]
  );
  return rows[0] || null;
}

module.exports = {
  listVideosForClient,
  findVideoForClient,
  minutesOnDeletedVideos,
  postingsSummaryForClient,
  recentPostingErrorsForClient,
  createConversation,
  findConversationForClient,
  latestConversationForClient,
  listMessages,
  addMessage,
  countClientMessagesSince,
  escalate,
  refundsInWindow,
  listConversationsForAdmin,
  findConversationForAdmin,
  listRefundsForConversation,
  setConversationStatus,
};
