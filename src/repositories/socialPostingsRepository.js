'use strict';

const pool = require('../db/pool');
const logger = require('../lib/logger');
const socialPostingSettingsRepository = require('./socialPostingSettingsRepository');
const { projectQueueTimes } = require('../lib/postingSchedule');

// Fila de publicação das contas de Instagram, Facebook, Threads, LinkedIn,
// Pinterest, Bluesky e YouTube (migrations 110 e 111). Ver
// socialPostingService para o ciclo de vida de uma postagem.
//
// A ORDEM DA FILA É O HORÁRIO: `scheduled_for` ascendente (desempate pelo id).
// No TikTok a ordem mora numa coluna separada (queue_order) e o horário é
// redistribuído por ela; aqui a fila é nova e não precisa carregar isso -
// reordenar é trocar os horários de lugar, e o que a tela mostra como "1º, 2º,
// 3º" é exatamente a ordem em que saem.
const ORDEM = 'sp.scheduled_for ASC NULLS FIRST, sp.id ASC';

// Trava por conta pra reorganizar a fila (o 8501 é a do TikTok).
const TRAVA_DA_FILA = 8511;

function colunaDoCorte(tipo) {
  return tipo === 'live' ? 'live_clip_id' : 'clip_id';
}

function mesmoHorario(a, b) {
  return Math.abs(new Date(a).getTime() - new Date(b).getTime()) < 60000;
}

async function horariosOcupados(socialAccountId) {
  const { rows } = await pool.query(
    `SELECT scheduled_for FROM social_postings
      WHERE social_account_id = $1 AND status = 'pending' AND scheduled_for > now()`,
    [socialAccountId]
  );
  return rows.map((r) => r.scheduled_for);
}

// O primeiro horário configurado que ainda vai acontecer e que nenhuma outra
// postagem pendente reservou - a mesma regra do TikTok
// (postingsRepository.computeNextScheduledFor), pelo mesmo motivo: perguntar
// "este horário está livre?" não depende de quantos já saíram nem de que horas
// são, e as tentativas por aritmética de índice erraram duas vezes.
async function proximoHorario(socialAccountId) {
  const settings = await socialPostingSettingsRepository.findOrCreate(socialAccountId);
  const ocupados = await horariosOcupados(socialAccountId);
  const candidatos = projectQueueTimes({
    mode: settings.mode,
    manualTimes: settings.manual_times,
    videosPerDay: settings.videos_per_day,
    timezone: settings.timezone,
    postedToday: 0,
    count: ocupados.length + 1,
  });
  return candidatos.find((c) => !ocupados.some((o) => mesmoHorario(o, c))) || candidatos[candidatos.length - 1];
}

// Põe o corte na fila da conta.
//  - corte novo: entra no fim, no próximo horário livre;
//  - já existia com erro ou cancelado: volta pro fim numa tentativa NOVA (o
//    cliente pediu de novo, e sabemos que a anterior não saiu);
//  - já na fila ou publicado: não mexe.
//  - `bloqueio` (corte que a rede não aceita pela duração): nasce direto como
//    erro, com o motivo, sem horário - aparece na aba de erros explicando por
//    que aquele corte não vai pra rede.
// Devolve { linha, resultado: 'enfileirado'|'ja_na_fila'|'ja_publicado'|'bloqueado' }.
async function enfileirar({ clientUserId, socialAccountId, tipo, clipId, caption, title, bloqueio = null }) {
  const coluna = colunaDoCorte(tipo);
  if (bloqueio) {
    const { rows } = await pool.query(
      `INSERT INTO social_postings (client_user_id, social_account_id, ${coluna}, caption, title, status, erro_tipo, error_message)
       VALUES ($1, $2, $3, $4, $5, 'error', 'duracao', $6)
       ON CONFLICT (social_account_id, ${coluna}) WHERE ${coluna} IS NOT NULL DO NOTHING
       RETURNING *`,
      [clientUserId, socialAccountId, clipId, caption || null, title || null, bloqueio]
    );
    if (rows[0]) return { linha: rows[0], resultado: 'bloqueado' };
    return existente(socialAccountId, coluna, clipId);
  }

  const horario = await proximoHorario(socialAccountId);
  const { rows } = await pool.query(
    `INSERT INTO social_postings (client_user_id, social_account_id, ${coluna}, caption, title, scheduled_for)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (social_account_id, ${coluna}) WHERE ${coluna} IS NOT NULL DO UPDATE SET
       status = 'pending',
       tentativa = social_postings.tentativa + 1,
       falhas_de_envio = 0,
       esperas_de_cota = 0,
       ignora_limite_diario = false,
       outstand_media_url = NULL,
       outstand_post_id = NULL,
       error_message = NULL,
       erro_tipo = NULL,
       sent_at = NULL,
       caption = EXCLUDED.caption,
       title = EXCLUDED.title,
       scheduled_for = EXCLUDED.scheduled_for,
       updated_at = now()
     WHERE social_postings.status IN ('error', 'skipped') AND social_postings.erro_tipo IS DISTINCT FROM 'duracao'
     RETURNING *`,
    [clientUserId, socialAccountId, clipId, caption || null, title || null, horario]
  );
  if (!rows[0]) return existente(socialAccountId, coluna, clipId);

  // Reorganizar não pode desfazer a postagem: ela já existe e vai sair.
  try {
    await agruparPorVideo(socialAccountId);
  } catch (err) {
    logger.error(`Nao consegui agrupar a fila da conta social ${socialAccountId} por video:`, err.message);
  }
  const { rows: atual } = await pool.query('SELECT * FROM social_postings WHERE id = $1', [rows[0].id]);
  return { linha: atual[0], resultado: 'enfileirado' };
}

async function existente(socialAccountId, coluna, clipId) {
  const { rows } = await pool.query(`SELECT * FROM social_postings WHERE social_account_id = $1 AND ${coluna} = $2`, [
    socialAccountId,
    clipId,
  ]);
  const e = rows[0];
  const resultado = e.status === 'posted' ? 'ja_publicado' : e.erro_tipo === 'duracao' ? 'bloqueado' : 'ja_na_fila';
  return { linha: e, resultado };
}

// Deixa os cortes de um mesmo vídeo juntos e em sequência na fila (mesma
// razão do TikTok, ver postingsRepository.agruparFilaPorVideo: dois vídeos
// renderizando ao mesmo tempo intercalavam as partes). Os HORÁRIOS não mudam -
// o mesmo conjunto é redistribuído na ordem nova.
async function agruparPorVideo(socialAccountId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1, $2)', [TRAVA_DA_FILA, Number(socialAccountId)]);
    const { rows } = await client.query(
      `SELECT sp.id, sp.scheduled_for, c.source_video_id
         FROM social_postings sp
         LEFT JOIN clips c ON c.id = sp.clip_id
        WHERE sp.social_account_id = $1 AND sp.status = 'pending' AND sp.scheduled_for > now()
          AND NOT sp.ignora_limite_diario
        ORDER BY ${ORDEM}`,
      [socialAccountId]
    );
    const grupos = new Map();
    for (const r of rows) {
      const chave = r.source_video_id ? `sv:${r.source_video_id}` : `sp:${r.id}`;
      if (!grupos.has(chave)) grupos.set(chave, []);
      grupos.get(chave).push(r);
    }
    const nova = [...grupos.values()].flat();
    if (nova.every((r, i) => r.id === rows[i].id)) {
      await client.query('COMMIT');
      return false;
    }
    const horarios = rows.map((r) => r.scheduled_for);
    for (let i = 0; i < nova.length; i++) {
      await client.query('UPDATE social_postings SET scheduled_for = $2, updated_at = now() WHERE id = $1', [nova[i].id, horarios[i]]);
    }
    await client.query('COMMIT');
    return true;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Usado pelo job (socialPostingService)

// Contas com publicação automática ligada, não pausadas e com algo na fila.
async function contasQuePublicamSozinhas() {
  const { rows } = await pool.query(
    `SELECT sa.id, sa.network, sa.client_user_id, COALESCE(s.videos_per_day, 3) AS videos_per_day,
            COALESCE(s.timezone, 'America/Sao_Paulo') AS timezone
       FROM social_accounts sa
       LEFT JOIN social_posting_settings s ON s.social_account_id = sa.id
      WHERE sa.disconnected_at IS NULL
        AND COALESCE(s.auto_post_enabled, true) AND NOT COALESCE(s.paused, false)
        AND EXISTS (SELECT 1 FROM social_postings sp WHERE sp.social_account_id = sa.id AND sp.status = 'pending')`
  );
  return rows;
}

// Contas com algum "Postar agora" esperando (vale mesmo com a publicação
// automática desligada ou a fila pausada: foi o cliente que mandou).
async function contasComPostarAgora() {
  const { rows } = await pool.query(
    `SELECT DISTINCT sa.id, sa.network, sa.client_user_id
       FROM social_postings sp JOIN social_accounts sa ON sa.id = sp.social_account_id
      WHERE sp.status = 'pending' AND sp.ignora_limite_diario AND sa.disconnected_at IS NULL`
  );
  return rows;
}

// Quantas saíram hoje no fuso da conta. "Postar agora" não conta: foi pedido
// à parte, e contar faria a fila normal do dia perder um horário.
async function contarHoje(socialAccountId, timezone) {
  const { rows } = await pool.query(
    `SELECT count(*)::int AS n FROM social_postings
      WHERE social_account_id = $1 AND sent_at IS NOT NULL AND status IN ('processing', 'posted')
        AND NOT ignora_limite_diario
        AND (sent_at AT TIME ZONE $2)::date = (now() AT TIME ZONE $2)::date`,
    [socialAccountId, timezone]
  );
  return rows[0].n;
}

// Pega o PRIMEIRO da fila da conta, se já venceu, marcando 'sending' na mesma
// transação. Fila estrita, como a do TikTok: se o primeiro ainda não venceu,
// ninguém passa na frente dele.
async function pegarSeVenceu(socialAccountId, { soPostarAgora = false } = {}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1, $2)', [TRAVA_DA_FILA, Number(socialAccountId)]);
    const { rows } = await client.query(
      `SELECT sp.* FROM social_postings sp
        WHERE sp.social_account_id = $1 AND sp.status = 'pending'
          ${soPostarAgora ? 'AND sp.ignora_limite_diario' : ''}
        ORDER BY ${ORDEM} LIMIT 1`,
      [socialAccountId]
    );
    const p = rows[0];
    if (!p || (p.scheduled_for && new Date(p.scheduled_for) > new Date())) {
      await client.query('COMMIT');
      return null;
    }
    const { rows: pega } = await client.query(
      "UPDATE social_postings SET status = 'sending', updated_at = now() WHERE id = $1 RETURNING *",
      [p.id]
    );
    await client.query('COMMIT');
    return pega[0];
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// Dados que o envio precisa: a conta na Outstand, o arquivo e a duração.
async function detalhesParaEnviar(id) {
  const { rows } = await pool.query(
    `SELECT sp.*, sa.network, sa.outstand_account_id, sa.disconnected_at,
            COALESCE(c.local_clip_path, k.local_clip_path) AS caminho,
            COALESCE(c.end_seconds - c.start_seconds, k.end_offset - k.start_offset) AS duracao,
            COALESCE(s.options, '{}'::jsonb) AS opcoes
       FROM social_postings sp
       JOIN social_accounts sa ON sa.id = sp.social_account_id
       LEFT JOIN social_posting_settings s ON s.social_account_id = sa.id
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
            scheduled_for = now() + make_interval(mins => $2::int),
            error_message = $3, updated_at = now()
      WHERE id = $1`,
    [id, esperaMinutos, mensagem]
  );
}

// O YouTube negou por falta de vaga no limite compartilhado: a publicação
// anterior sabidamente NÃO saiu, então a próxima é uma tentativa nova (chave
// nova), marcada pra quando a Outstand disse que abre vaga. A mídia já enviada
// é reaproveitada (vale 60 dias).
async function esperarVaga(id, quando, mensagem) {
  await pool.query(
    `UPDATE social_postings
        SET status = 'pending', tentativa = tentativa + 1, esperas_de_cota = esperas_de_cota + 1,
            outstand_post_id = NULL, sent_at = NULL, scheduled_for = $2, error_message = $3, updated_at = now()
      WHERE id = $1`,
    [id, quando, mensagem]
  );
}

async function marcarPublicada(id, url) {
  await pool.query(
    `UPDATE social_postings SET status = 'posted', platform_post_url = $2, posted_at = now(), error_message = NULL, updated_at = now() WHERE id = $1`,
    [id, url || null]
  );
}

async function marcarErro(id, mensagem, tipo = null) {
  await pool.query(
    `UPDATE social_postings SET status = 'error', error_message = $2, erro_tipo = $3, updated_at = now() WHERE id = $1`,
    [id, mensagem, tipo]
  );
}

async function emAndamento() {
  const { rows } = await pool.query(
    `SELECT sp.*, sa.outstand_account_id, sa.network
       FROM social_postings sp JOIN social_accounts sa ON sa.id = sp.social_account_id
      WHERE sp.status = 'processing' ORDER BY sp.sent_at`
  );
  return rows;
}

// 'sending' parado há muito tempo = o processo caiu no meio do envio. Volta
// pra fila na mesma tentativa (mesma chave de idempotência).
async function devolverEnviosTravados(minutos = 20) {
  const { rowCount } = await pool.query(
    `UPDATE social_postings SET status = 'pending', updated_at = now()
      WHERE status = 'sending' AND updated_at < now() - make_interval(mins => $1::int)`,
    [minutos]
  );
  return rowCount;
}

// "Tentar de novo" do painel de erros do admin.
async function devolverParaFila(id) {
  const { rows } = await pool.query(
    "SELECT social_account_id FROM social_postings WHERE id = $1 AND status = 'error' AND erro_tipo IS DISTINCT FROM 'duracao'",
    [id]
  );
  if (!rows[0]) return false;
  return Boolean(await voltarPraFila(id, rows[0].social_account_id));
}

async function voltarPraFila(id, socialAccountId) {
  const horario = await proximoHorario(socialAccountId);
  const { rows } = await pool.query(
    `UPDATE social_postings
        SET status = 'pending', tentativa = tentativa + 1, falhas_de_envio = 0, esperas_de_cota = 0,
            ignora_limite_diario = false, outstand_media_url = NULL, outstand_post_id = NULL,
            error_message = NULL, erro_tipo = NULL, sent_at = NULL, scheduled_for = $2, updated_at = now()
      WHERE id = $1 AND status IN ('error', 'skipped') AND erro_tipo IS DISTINCT FROM 'duracao'
      RETURNING *`,
    [id, horario]
  );
  return rows[0] || null;
}

// ---------------------------------------------------------------------------
// Usado pela tela do cliente. Tudo filtrado pelo DONO: sem isso, trocar o
// número na URL mexeria na fila de outro cliente.

const CAMPOS_DA_TELA = `
  sp.id, sp.social_account_id, sp.status, sp.caption, sp.title, sp.scheduled_for, sp.posted_at, sp.sent_at,
  sp.platform_post_url, sp.error_message, sp.erro_tipo, sp.esperas_de_cota, sp.ignora_limite_diario,
  sp.clip_id, sp.live_clip_id, sp.updated_at,
  COALESCE(c.title, k.title) AS clip_title,
  COALESCE(c.end_seconds - c.start_seconds, k.end_offset - k.start_offset) AS duracao,
  (COALESCE(c.thumbnail_path, k.thumbnail_path) IS NOT NULL) AS tem_capa,
  (COALESCE(c.local_clip_path, k.local_clip_path) IS NOT NULL) AS tem_arquivo,
  COALESCE(yc.channel_name, ch.display_name) AS origem_nome`;

const JUNCOES_DA_TELA = `
  JOIN social_accounts sa ON sa.id = sp.social_account_id
  LEFT JOIN clips c ON c.id = sp.clip_id
  LEFT JOIN source_videos sv ON sv.id = c.source_video_id
  LEFT JOIN youtube_channels yc ON yc.id = sv.youtube_channel_id
  LEFT JOIN live_clips k ON k.id = sp.live_clip_id
  LEFT JOIN live_channels ch ON ch.id = k.live_channel_id`;

async function listarFila(clientUserId, socialAccountId) {
  const { rows } = await pool.query(
    `SELECT ${CAMPOS_DA_TELA} FROM social_postings sp ${JUNCOES_DA_TELA}
      WHERE sa.client_user_id = $1 AND sp.social_account_id = $2 AND sp.status IN ('pending', 'sending', 'processing')
      ORDER BY CASE WHEN sp.status = 'pending' THEN 1 ELSE 0 END, ${ORDEM}`,
    [clientUserId, socialAccountId]
  );
  return rows;
}

async function listarPublicados(clientUserId, socialAccountId) {
  const { rows } = await pool.query(
    `SELECT ${CAMPOS_DA_TELA} FROM social_postings sp ${JUNCOES_DA_TELA}
      WHERE sa.client_user_id = $1 AND sp.social_account_id = $2 AND sp.status = 'posted'
      ORDER BY sp.posted_at DESC LIMIT 100`,
    [clientUserId, socialAccountId]
  );
  return rows;
}

async function listarErros(clientUserId, socialAccountId) {
  const { rows } = await pool.query(
    `SELECT ${CAMPOS_DA_TELA} FROM social_postings sp ${JUNCOES_DA_TELA}
      WHERE sa.client_user_id = $1 AND sp.social_account_id = $2 AND sp.status = 'error'
      ORDER BY sp.updated_at DESC LIMIT 100`,
    [clientUserId, socialAccountId]
  );
  return rows;
}

async function contagensPorConta(clientUserId) {
  const { rows } = await pool.query(
    `SELECT sp.social_account_id,
            count(*) FILTER (WHERE sp.status IN ('pending', 'sending', 'processing'))::int AS na_fila,
            count(*) FILTER (WHERE sp.status = 'posted')::int AS publicados,
            count(*) FILTER (WHERE sp.status = 'error')::int AS erros,
            min(sp.scheduled_for) FILTER (WHERE sp.status = 'pending') AS proxima
       FROM social_postings sp JOIN social_accounts sa ON sa.id = sp.social_account_id
      WHERE sa.client_user_id = $1 AND sa.disconnected_at IS NULL
      GROUP BY sp.social_account_id`,
    [clientUserId]
  );
  return new Map(rows.map((r) => [Number(r.social_account_id), r]));
}

async function daConta(id, clientUserId) {
  const { rows } = await pool.query(
    `SELECT sp.* FROM social_postings sp JOIN social_accounts sa ON sa.id = sp.social_account_id
      WHERE sp.id = $1 AND sa.client_user_id = $2`,
    [id, clientUserId]
  );
  return rows[0] || null;
}

async function editarLegenda(id, clientUserId, caption) {
  const p = await daConta(id, clientUserId);
  if (!p || p.status !== 'pending') return null;
  const { rows } = await pool.query(
    "UPDATE social_postings SET caption = $2, updated_at = now() WHERE id = $1 AND status = 'pending' RETURNING *",
    [id, caption]
  );
  return rows[0] || null;
}

// "Não postar": tira da fila e recalcula o horário dos outros, pra não ficar
// um buraco (mesmo comportamento do TikTok desde 13/09/2026).
async function cancelar(id, clientUserId) {
  const p = await daConta(id, clientUserId);
  if (!p || p.status !== 'pending') return null;
  const { rows } = await pool.query(
    "UPDATE social_postings SET status = 'skipped', ignora_limite_diario = false, updated_at = now() WHERE id = $1 AND status = 'pending' RETURNING *",
    [id]
  );
  if (rows[0]) {
    try {
      await recalcularHorarios(p.social_account_id);
    } catch (err) {
      logger.error(`Cancelei a postagem social ${id} mas nao consegui recalcular a fila:`, err.message);
    }
  }
  return rows[0] || null;
}

// "Postar agora": vai pra frente da fila e sai na próxima rodada, mesmo que a
// conta já tenha atingido o "N por dia" ou esteja com a publicação automática
// desligada.
async function postarAgora(id, clientUserId) {
  const p = await daConta(id, clientUserId);
  if (!p || p.status !== 'pending') return null;
  const { rows } = await pool.query(
    `UPDATE social_postings
        SET ignora_limite_diario = true,
            scheduled_for = LEAST(now(), (SELECT min(scheduled_for) FROM social_postings
                                           WHERE social_account_id = $2 AND status = 'pending')) - interval '1 second',
            updated_at = now()
      WHERE id = $1 AND status = 'pending' RETURNING *`,
    [id, p.social_account_id]
  );
  return rows[0] || null;
}

async function tentarDeNovo(id, clientUserId) {
  const p = await daConta(id, clientUserId);
  if (!p) return null;
  return voltarPraFila(id, p.social_account_id);
}

// Ordem escolhida arrastando: os horários já reservados são redistribuídos na
// ordem pedida. Só mexe em pendentes desta conta; id que não é da conta (ou
// não está pendente) é ignorado.
async function ordenar(socialAccountId, idsNaOrdem) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1, $2)', [TRAVA_DA_FILA, Number(socialAccountId)]);
    const { rows } = await client.query(
      `SELECT sp.id, sp.scheduled_for FROM social_postings sp
        WHERE sp.social_account_id = $1 AND sp.status = 'pending' ORDER BY ${ORDEM}`,
      [socialAccountId]
    );
    const pedidos = [...new Set(idsNaOrdem.map(Number))].filter((id) => rows.some((r) => Number(r.id) === id));
    const resto = rows.map((r) => Number(r.id)).filter((id) => !pedidos.includes(id));
    const nova = [...pedidos, ...resto];
    const horarios = rows.map((r) => r.scheduled_for);
    for (let i = 0; i < nova.length; i++) {
      await client.query('UPDATE social_postings SET scheduled_for = $2, updated_at = now() WHERE id = $1', [nova[i], horarios[i]]);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// Recalcula o horário de TODA a fila pendente da conta, do zero, na ordem
// atual: usado depois de mudar os horários, de cancelar um corte e pelo botão
// "Corrigir horários". Um "Postar agora" pendente fica onde está (na frente).
async function recalcularHorarios(socialAccountId) {
  const settings = await socialPostingSettingsRepository.findOrCreate(socialAccountId);
  const { rows } = await pool.query(
    `SELECT sp.id FROM social_postings sp
      WHERE sp.social_account_id = $1 AND sp.status = 'pending' AND NOT sp.ignora_limite_diario
      ORDER BY ${ORDEM}`,
    [socialAccountId]
  );
  const horarios = projectQueueTimes({
    mode: settings.mode,
    manualTimes: settings.manual_times,
    videosPerDay: settings.videos_per_day,
    timezone: settings.timezone,
    postedToday: 0,
    count: rows.length,
  });
  for (let i = 0; i < rows.length; i++) {
    await pool.query('UPDATE social_postings SET scheduled_for = $2, updated_at = now() WHERE id = $1', [rows[i].id, horarios[i]]);
  }
  return rows.length;
}

// Cortes publicados nas redes há mais tempo que a retenção, que não têm mais
// nada esperando em fila nenhuma (TikTok ou redes) - pra limpeza de disco
// (postingCleanupJob). Mesmo formato do postingsRepository.listPostedOlderThan.
async function publicadosParaLimpar(horas) {
  const { rows } = await pool.query(
    `SELECT DISTINCT ON (COALESCE(sp.clip_id, -sp.live_clip_id))
            sp.id, CASE WHEN sp.live_clip_id IS NOT NULL THEN 'live' ELSE 'youtube' END AS origem,
            sp.clip_id, sp.live_clip_id,
            COALESCE(c.local_clip_path, k.local_clip_path) AS local_clip_path,
            COALESCE(c.thumbnail_path, k.thumbnail_path) AS thumbnail_path,
            c.source_video_id
       FROM social_postings sp
       LEFT JOIN clips c ON c.id = sp.clip_id
       LEFT JOIN live_clips k ON k.id = sp.live_clip_id
      WHERE sp.status = 'posted' AND sp.posted_at < now() - make_interval(hours => $1::int)
        AND (c.id IS NOT NULL OR k.id IS NOT NULL)
        AND NOT EXISTS (SELECT 1 FROM social_postings o
                         WHERE o.status IN ('pending', 'sending', 'processing')
                           AND (o.clip_id = sp.clip_id OR o.live_clip_id = sp.live_clip_id))
        AND NOT EXISTS (SELECT 1 FROM videos v JOIN postings p ON p.video_id = v.id
                         WHERE p.status IN ('pending', 'queued', 'processing')
                           AND (v.clip_id = sp.clip_id OR v.live_clip_id = sp.live_clip_id))`,
    [horas]
  );
  return rows;
}

module.exports = {
  ORDEM,
  publicadosParaLimpar,
  proximoHorario,
  enfileirar,
  agruparPorVideo,
  contasQuePublicamSozinhas,
  contasComPostarAgora,
  contarHoje,
  pegarSeVenceu,
  detalhesParaEnviar,
  guardarMidia,
  marcarEnviada,
  adiarEnvio,
  esperarVaga,
  marcarPublicada,
  marcarErro,
  emAndamento,
  devolverEnviosTravados,
  devolverParaFila,
  listarFila,
  listarPublicados,
  listarErros,
  contagensPorConta,
  daConta,
  editarLegenda,
  cancelar,
  postarAgora,
  tentarDeNovo,
  ordenar,
  recalcularHorarios,
};
