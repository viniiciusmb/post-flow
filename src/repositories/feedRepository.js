'use strict';

const pool = require('../db/pool');

// Cortes prontos do cliente pro Feed de cortes: os do YouTube (`clips`) e os de
// LIVE (`live_clips`) numa lista só.
//
// Paginação por cursor, não por número de página: o feed fica aberto enquanto
// cortes novos ficam prontos, e uma página por OFFSET repetiria ou pularia
// cortes cada vez que um novo entrasse no topo. O cursor é o trio
// (instante em microssegundos, tipo, id): os dois tipos podem ter o mesmo id e
// o mesmo instante, e só o trio inteiro é único. Microssegundos porque Date do
// JavaScript corta em milissegundos, e comparar com um instante arredondado
// pularia ou repetiria cortes criados no mesmo milissegundo.
//
// O dono é sempre o da sessão, nunca um id que veio da tela: corte do YouTube
// pelo dono do vídeo-fonte, corte de live pelo user_id do corte.
const CORTES = `
  SELECT 'youtube'::text AS tipo, c.id, c.title AS titulo, c.description AS legenda,
         c.start_seconds AS inicio, c.end_seconds AS fim,
         c.created_at AS quando, (extract(epoch FROM c.created_at) * 1000000)::bigint AS us,
         c.local_clip_path, (c.thumbnail_path IS NOT NULL) AS tem_capa,
         sv.title AS origem_titulo, sv.youtube_channel_id AS canal_id,
         yc.channel_name AS canal_nome, yc.avatar_url AS canal_avatar, NULL::text AS plataforma,
         (l.clip_id IS NOT NULL) AS gostei,
         COALESCE((
           SELECT json_agg(t.x ORDER BY t.ordem) FROM (
             SELECT json_build_object('rede', 'tiktok', 'accountId', p.tiktok_account_id, 'status', p.status,
                                      'scheduledFor', p.scheduled_for, 'postedAt', p.posted_at, 'url', NULL,
                                      'erro', NULL) AS x, p.id AS ordem
               FROM videos v JOIN postings p ON p.video_id = v.id
              WHERE v.clip_id = c.id
             UNION ALL
             SELECT json_build_object('rede', sa.network, 'accountId', sp.social_account_id, 'status', sp.status,
                                      'scheduledFor', NULL, 'postedAt', sp.posted_at, 'url', sp.platform_post_url,
                                      'erro', sp.error_message), 1000000000000 + sp.id
               FROM social_postings sp JOIN social_accounts sa ON sa.id = sp.social_account_id
              WHERE sp.clip_id = c.id
           ) t
         ), '[]') AS postagens
    FROM clips c
    JOIN source_videos sv ON sv.id = c.source_video_id
    LEFT JOIN youtube_channels yc ON yc.id = sv.youtube_channel_id
    LEFT JOIN clip_likes l ON l.clip_id = c.id AND l.client_user_id = $1
   WHERE sv.owner_client_user_id = $1 AND c.status = 'ready' AND c.local_clip_path IS NOT NULL
  UNION ALL
  SELECT 'live', k.id, k.title, k.hook,
         k.start_offset, k.end_offset,
         COALESCE(k.ready_at, k.created_at), (extract(epoch FROM COALESCE(k.ready_at, k.created_at)) * 1000000)::bigint,
         k.local_clip_path, (k.thumbnail_path IS NOT NULL),
         NULL, k.live_channel_id,
         ch.display_name, ch.profile_image_url, ch.platform,
         (ll.live_clip_id IS NOT NULL),
         COALESCE((
           SELECT json_agg(t.x ORDER BY t.ordem) FROM (
             SELECT json_build_object('rede', 'tiktok', 'accountId', p.tiktok_account_id, 'status', p.status,
                                      'scheduledFor', p.scheduled_for, 'postedAt', p.posted_at, 'url', NULL,
                                      'erro', NULL) AS x, p.id AS ordem
               FROM videos v JOIN postings p ON p.video_id = v.id
              WHERE v.live_clip_id = k.id
             UNION ALL
             SELECT json_build_object('rede', sa.network, 'accountId', sp.social_account_id, 'status', sp.status,
                                      'scheduledFor', NULL, 'postedAt', sp.posted_at, 'url', sp.platform_post_url,
                                      'erro', sp.error_message), 1000000000000 + sp.id
               FROM social_postings sp JOIN social_accounts sa ON sa.id = sp.social_account_id
              WHERE sp.live_clip_id = k.id
           ) t
         ), '[]')
    FROM live_clips k
    JOIN live_channels ch ON ch.id = k.live_channel_id
    LEFT JOIN live_clip_likes ll ON ll.live_clip_id = k.id AND ll.client_user_id = $1
   WHERE k.user_id = $1 AND k.status = 'pronto' AND k.local_clip_path IS NOT NULL
`;

// Os filtros comuns à listagem e à contagem (tudo menos cursor e ordem).
function filtrosDe(params, { origem = null, canal = null, soGostei = false } = {}) {
  const filtros = [];
  if (origem) {
    params.push(origem);
    filtros.push(`t.tipo = $${params.length}`);
  }
  if (canal === 'avulsos') {
    filtros.push(`t.tipo = 'youtube' AND t.canal_id IS NULL`);
  } else if (canal) {
    params.push(canal.tipo, canal.id);
    filtros.push(`t.tipo = $${params.length - 1} AND t.canal_id = $${params.length}`);
  }
  if (soGostei) filtros.push('t.gostei');
  return filtros;
}

// Quantos cortes o filtro atual tem, pro marcador "3 / 34" do feed.
async function contarCortes(clientUserId, opcoes = {}) {
  const params = [clientUserId];
  const filtros = filtrosDe(params, opcoes);
  const { rows } = await pool.query(
    `SELECT count(*)::int AS n FROM (${CORTES}) t ${filtros.length ? `WHERE ${filtros.join(' AND ')}` : ''}`,
    params
  );
  return rows[0].n;
}

// filtros: { origem: 'youtube'|'live'|null, canal: { tipo, id } | 'avulsos' | null,
//            soGostei, ordem: 'recentes'|'antigos', depois: { us, tipo, id } | null, limite }
async function listarCortes(clientUserId, { origem = null, canal = null, soGostei = false, ordem = 'recentes', depois = null, limite = 12 } = {}) {
  const params = [clientUserId];
  const filtros = filtrosDe(params, { origem, canal, soGostei });
  const desc = ordem !== 'antigos';
  if (depois) {
    params.push(depois.us, depois.tipo, depois.id);
    const n = params.length;
    filtros.push(`(t.us, t.tipo, t.id) ${desc ? '<' : '>'} ($${n - 2}::bigint, $${n - 1}::text, $${n}::bigint)`);
  }
  params.push(limite);
  const sentido = desc ? 'DESC' : 'ASC';
  const { rows } = await pool.query(
    `SELECT * FROM (${CORTES}) t
      ${filtros.length ? `WHERE ${filtros.join(' AND ')}` : ''}
      ORDER BY t.us ${sentido}, t.tipo ${sentido}, t.id ${sentido}
      LIMIT $${params.length}`,
    params
  );
  return rows;
}

async function contarGostei(clientUserId) {
  const { rows } = await pool.query(
    `SELECT
       (SELECT count(*) FROM clip_likes l
          JOIN clips c ON c.id = l.clip_id JOIN source_videos sv ON sv.id = c.source_video_id
         WHERE l.client_user_id = $1 AND sv.owner_client_user_id = $1 AND c.status = 'ready' AND c.local_clip_path IS NOT NULL)
     + (SELECT count(*) FROM live_clip_likes ll
          JOIN live_clips k ON k.id = ll.live_clip_id
         WHERE ll.client_user_id = $1 AND k.user_id = $1 AND k.status = 'pronto' AND k.local_clip_path IS NOT NULL) AS n`,
    [clientUserId]
  );
  return Number(rows[0].n);
}

async function marcarGostei(clientUserId, tipo, clipId, gostei) {
  const tabela = tipo === 'live' ? 'live_clip_likes' : 'clip_likes';
  const coluna = tipo === 'live' ? 'live_clip_id' : 'clip_id';
  if (gostei) {
    await pool.query(`INSERT INTO ${tabela} (client_user_id, ${coluna}) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [clientUserId, clipId]);
  } else {
    await pool.query(`DELETE FROM ${tabela} WHERE client_user_id = $1 AND ${coluna} = $2`, [clientUserId, clipId]);
  }
}

// A postagem que já existe deste corte nesta conta (qualquer status).
async function postagemDoCorte(tipo, clipId, tiktokAccountId) {
  const coluna = tipo === 'live' ? 'live_clip_id' : 'clip_id';
  const { rows } = await pool.query(
    `SELECT p.* FROM postings p JOIN videos v ON v.id = p.video_id
      WHERE v.${coluna} = $1 AND p.tiktok_account_id = $2`,
    [clipId, tiktokAccountId]
  );
  return rows[0] || null;
}

// A linha em `videos` de um corte de live (a postagem aponta pra ela). Mesmo
// papel do garantirVideo dos cortes do YouTube.
async function garantirVideoDeLive(liveClip) {
  const { rows } = await pool.query(
    `INSERT INTO videos (source_type, live_clip_id, filename, mime_type)
     VALUES ('live_clip', $1, $2, 'video/mp4')
     ON CONFLICT (live_clip_id) WHERE live_clip_id IS NOT NULL DO UPDATE SET filename = EXCLUDED.filename
     RETURNING id`,
    [liveClip.id, liveClip.title || `Corte de live ${liveClip.id}`]
  );
  return rows[0].id;
}

// Canais de live que o cliente acompanha (pro filtro do feed).
async function canaisDeLive(clientUserId) {
  const { rows } = await pool.query(
    `SELECT DISTINCT ch.id, ch.display_name, ch.login, ch.profile_image_url, ch.platform
       FROM live_channels ch
      WHERE ch.id IN (SELECT live_channel_id FROM live_channel_follows WHERE user_id = $1)
         OR ch.id IN (SELECT live_channel_id FROM live_clips WHERE user_id = $1 AND status = 'pronto')
      ORDER BY ch.display_name`,
    [clientUserId]
  );
  return rows;
}

module.exports = { listarCortes, contarCortes, contarGostei, marcarGostei, postagemDoCorte, garantirVideoDeLive, canaisDeLive };
