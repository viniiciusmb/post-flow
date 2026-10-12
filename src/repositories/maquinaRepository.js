'use strict';

// "O que a máquina está fazendo agora" para UM cliente: a tela Início do painel
// novo desenha a linha de produção a partir daqui.
//
// Tudo é leitura do estado real (status e carimbos que o pipeline já grava).
// Nada aqui é animação inventada: se a tela mostra um vídeo em "Transcrevendo",
// é porque source_videos.status diz isso neste instante.
//
// Toda consulta filtra pelo dono no SQL. O vídeo de canal tem dono pelo canal
// (client_user_id do vídeo é NULL), por isso o coalesce - o mesmo critério de
// sourceVideosRepository.listForClient.

const pool = require('../db/pool');
const { RECEBE_CORTES } = require('./livesRepository');

// clientUserId NULL = o sistema inteiro (Início do admin).
const DONO_DO_VIDEO = '($1::bigint IS NULL OR coalesce(yc.client_user_id, sv.client_user_id) = $1)';
const DONO = (col) => `($1::bigint IS NULL OR ${col} = $1)`;
const ETAPAS_ATIVAS = "('downloading', 'transcribing', 'selecting_clips', 'cutting')";

async function canais(clientUserId) {
  const { rows } = await pool.query(
    `SELECT count(*) FILTER (WHERE is_active)::int AS ativos,
            count(*)::int AS total,
            max(last_check_at) AS ultima_checagem
       FROM youtube_channels WHERE ${DONO('client_user_id')}`,
    [clientUserId]
  );
  const { rows: avatares } = await pool.query(
    `SELECT id, channel_name, avatar_url FROM youtube_channels
      WHERE ${DONO('client_user_id')} AND is_active ORDER BY last_check_at DESC NULLS LAST, id LIMIT 5`,
    [clientUserId]
  );
  return { ...rows[0], avatares };
}

// Quantos vídeos em cada estação. "Esperando" é só o que vai rodar sozinho:
// detected COM motivo (limite de duração, mais recente, aguardando estilo)
// foi parado de propósito e não está na linha.
async function contagemPorEtapa(clientUserId) {
  const { rows } = await pool.query(
    `SELECT count(*) FILTER (WHERE sv.status = 'detected' AND sv.auto_skipped_reason IS NULL)::int AS esperando,
            count(*) FILTER (WHERE sv.status = 'downloading')::int AS baixando,
            count(*) FILTER (WHERE sv.status = 'transcribing')::int AS transcrevendo,
            count(*) FILTER (WHERE sv.status = 'selecting_clips')::int AS escolhendo,
            count(*) FILTER (WHERE sv.status = 'cutting')::int AS cortando,
            count(*) FILTER (WHERE sv.status IN ('aguardando_creditos', 'aguardando_conexao'))::int AS bloqueados,
            count(*) FILTER (WHERE sv.status = 'paused')::int AS pausados
       FROM source_videos sv
       LEFT JOIN youtube_channels yc ON yc.id = sv.youtube_channel_id
      WHERE ${DONO_DO_VIDEO}
        AND sv.status IN ('detected', 'downloading', 'transcribing', 'selecting_clips', 'cutting',
                          'aguardando_creditos', 'aguardando_conexao', 'paused')`,
    [clientUserId]
  );
  return rows[0];
}

// Vídeos na linha agora, e os que TERMINARAM há pouco: o último corte de um
// vídeo fica pronto no mesmo instante em que o vídeo sai da linha, e sem esta
// janela de 3 min a tela nunca mostraria esse corte indo pra fila.
async function emProcessamento(clientUserId) {
  const { rows } = await pool.query(
    `SELECT sv.id, sv.title, sv.thumbnail_url, sv.status, sv.input_type, sv.duration_seconds,
            sv.processing_started_at, sv.download_completed_at, sv.transcription_completed_at,
            sv.clip_selection_completed_at, sv.transcript_reused, sv.download_egress_type,
            yc.channel_name,
            (SELECT coalesce(nullif(u.business_name, ''), u.email) FROM users u
              WHERE u.id = coalesce(yc.client_user_id, sv.client_user_id)) AS cliente,
            (SELECT coalesce(json_agg(json_build_object(
                       'id', c.id, 's', c.status, 'p', c.render_progress_percent,
                       't', c.title, 'capa', c.thumbnail_path IS NOT NULL) ORDER BY c.id), '[]'::json)
               FROM clips c WHERE c.source_video_id = sv.id) AS cortes,
            -- Pra onde os cortes deste vídeo vão, conta por conta ("rede:id").
            -- A MESMA regra de quem cria as postagens: vídeo de canal vai pra
            -- conta do TikTok do canal; vídeo avulso, pras escolhidas no envio
            -- (destinoDoVideoService). Outras redes: as contas ligadas ao canal
            -- com "publicar sozinho" ligado (filaSocialService.corteFicouPronto).
            ARRAY(
              SELECT DISTINCT d FROM (
                SELECT 'tiktok:' || yc.tiktok_account_id AS d
                 WHERE sv.youtube_channel_id IS NOT NULL AND yc.tiktok_account_id IS NOT NULL
                UNION ALL
                SELECT 'tiktok:' || t.tiktok_account_id FROM source_video_tiktok_targets t
                 WHERE sv.youtube_channel_id IS NULL AND t.source_video_id = sv.id
                UNION ALL
                SELECT sa.network || ':' || sa.id FROM youtube_channel_social_targets st
                  JOIN social_accounts sa ON sa.id = st.social_account_id AND sa.disconnected_at IS NULL
                  LEFT JOIN social_posting_settings sps ON sps.social_account_id = sa.id
                 WHERE st.youtube_channel_id = sv.youtube_channel_id
                   AND COALESCE(sps.auto_post_enabled, true)
              ) destinos
            ) AS destinos
       FROM source_videos sv
       LEFT JOIN youtube_channels yc ON yc.id = sv.youtube_channel_id
      WHERE ${DONO_DO_VIDEO}
        AND (sv.status IN ${ETAPAS_ATIVAS}
             OR (sv.status = 'ready' AND sv.updated_at > now() - interval '3 minutes'))
      ORDER BY (sv.status = 'ready') ASC, sv.processing_started_at ASC NULLS LAST, sv.id
      LIMIT 5`,
    [clientUserId]
  );
  return rows;
}

// Próximos da fila de espera (os que ainda não começaram), pra estação de
// entrada não ser só um número.
async function proximosNaLinha(clientUserId) {
  const { rows } = await pool.query(
    `SELECT sv.id, sv.title, sv.thumbnail_url, yc.channel_name
       FROM source_videos sv
       LEFT JOIN youtube_channels yc ON yc.id = sv.youtube_channel_id
      WHERE ${DONO_DO_VIDEO} AND sv.status = 'detected' AND sv.auto_skipped_reason IS NULL
      ORDER BY sv.created_at ASC
      LIMIT 3`,
    [clientUserId]
  );
  return rows;
}

async function lives(clientUserId) {
  const { rows: seguindo } = await pool.query(
    `SELECT count(DISTINCT live_channel_id)::int AS n FROM live_channel_follows WHERE ${DONO('user_id')} AND is_active`,
    [clientUserId]
  );
  const { rows: aoVivo } = await pool.query(
    `SELECT c.id, coalesce(c.display_name, c.login) AS nome, c.profile_image_url, c.platform,
            c.live_started_at, c.stream_title, s.id AS sessao_id, s.started_at AS gravando_desde,
            s.recorded_seconds, s.triaged_until,
            (SELECT count(*)::int FROM live_clips lc
              WHERE lc.session_id = s.id AND ${DONO('lc.user_id')} AND lc.status = 'pronto') AS cortes_prontos,
            (SELECT count(*)::int FROM live_clips lc
              WHERE lc.session_id = s.id AND ${DONO('lc.user_id')} AND lc.status IN ('na_fila', 'renderizando')) AS cortes_produzindo,
            -- Até onde a fala já virou texto, e quantos trechos a IA ainda
            -- está julgando: é o que a linha do tempo da live desenha.
            (SELECT max(t.end_offset) FROM live_transcripts t
              WHERE t.session_id = s.id AND t.status IN ('feito', 'silencio')) AS transcrito_ate,
            (SELECT count(*)::int FROM live_candidates ca
              WHERE ca.session_id = s.id AND ca.status = 'pendente') AS candidatos,
            (SELECT coalesce(json_agg(json_build_object(
                       'id', lc.id, 's', lc.status, 'p', lc.render_progress,
                       'i', lc.start_offset, 'f', lc.end_offset, 't', lc.title,
                       'capa', lc.thumbnail_path IS NOT NULL) ORDER BY lc.start_offset), '[]'::json)
               FROM (SELECT * FROM live_clips lc0
                      WHERE lc0.session_id = s.id AND ${DONO('lc0.user_id')}
                      ORDER BY lc0.created_at DESC LIMIT 16) lc) AS cortes
       FROM live_channels c
       JOIN live_sessions s ON s.live_channel_id = c.id AND s.status = 'gravando'
      WHERE EXISTS (SELECT 1 FROM live_channel_follows f
                     WHERE f.live_channel_id = c.id AND ${DONO('f.user_id')} AND ${RECEBE_CORTES})
      ORDER BY s.started_at`,
    [clientUserId]
  );
  // Cortes de live na linha de corte (de qualquer sessão, inclusive uma que já
  // acabou e ainda está terminando de renderizar).
  const { rows: cortando } = await pool.query(
    `SELECT count(*)::int AS n FROM live_clips
      WHERE ${DONO('user_id')} AND status IN ('na_fila', 'renderizando')`,
    [clientUserId]
  );
  const { rows: canais } = await pool.query(
    `SELECT c.id, coalesce(c.display_name, c.login) AS nome, c.profile_image_url, c.platform, c.is_live
       FROM live_channels c
      WHERE EXISTS (SELECT 1 FROM live_channel_follows f
                     WHERE f.live_channel_id = c.id AND ${DONO('f.user_id')} AND f.is_active)
      ORDER BY c.is_live DESC, c.id
      LIMIT 6`,
    [clientUserId]
  );
  // Corte de live não entra em fila sozinho: vai pro Feed de cortes, onde a
  // pessoa escolhe o que publicar. É o "destino" dele na saída da linha.
  const { rows: feed } = await pool.query(
    `SELECT count(*)::int AS n,
            (SELECT coalesce(json_agg(x ORDER BY x.ready_at DESC), '[]'::json) FROM (
               SELECT id, title, ready_at, thumbnail_path IS NOT NULL AS capa FROM live_clips
                WHERE ${DONO('user_id')} AND status = 'pronto' ORDER BY ready_at DESC LIMIT 5) x) AS ultimos
       FROM live_clips WHERE ${DONO('user_id')} AND status = 'pronto'`,
    [clientUserId]
  );
  return { seguindo: seguindo[0].n, aoVivo, canais, cortesProduzindo: cortando[0].n, feed: feed[0] };
}

// Fila de publicação de TODAS as redes, na ordem em que vão sair.
async function filaDePublicacao(clientUserId) {
  const { rows: proximas } = await pool.query(
    `SELECT * FROM (
       SELECT 'tiktok' AS rede, p.id, p.scheduled_for, ta.display_name AS conta, ta.avatar_url AS avatar,
              c.title AS titulo, c.id AS clip_id, c.live_clip_id, (c.thumbnail_path IS NOT NULL) AS tem_capa
         FROM postings p
         JOIN videos v ON v.id = p.video_id
         JOIN cortes_da_fila c ON c.video_id = v.id
         JOIN tiktok_accounts ta ON ta.id = p.tiktok_account_id
        WHERE ${DONO('ta.client_user_id')} AND p.status = 'pending'
       UNION ALL
       SELECT sa.network, sp.id, sp.scheduled_for, coalesce(sa.username, sa.display_name), sa.avatar_url,
              coalesce(sp.title, cl.title, lc.title), cl.id, lc.id,
              (coalesce(cl.thumbnail_path, lc.thumbnail_path) IS NOT NULL)
         FROM social_postings sp
         JOIN social_accounts sa ON sa.id = sp.social_account_id
         LEFT JOIN clips cl ON cl.id = sp.clip_id
         LEFT JOIN live_clips lc ON lc.id = sp.live_clip_id
        WHERE ${DONO('sp.client_user_id')} AND sp.status = 'pending'
     ) x
     ORDER BY scheduled_for ASC NULLS LAST, id
     LIMIT 6`,
    [clientUserId]
  );
  const { rows: totais } = await pool.query(
    `SELECT
       (SELECT count(*)::int FROM postings p JOIN tiktok_accounts ta ON ta.id = p.tiktok_account_id
         WHERE ${DONO('ta.client_user_id')} AND p.status = 'pending')
     + (SELECT count(*)::int FROM social_postings WHERE ${DONO('client_user_id')} AND status = 'pending') AS na_fila,
       (SELECT count(*)::int FROM postings p JOIN tiktok_accounts ta ON ta.id = p.tiktok_account_id
         WHERE ${DONO('ta.client_user_id')} AND p.status = 'processing')
     + (SELECT count(*)::int FROM social_postings WHERE ${DONO('client_user_id')} AND status IN ('sending', 'processing')) AS publicando`,
    [clientUserId]
  );
  return { proximas, ...totais[0] };
}

// Uma fila por CONTA conectada (mesmo vazia: é pra lá que os cortes vão).
// Quem agrupa por rede, na visão do sistema inteiro, é o controller.
async function filasPorConta(clientUserId, desde) {
  const { rows: contas } = await pool.query(
    `SELECT 'tiktok' AS rede, id, display_name AS nome, avatar_url AS avatar FROM tiktok_accounts
      WHERE ${DONO('client_user_id')} AND is_active
     UNION ALL
     SELECT network, id, coalesce(username, display_name), avatar_url FROM social_accounts
      WHERE ${DONO('client_user_id')} AND disconnected_at IS NULL
     ORDER BY 1, 2`,
    [clientUserId]
  );
  const { rows: numeros } = await pool.query(
    `SELECT rede, conta_id,
            count(*) FILTER (WHERE status = 'pending')::int AS na_fila,
            count(*) FILTER (WHERE status IN ('processing', 'sending'))::int AS publicando,
            count(*) FILTER (WHERE status = 'posted' AND posted_at >= $2)::int AS publicados_hoje
       FROM (
         SELECT 'tiktok' AS rede, p.tiktok_account_id AS conta_id, p.status, p.posted_at
           FROM postings p JOIN tiktok_accounts ta ON ta.id = p.tiktok_account_id
          WHERE ${DONO('ta.client_user_id')} AND ta.is_active AND (p.status IN ('pending', 'processing') OR p.posted_at >= $2)
         UNION ALL
         SELECT sa.network, sa.id, sp.status, sp.posted_at
           FROM social_postings sp JOIN social_accounts sa ON sa.id = sp.social_account_id
          WHERE ${DONO('sp.client_user_id')} AND sa.disconnected_at IS NULL
            AND (sp.status IN ('pending', 'sending', 'processing') OR sp.posted_at >= $2)
       ) x
      GROUP BY rede, conta_id`,
    [clientUserId, desde]
  );
  const { rows: proximas } = await pool.query(
    `SELECT * FROM (
       SELECT y.*, row_number() OVER (PARTITION BY y.rede, y.conta_id ORDER BY y.scheduled_for ASC NULLS LAST, y.id) AS pos
         FROM (
           SELECT 'tiktok' AS rede, p.tiktok_account_id AS conta_id, p.id, p.scheduled_for,
                  c.title AS titulo, c.id AS clip_id, c.live_clip_id, (c.thumbnail_path IS NOT NULL) AS tem_capa
             FROM postings p
             JOIN videos v ON v.id = p.video_id
             JOIN cortes_da_fila c ON c.video_id = v.id
             JOIN tiktok_accounts ta ON ta.id = p.tiktok_account_id
            WHERE ${DONO('ta.client_user_id')} AND ta.is_active AND p.status = 'pending'
           UNION ALL
           SELECT sa.network, sa.id, sp.id, sp.scheduled_for,
                  coalesce(sp.title, cl.title, lc.title), cl.id, lc.id,
                  (coalesce(cl.thumbnail_path, lc.thumbnail_path) IS NOT NULL)
             FROM social_postings sp
             JOIN social_accounts sa ON sa.id = sp.social_account_id
             LEFT JOIN clips cl ON cl.id = sp.clip_id
             LEFT JOIN live_clips lc ON lc.id = sp.live_clip_id
            WHERE ${DONO('sp.client_user_id')} AND sa.disconnected_at IS NULL AND sp.status = 'pending'
         ) y
     ) z WHERE pos <= 5
     ORDER BY rede, conta_id, pos`,
    [clientUserId]
  );
  return { contas, numeros, proximas };
}

async function publicadosDesde(clientUserId, desde) {
  const { rows } = await pool.query(
    `SELECT
       (SELECT count(*)::int FROM postings p JOIN tiktok_accounts ta ON ta.id = p.tiktok_account_id
         WHERE ${DONO('ta.client_user_id')} AND p.status = 'posted' AND p.posted_at >= $2)
     + (SELECT count(*)::int FROM social_postings
         WHERE ${DONO('client_user_id')} AND status = 'posted' AND posted_at >= $2) AS n`,
    [clientUserId, desde]
  );
  return rows[0].n;
}

// O registro da máquina: o que aconteceu nas últimas 72h, a partir dos
// carimbos que o pipeline já grava em cada etapa. Cada linha é um fato.
async function registro(clientUserId, { limite = 16 } = {}) {
  const { rows } = await pool.query(
    `WITH meus AS (
       SELECT sv.* , yc.channel_name
         FROM source_videos sv
         LEFT JOIN youtube_channels yc ON yc.id = sv.youtube_channel_id
        WHERE ${DONO_DO_VIDEO} AND sv.created_at > now() - interval '7 days'
     )
     SELECT * FROM (
       SELECT 'detectado' AS tipo, created_at AS em, title AS titulo, channel_name AS extra, NULL::int AS n FROM meus
       UNION ALL
       SELECT 'baixado', download_completed_at, title, NULL, NULL FROM meus WHERE download_completed_at IS NOT NULL
       UNION ALL
       SELECT 'transcrito', transcription_completed_at, title, NULL, NULL FROM meus WHERE transcription_completed_at IS NOT NULL
       UNION ALL
       SELECT 'escolhido', m.clip_selection_completed_at, m.title, NULL,
              (SELECT count(*)::int FROM clips c WHERE c.source_video_id = m.id)
         FROM meus m WHERE m.clip_selection_completed_at IS NOT NULL
       UNION ALL
       SELECT 'corte_pronto', c.updated_at, c.title, m.title, NULL
         FROM clips c JOIN meus m ON m.id = c.source_video_id WHERE c.status = 'ready'
       UNION ALL
       SELECT 'publicado', p.posted_at, cf.title, 'tiktok:' || coalesce(ta.display_name, ''), NULL
         FROM postings p
         JOIN tiktok_accounts ta ON ta.id = p.tiktok_account_id
         JOIN videos v ON v.id = p.video_id
         JOIN cortes_da_fila cf ON cf.video_id = v.id
        WHERE ${DONO('ta.client_user_id')} AND p.status = 'posted' AND p.posted_at > now() - interval '72 hours'
       UNION ALL
       SELECT 'publicado', sp.posted_at, coalesce(sp.title, cl.title, lc.title),
              sa.network || ':' || coalesce(sa.username, sa.display_name, ''), NULL
         FROM social_postings sp
         JOIN social_accounts sa ON sa.id = sp.social_account_id
         LEFT JOIN clips cl ON cl.id = sp.clip_id
         LEFT JOIN live_clips lc ON lc.id = sp.live_clip_id
        WHERE ${DONO('sp.client_user_id')} AND sp.status = 'posted' AND sp.posted_at > now() - interval '72 hours'
       UNION ALL
       SELECT 'live_gravando', s.started_at, s.title, coalesce(ch.display_name, ch.login), NULL
         FROM live_sessions s
         JOIN live_channels ch ON ch.id = s.live_channel_id
        WHERE s.started_at > now() - interval '72 hours'
          AND EXISTS (SELECT 1 FROM live_channel_follows f
                       WHERE f.live_channel_id = ch.id AND ${DONO('f.user_id')} AND f.is_active)
       UNION ALL
       SELECT 'live_corte', lc.ready_at, lc.title, coalesce(ch.display_name, ch.login), NULL
         FROM live_clips lc JOIN live_channels ch ON ch.id = lc.live_channel_id
        WHERE ${DONO('lc.user_id')} AND lc.status = 'pronto' AND lc.ready_at > now() - interval '72 hours'
     ) eventos
     WHERE em > now() - interval '72 hours'
     ORDER BY em DESC
     LIMIT $2`,
    [clientUserId, limite]
  );
  return rows;
}

// Resumo pra barra do topo e pro menu (toda tela consulta): uma ida ao banco,
// só contagens. A tela Início continua com o estado completo.
async function resumo(clientUserId) {
  const { rows } = await pool.query(
    `SELECT
       (SELECT count(*)::int FROM source_videos sv LEFT JOIN youtube_channels yc ON yc.id = sv.youtube_channel_id
         WHERE ${DONO_DO_VIDEO} AND sv.status IN ${ETAPAS_ATIVAS}) AS na_linha,
       (SELECT count(*)::int FROM source_videos sv LEFT JOIN youtube_channels yc ON yc.id = sv.youtube_channel_id
         WHERE ${DONO_DO_VIDEO} AND sv.status = 'detected' AND sv.auto_skipped_reason IS NULL) AS esperando,
       (SELECT count(*)::int FROM live_channels c
          JOIN live_sessions s ON s.live_channel_id = c.id AND s.status = 'gravando'
         WHERE EXISTS (SELECT 1 FROM live_channel_follows f
                        WHERE f.live_channel_id = c.id AND ${DONO('f.user_id')} AND ${RECEBE_CORTES})) AS lives_gravando,
       (SELECT count(*)::int FROM postings p JOIN tiktok_accounts ta ON ta.id = p.tiktok_account_id
         WHERE ${DONO('ta.client_user_id')} AND p.status = 'pending')
     + (SELECT count(*)::int FROM social_postings WHERE ${DONO('client_user_id')} AND status = 'pending') AS na_fila,
       (SELECT count(*)::int FROM postings p JOIN tiktok_accounts ta ON ta.id = p.tiktok_account_id
         WHERE ${DONO('ta.client_user_id')} AND p.status = 'processing')
     + (SELECT count(*)::int FROM social_postings WHERE ${DONO('client_user_id')} AND status IN ('sending', 'processing')) AS publicando,
       (SELECT count(*)::int FROM youtube_channels WHERE ${DONO('client_user_id')} AND is_active)
     + (SELECT count(DISTINCT live_channel_id)::int FROM live_channel_follows WHERE ${DONO('user_id')} AND is_active) AS fontes`,
    [clientUserId]
  );
  return rows[0];
}

module.exports = {
  resumo,
  canais,
  contagemPorEtapa,
  emProcessamento,
  proximosNaLinha,
  lives,
  filaDePublicacao,
  filasPorConta,
  publicadosDesde,
  registro,
};
