// Registro de atividade (migration 114) e o que o painel "Atividade" do admin
// lê dele. Ver middleware/registroDeAtividade.
'use strict';

const pool = require('../db/pool');

async function registrar({ userId, tipo, metodo, rota, recursoId, status, resultado, duracaoMs, mensagem }) {
  await pool.query(
    `INSERT INTO user_activity (user_id, tipo, metodo, rota, recurso_id, status, resultado, duracao_ms, mensagem)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [userId, tipo, metodo, rota, recursoId, status, resultado, duracaoMs, mensagem]
  );
}

// Admin fica de fora por padrão: ele testa tudo, e misturar os cliques dele
// com os dos clientes faria uma funcionalidade parecer usada (ou quebrada)
// quando só o fundador mexeu.
function filtroDeAdmin(incluirAdmin, alias = 'a') {
  return incluirAdmin ? 'true' : `NOT EXISTS (SELECT 1 FROM users ux WHERE ux.id = ${alias}.user_id AND ux.role = 'admin')`;
}

// Cada ação (método + rota), com quantas vezes deu certo, foi recusada ou
// quebrou no período, e a última mensagem de quando não deu certo.
async function resumoPorAcao({ desde, ate, incluirAdmin = false }) {
  const { rows } = await pool.query(
    `SELECT a.metodo, a.rota, a.tipo,
            count(*)::int AS total,
            count(*) FILTER (WHERE a.resultado = 'ok')::int AS ok,
            count(*) FILTER (WHERE a.resultado = 'recusada')::int AS recusadas,
            count(*) FILTER (WHERE a.resultado = 'falhou')::int AS falhas,
            count(DISTINCT a.user_id)::int AS pessoas,
            round(avg(a.duracao_ms))::int AS duracao_media_ms,
            max(a.created_at) AS ultima_vez,
            (SELECT b.mensagem FROM user_activity b
              WHERE b.metodo = a.metodo AND b.rota = a.rota AND b.resultado <> 'ok'
                AND b.created_at >= $1 AND b.created_at < $2 AND b.mensagem IS NOT NULL
              ORDER BY b.created_at DESC LIMIT 1) AS ultima_mensagem
       FROM user_activity a
      WHERE a.created_at >= $1 AND a.created_at < $2 AND ${filtroDeAdmin(incluirAdmin)}
      GROUP BY a.metodo, a.rota, a.tipo
      ORDER BY count(*) FILTER (WHERE a.resultado = 'falhou') DESC,
               count(*) FILTER (WHERE a.resultado = 'recusada') DESC,
               count(*) DESC`,
    [desde, ate]
  );
  return rows;
}

// Quem usou o painel no período: última vez, quantas ações, quantas não deram
// certo, e o plano.
async function clientes({ desde, ate, incluirAdmin = false }) {
  const { rows } = await pool.query(
    `SELECT u.id, u.email, u.business_name, u.role, sp.name AS plano,
            count(*)::int AS eventos,
            count(*) FILTER (WHERE a.tipo = 'acao')::int AS acoes,
            count(*) FILTER (WHERE a.tipo = 'pagina')::int AS paginas,
            count(*) FILTER (WHERE a.resultado = 'recusada')::int AS recusadas,
            count(*) FILTER (WHERE a.resultado = 'falhou')::int AS falhas,
            min(a.created_at) AS primeira_vez,
            max(a.created_at) AS ultima_vez
       FROM user_activity a
       JOIN users u ON u.id = a.user_id
       LEFT JOIN client_subscriptions cs ON cs.client_user_id = u.id AND cs.status <> 'cancelado'
       LEFT JOIN subscription_plans sp ON sp.id = cs.plan_id
      WHERE a.created_at >= $1 AND a.created_at < $2 AND ${filtroDeAdmin(incluirAdmin)}
      GROUP BY u.id, u.email, u.business_name, u.role, sp.name
      ORDER BY max(a.created_at) DESC
      LIMIT 300`,
    [desde, ate]
  );
  return rows;
}

// O que o SISTEMA fez no período (sem clique de ninguém): vídeos processados,
// postagens publicadas, cortes de live. É a outra metade de "está funcionando":
// o cliente pode clicar tudo certo e o trabalho de fundo falhar depois.
async function resultadosDoSistema({ desde, ate }) {
  const { rows } = await pool.query(
    `SELECT 'Vídeos processados' AS nome,
            count(*) FILTER (WHERE status = 'ready')::int AS ok,
            count(*) FILTER (WHERE status = 'error')::int AS falhas
       FROM source_videos WHERE updated_at >= $1 AND updated_at < $2 AND status IN ('ready', 'error')
     UNION ALL
     SELECT 'Publicações no TikTok',
            count(*) FILTER (WHERE status = 'posted')::int,
            count(*) FILTER (WHERE status = 'error')::int
       FROM postings WHERE updated_at >= $1 AND updated_at < $2 AND status IN ('posted', 'error')
     UNION ALL
     SELECT 'Publicações nas outras redes',
            count(*) FILTER (WHERE status = 'posted')::int,
            count(*) FILTER (WHERE status = 'error')::int
       FROM social_postings WHERE updated_at >= $1 AND updated_at < $2 AND status IN ('posted', 'error')
     UNION ALL
     SELECT 'Cortes de live',
            count(*) FILTER (WHERE status = 'pronto')::int,
            count(*) FILTER (WHERE status = 'erro')::int
       FROM live_clips WHERE COALESCE(ready_at, created_at) >= $1 AND COALESCE(ready_at, created_at) < $2 AND status IN ('pronto', 'erro')`,
    [desde, ate]
  );
  return rows;
}

// Linha do tempo de UMA pessoa: o que ela fez + o que o sistema fez pra ela +
// os erros registrados na conta dela, tudo em ordem.
async function linhaDoTempo({ userId, desde, ate, limite = 400 }) {
  const { rows } = await pool.query(
    `SELECT * FROM (
       SELECT a.created_at AS quando, a.tipo, a.metodo, a.rota, a.recurso_id, a.status, a.resultado,
              a.duracao_ms, a.mensagem, NULL::text AS titulo
         FROM user_activity a
        WHERE a.user_id = $1 AND a.created_at >= $2 AND a.created_at < $3
       UNION ALL
       SELECT sv.updated_at, 'sistema', NULL, 'video', sv.id, NULL,
              CASE WHEN sv.status = 'ready' THEN 'ok' ELSE 'falhou' END, NULL, NULL,
              CASE WHEN sv.status = 'ready' THEN 'Vídeo processado' ELSE 'Vídeo deu erro' END || ': ' || left(COALESCE(sv.title, ''), 80)
         FROM source_videos sv
         LEFT JOIN youtube_channels yc ON yc.id = sv.youtube_channel_id
        WHERE COALESCE(sv.client_user_id, sv.owner_client_user_id, yc.client_user_id) = $1
          AND sv.status IN ('ready', 'error') AND sv.updated_at >= $2 AND sv.updated_at < $3
       UNION ALL
       SELECT p.updated_at, 'sistema', NULL, 'postagem_tiktok', p.id, NULL,
              CASE WHEN p.status = 'posted' THEN 'ok' ELSE 'falhou' END, NULL, NULL,
              CASE WHEN p.status = 'posted' THEN 'Publicado no TikTok' ELSE 'Publicação no TikTok falhou' END
                || COALESCE(' (' || ta.display_name || ')', '')
         FROM postings p JOIN tiktok_accounts ta ON ta.id = p.tiktok_account_id
        WHERE ta.client_user_id = $1 AND p.status IN ('posted', 'error') AND p.updated_at >= $2 AND p.updated_at < $3
       UNION ALL
       SELECT sp.updated_at, 'sistema', NULL, 'postagem_rede', sp.id, NULL,
              CASE WHEN sp.status = 'posted' THEN 'ok' ELSE 'falhou' END, NULL,
              CASE WHEN sp.status = 'posted' THEN NULL ELSE sp.error_message END,
              CASE WHEN sp.status = 'posted' THEN 'Publicado no ' ELSE 'Publicação falhou no ' END || sa.network
                || COALESCE(' (@' || sa.username || ')', '')
         FROM social_postings sp JOIN social_accounts sa ON sa.id = sp.social_account_id
        WHERE sa.client_user_id = $1 AND sp.status IN ('posted', 'error') AND sp.updated_at >= $2 AND sp.updated_at < $3
       UNION ALL
       -- Bater no limite do plano e esperar vaga no servidor ficam no painel de
       -- erros, mas não são defeito: aparecem como recusada, não "quebrou".
       SELECT ev.occurred_at, 'erro', NULL, e.operation, e.entity_id, NULL,
              CASE WHEN e.operation IN ('limite_do_plano', 'lives_capacidade') THEN 'recusada' ELSE 'falhou' END,
              NULL, ev.message, NULL
         FROM system_error_events ev JOIN system_errors e ON e.id = ev.error_id
        WHERE ev.client_user_id = $1 AND ev.occurred_at >= $2 AND ev.occurred_at < $3
     ) t
     ORDER BY quando DESC
     LIMIT $4`,
    [userId, desde, ate, limite]
  );
  return rows;
}

// As últimas ações de todo mundo (aba "Agora").
async function recentes({ limite = 150, incluirAdmin = false, soProblemas = false }) {
  const { rows } = await pool.query(
    `SELECT a.*, u.email, u.business_name
       FROM user_activity a LEFT JOIN users u ON u.id = a.user_id
      WHERE ${filtroDeAdmin(incluirAdmin)} ${soProblemas ? "AND a.resultado <> 'ok'" : ''}
      ORDER BY a.created_at DESC
      LIMIT $1`,
    [limite]
  );
  return rows;
}

// Totais pro cartão da tela inicial do admin.
async function totais({ desde, ate, incluirAdmin = false }) {
  const { rows } = await pool.query(
    `SELECT count(*) FILTER (WHERE tipo = 'acao')::int AS acoes,
            count(*) FILTER (WHERE resultado = 'recusada')::int AS recusadas,
            count(*) FILTER (WHERE resultado = 'falhou')::int AS falhas,
            count(DISTINCT user_id)::int AS pessoas
       FROM user_activity a
      WHERE created_at >= $1 AND created_at < $2 AND ${filtroDeAdmin(incluirAdmin)}`,
    [desde, ate]
  );
  return rows[0];
}

async function apagarAntigos(dias = 90) {
  const { rowCount } = await pool.query(
    "DELETE FROM user_activity WHERE created_at < now() - make_interval(days => $1::int)",
    [dias]
  );
  return rowCount;
}

module.exports = { registrar, resumoPorAcao, clientes, resultadosDoSistema, linhaDoTempo, recentes, totais, apagarAntigos };
