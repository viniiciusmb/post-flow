// Consultas das tabelas live_* (modulo de cortes de lives). Nenhuma consulta
// aqui toca tabela do fluxo do YouTube.
'use strict';

const pool = require('../db/pool');

// ---------------------------------------------------------------- canais

async function upsertChannel({ login, displayName, platformUserId, profileImageUrl }) {
  const { rows } = await pool.query(
    `INSERT INTO live_channels (platform, login, display_name, platform_user_id, profile_image_url)
     VALUES ('twitch', $1, $2, $3, $4)
     ON CONFLICT (platform, login) DO UPDATE
       SET display_name = EXCLUDED.display_name,
           platform_user_id = EXCLUDED.platform_user_id,
           profile_image_url = EXCLUDED.profile_image_url
     RETURNING *`,
    [login, displayName, platformUserId, profileImageUrl]
  );
  return rows[0];
}

async function follow(userId, channelId) {
  await pool.query(
    `INSERT INTO live_channel_follows (user_id, live_channel_id) VALUES ($1, $2)
     ON CONFLICT (user_id, live_channel_id) DO UPDATE SET is_active = true`,
    [userId, channelId]
  );
}

async function unfollow(userId, channelId) {
  const { rowCount } = await pool.query(
    'UPDATE live_channel_follows SET is_active = false WHERE user_id = $1 AND live_channel_id = $2 AND is_active',
    [userId, channelId]
  );
  return rowCount > 0;
}

async function isFollowing(userId, channelId) {
  const { rows } = await pool.query(
    'SELECT 1 FROM live_channel_follows WHERE user_id = $1 AND live_channel_id = $2 AND is_active',
    [userId, channelId]
  );
  return rows.length > 0;
}

// Canais que alguem acompanha - os unicos que o supervisor vigia e grava.
async function listWatchedChannels() {
  const { rows } = await pool.query(
    `SELECT c.* FROM live_channels c
      WHERE EXISTS (SELECT 1 FROM live_channel_follows f WHERE f.live_channel_id = c.id AND f.is_active)
      ORDER BY c.id`
  );
  return rows;
}

async function activeFollowerIds(channelId) {
  const { rows } = await pool.query(
    'SELECT user_id FROM live_channel_follows WHERE live_channel_id = $1 AND is_active ORDER BY user_id',
    [channelId]
  );
  return rows.map((r) => Number(r.user_id));
}

async function updateChannelStatus(channelId, { isLive, titulo, jogo, espectadores }) {
  await pool.query(
    `UPDATE live_channels
        SET is_live = $2, stream_title = COALESCE($3, stream_title), game_name = COALESCE($4, game_name),
            viewer_count = $5, last_checked_at = now(),
            last_live_at = CASE WHEN $2 THEN now() ELSE last_live_at END
      WHERE id = $1`,
    [channelId, isLive, titulo || null, jogo || null, isLive ? espectadores ?? null : null]
  );
}

// Canais de UM usuario, com a sessao em andamento e contagens - e o que a
// tela mostra. Cada numero sai de uma subconsulta (nunca JOIN somado: juntar
// cortes e sessoes na mesma consulta multiplicaria um pelo outro).
async function listChannelsForUser(userId) {
  const { rows } = await pool.query(
    `SELECT c.*,
            s.id AS session_id, s.started_at AS session_started_at,
            s.recorded_seconds AS session_recorded_seconds, s.bytes AS session_bytes,
            (SELECT count(*) FROM live_clips k WHERE k.live_channel_id = c.id AND k.user_id = $1 AND k.status = 'pronto') AS clips_prontos,
            (SELECT count(*) FROM live_clips k WHERE k.live_channel_id = c.id AND k.user_id = $1 AND k.status IN ('na_fila','renderizando')) AS clips_em_andamento,
            (SELECT max(started_at) FROM live_sessions x WHERE x.live_channel_id = c.id) AS ultima_gravacao
       FROM live_channel_follows f
       JOIN live_channels c ON c.id = f.live_channel_id
       LEFT JOIN live_sessions s ON s.live_channel_id = c.id AND s.status = 'gravando'
      WHERE f.user_id = $1 AND f.is_active
      ORDER BY c.login`,
    [userId]
  );
  return rows;
}

// ---------------------------------------------------------------- sessoes

// Devolve null se ja existe gravacao em andamento pro canal: o indice unico
// parcial e a trava, nao uma leitura antes (duas chamadas juntas passariam
// as duas numa leitura).
async function createSession({ channelId, streamId, titulo, jogo, dirPath }) {
  const { rows } = await pool.query(
    `INSERT INTO live_sessions (live_channel_id, platform_stream_id, title, game_name, dir_path)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (live_channel_id) WHERE status = 'gravando' DO NOTHING
     RETURNING *`,
    [channelId, streamId || null, titulo || null, jogo || null, dirPath]
  );
  return rows[0] || null;
}

async function setSessionDir(sessionId, dirPath) {
  await pool.query('UPDATE live_sessions SET dir_path = $2 WHERE id = $1', [sessionId, dirPath]);
}

async function findSession(sessionId) {
  const { rows } = await pool.query('SELECT * FROM live_sessions WHERE id = $1', [sessionId]);
  return rows[0] || null;
}

async function listRecordingSessions() {
  const { rows } = await pool.query(
    `SELECT s.*, c.login FROM live_sessions s JOIN live_channels c ON c.id = s.live_channel_id
      WHERE s.status = 'gravando' ORDER BY s.id`
  );
  return rows;
}

async function recordingSessionForChannel(channelId) {
  const { rows } = await pool.query(
    "SELECT * FROM live_sessions WHERE live_channel_id = $1 AND status = 'gravando'",
    [channelId]
  );
  return rows[0] || null;
}

// So encerra quem ainda esta gravando: o fim pode ser avisado duas vezes
// (processo que cai + supervisor que manda parar) e o segundo aviso nao pode
// trocar o motivo que o primeiro gravou.
async function endSession(sessionId, { status, motivo }) {
  const { rows } = await pool.query(
    `UPDATE live_sessions SET status = $2, stop_reason = $3, ended_at = now()
      WHERE id = $1 AND status = 'gravando' RETURNING *`,
    [sessionId, status, motivo]
  );
  return rows[0] || null;
}

// Na partida do worker: qualquer "gravando" e de um processo que morreu com o
// container. Nao tem como retomar o mesmo arquivo - vira "interrompida" e a
// proxima checagem abre uma sessao nova se a live continuar.
async function interruptOrphanSessions(motivo) {
  const { rows } = await pool.query(
    `UPDATE live_sessions SET status = 'interrompida', stop_reason = $1, ended_at = now()
      WHERE status = 'gravando' RETURNING id`,
    [motivo]
  );
  return rows.map((r) => Number(r.id));
}

async function updateSessionProgress(sessionId, { recordedSeconds, bytes }) {
  await pool.query(
    'UPDATE live_sessions SET recorded_seconds = GREATEST(recorded_seconds, $2), bytes = $3 WHERE id = $1',
    [sessionId, recordedSeconds, bytes]
  );
}

// Segundos gravados HOJE (dia de Brasilia) por um canal - e o teto diario.
async function recordedSecondsToday(channelId) {
  const { rows } = await pool.query(
    `SELECT COALESCE(sum(recorded_seconds), 0) AS s FROM live_sessions
      WHERE live_channel_id = $1
        AND started_at >= (date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo')`,
    [channelId]
  );
  return Number(rows[0].s);
}

async function setTriagedUntil(sessionId, offset) {
  await pool.query('UPDATE live_sessions SET triaged_until = GREATEST(triaged_until, $2) WHERE id = $1', [sessionId, offset]);
}

async function markSelection(sessionId) {
  await pool.query('UPDATE live_sessions SET last_selection_at = now() WHERE id = $1', [sessionId]);
}

// Sessoes que ainda podem ter trabalho de IA pela frente: gravando, ou
// encerradas ha pouco (a ultima triagem/selecao acontece depois do fim).
async function listSessionsForAnalysis() {
  const { rows } = await pool.query(
    `SELECT s.*, c.login, c.platform_user_id FROM live_sessions s JOIN live_channels c ON c.id = s.live_channel_id
      WHERE s.status = 'gravando' OR s.ended_at > now() - interval '30 minutes'
      ORDER BY s.id`
  );
  return rows;
}

// ---------------------------------------------------------------- segmentos

// Idempotente por (sessao, tipo, numero): a lista do ffmpeg e relida inteira a
// cada volta, e so o que e novo entra. Bloco de audio novo ja nasce com a
// linha de transcricao pendente, na mesma instrucao.
async function insertSegments(sessionId, kind, segmentos) {
  if (!segmentos.length) return 0;
  const { rows } = await pool.query(
    `WITH novos AS (
       INSERT INTO live_segments (session_id, kind, seq, file_path, start_offset, end_offset, bytes, closed_at)
       SELECT $1, $2, s.seq, s.file_path, s.start_offset, s.end_offset, s.bytes, s.closed_at
         FROM jsonb_to_recordset($3::jsonb)
              AS s(seq int, file_path text, start_offset numeric, end_offset numeric, bytes bigint, closed_at timestamptz)
       ON CONFLICT (session_id, kind, seq) DO NOTHING
       RETURNING id, session_id, kind, start_offset, end_offset
     ), pendentes AS (
       INSERT INTO live_transcripts (session_id, audio_segment_id, start_offset, end_offset)
       SELECT session_id, id, start_offset, end_offset FROM novos WHERE kind = 'audio'
       RETURNING id
     )
     SELECT (SELECT count(*) FROM novos) AS n`,
    [sessionId, kind, JSON.stringify(segmentos)]
  );
  return Number(rows[0].n);
}

async function sessionTotals(sessionId) {
  const { rows } = await pool.query(
    `SELECT COALESCE(max(end_offset) FILTER (WHERE kind = 'video'), 0) AS gravado,
            COALESCE(sum(bytes), 0) AS bytes
       FROM live_segments WHERE session_id = $1`,
    [sessionId]
  );
  return { recordedSeconds: Number(rows[0].gravado), bytes: Number(rows[0].bytes) };
}

async function videoSegmentsBetween(sessionId, inicio, fim) {
  const { rows } = await pool.query(
    `SELECT * FROM live_segments
      WHERE session_id = $1 AND kind = 'video' AND deleted_at IS NULL
        AND end_offset > $2 AND start_offset < $3
      ORDER BY seq`,
    [sessionId, inicio, fim]
  );
  return rows;
}

async function segmentsOlderThan(horas, limite = 500) {
  const { rows } = await pool.query(
    `SELECT * FROM live_segments
      WHERE deleted_at IS NULL AND created_at < now() - make_interval(hours => $1)
      ORDER BY created_at LIMIT $2`,
    [horas, limite]
  );
  return rows;
}

async function markSegmentsDeleted(ids) {
  if (!ids.length) return;
  await pool.query('UPDATE live_segments SET deleted_at = now() WHERE id = ANY($1::bigint[])', [ids]);
}

// ---------------------------------------------------------------- transcricoes

// Pega o proximo bloco pendente e ja marca a tentativa - FOR UPDATE SKIP
// LOCKED pra dois laços nunca transcreverem (e pagarem) o mesmo bloco.
async function claimPendingTranscript() {
  const { rows } = await pool.query(
    `UPDATE live_transcripts t SET attempts = attempts + 1
      WHERE t.id = (
        SELECT t2.id FROM live_transcripts t2
          JOIN live_segments g ON g.id = t2.audio_segment_id
         WHERE t2.status = 'pendente' AND t2.attempts < 3 AND g.deleted_at IS NULL
         ORDER BY t2.session_id, t2.start_offset
         LIMIT 1 FOR UPDATE OF t2 SKIP LOCKED)
      RETURNING t.*, (SELECT file_path FROM live_segments g WHERE g.id = t.audio_segment_id) AS file_path,
                (SELECT live_channel_id FROM live_sessions s WHERE s.id = t.session_id) AS live_channel_id`
  );
  return rows[0] || null;
}

async function finishTranscript(id, { status, texto = null, loudness = null, pico = null, silencio = null, custoUsd = 0, erro = null, momentaneo = null }) {
  await pool.query(
    `UPDATE live_transcripts
        SET status = $2, text = $3, loudness_lufs = $4, peak_db = $5, silence_seconds = $6,
            cost_usd = cost_usd + $7, error_message = $8, momentary_1s = $9
      WHERE id = $1`,
    [id, status, texto, loudness, pico, silencio, custoUsd, erro, momentaneo ? JSON.stringify(momentaneo) : null]
  );
}

// Terceira falha seguida: desiste do bloco (vira 'erro' e sai da fila). O
// buraco no texto e melhor que pagar a mesma chamada falhando pra sempre.
async function failTranscript(id, erro) {
  await pool.query(
    `UPDATE live_transcripts SET error_message = $2,
            status = CASE WHEN attempts >= 3 THEN 'erro' ELSE status END
      WHERE id = $1`,
    [id, String(erro).slice(0, 500)]
  );
}

// Ate onde a transcricao da sessao esta CONTINUA: o fim do ultimo bloco antes
// do primeiro que ainda esta pendente. A triagem so olha ate ai - pular um
// buraco faria a IA julgar um trecho sem saber o que veio antes.
async function transcriptCoverage(sessionId) {
  const { rows } = await pool.query(
    `SELECT COALESCE(max(end_offset) FILTER (
              WHERE start_offset < COALESCE((SELECT min(start_offset) FROM live_transcripts
                                              WHERE session_id = $1 AND status = 'pendente'), 1e9)), 0) AS ate
       FROM live_transcripts WHERE session_id = $1`,
    [sessionId]
  );
  return Number(rows[0].ate);
}

async function transcriptsBetween(sessionId, inicio, fim) {
  const { rows } = await pool.query(
    `SELECT * FROM live_transcripts
      WHERE session_id = $1 AND end_offset > $2 AND start_offset < $3 AND status <> 'pendente'
      ORDER BY start_offset`,
    [sessionId, inicio, fim]
  );
  return rows;
}

// ---------------------------------------------------------------- sinais do publico

async function saveChatBuckets(sessionId, baldes) {
  if (!baldes.length) return;
  await pool.query(
    `INSERT INTO live_chat_buckets (session_id, bucket_at, msgs, risadas, hype)
     SELECT $1, b.bucket_at, b.msgs, b.risadas, b.hype
       FROM jsonb_to_recordset($2::jsonb) AS b(bucket_at timestamptz, msgs int, risadas int, hype int)
     ON CONFLICT (session_id, bucket_at) DO UPDATE
       SET msgs = live_chat_buckets.msgs + EXCLUDED.msgs,
           risadas = live_chat_buckets.risadas + EXCLUDED.risadas,
           hype = live_chat_buckets.hype + EXCLUDED.hype`,
    [sessionId, JSON.stringify(baldes)]
  );
}

async function saveViewerClips(sessionId, clipes) {
  const { rows } = await pool.query(
    `INSERT INTO live_viewer_clips (session_id, twitch_clip_id, title, view_count, duration_seconds, clip_created_at)
     SELECT $1, c.id, c.titulo, c.views, c.duracao, c.criado_em
       FROM jsonb_to_recordset($2::jsonb) AS c(id text, titulo text, views int, duracao numeric, criado_em timestamptz)
     ON CONFLICT (twitch_clip_id) DO UPDATE SET view_count = EXCLUDED.view_count
     RETURNING (xmax = 0) AS novo`,
    [sessionId, JSON.stringify(clipes.map((c) => ({ id: c.id, titulo: c.titulo, views: c.views, duracao: c.duracao, criado_em: c.criadoEm })))]
  );
  return rows.filter((r) => r.novo).length;
}

// Tudo que a linha do tempo de sinais precisa, de uma vez: a ponte relogio ->
// gravacao (pedacos de video com hora de fechamento), o chat, os clipes dos
// espectadores e o volume segundo a segundo.
async function signalSources(sessionId) {
  const [pedacos, chat, clipes, volume] = await Promise.all([
    pool.query(
      `SELECT end_offset, closed_at FROM live_segments
        WHERE session_id = $1 AND kind = 'video' AND closed_at IS NOT NULL ORDER BY seq`,
      [sessionId]
    ),
    pool.query('SELECT bucket_at, msgs, risadas, hype FROM live_chat_buckets WHERE session_id = $1 ORDER BY bucket_at', [sessionId]),
    pool.query(
      'SELECT title, view_count, duration_seconds, clip_created_at FROM live_viewer_clips WHERE session_id = $1 ORDER BY clip_created_at',
      [sessionId]
    ),
    pool.query(
      `SELECT start_offset, momentary_1s FROM live_transcripts
        WHERE session_id = $1 AND momentary_1s IS NOT NULL ORDER BY start_offset`,
      [sessionId]
    ),
  ]);
  return {
    pedacos: pedacos.rows.map((r) => ({ fim: Number(r.end_offset), fechouEm: new Date(r.closed_at).getTime() })),
    chat: chat.rows.map((r) => ({ em: new Date(r.bucket_at).getTime(), msgs: r.msgs, risadas: r.risadas, hype: r.hype })),
    clipes: clipes.rows.map((r) => ({ titulo: r.title, views: r.view_count, duracao: Number(r.duration_seconds), em: new Date(r.clip_created_at).getTime() })),
    volume: volume.rows.map((r) => ({ inicio: Number(r.start_offset), porSegundo: r.momentary_1s })),
  };
}

// ---------------------------------------------------------------- candidatos

async function insertCandidate({ sessionId, source, inicio, fim, motivo, nota, requestedBy = null, status = 'pendente' }) {
  const { rows } = await pool.query(
    `INSERT INTO live_candidates (session_id, source, start_offset, end_offset, reason, score, requested_by_user_id, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [sessionId, source, inicio, fim, motivo || null, nota ?? null, requestedBy, status]
  );
  return rows[0];
}

async function candidatesForSession(sessionId) {
  const { rows } = await pool.query(
    "SELECT * FROM live_candidates WHERE session_id = $1 AND source IN ('triagem', 'sinal') ORDER BY start_offset",
    [sessionId]
  );
  return rows;
}

async function pendingCandidates(sessionId, limite = 15) {
  const { rows } = await pool.query(
    `SELECT * FROM live_candidates
      WHERE session_id = $1 AND source IN ('triagem', 'sinal') AND status = 'pendente'
      ORDER BY score DESC NULLS LAST, start_offset LIMIT $2`,
    [sessionId, limite]
  );
  return rows;
}

async function setCandidateStatus(ids, status) {
  if (!ids.length) return;
  await pool.query('UPDATE live_candidates SET status = $2 WHERE id = ANY($1::bigint[])', [ids, status]);
}

// Descarta o que ficou pendente tempo demais (a selecao ja passou por ele e
// preferiu outros) ou, com sessao encerrada, tudo que sobrou.
async function discardStaleCandidates(sessionId, { tudo = false } = {}) {
  await pool.query(
    `UPDATE live_candidates SET status = 'descartado'
      WHERE session_id = $1 AND source IN ('triagem', 'sinal') AND status = 'pendente'
        AND ($2 OR created_at < now() - interval '20 minutes')`,
    [sessionId, tudo]
  );
}

async function setCandidateSignals(candidateId, signals) {
  await pool.query('UPDATE live_candidates SET signals = $2 WHERE id = $1', [candidateId, JSON.stringify(signals)]);
}

// Resultado do juiz. So mexe em quem ainda esta pendente: julgar duas vezes
// (duas voltas do laço) nao troca a nota ja dada.
async function judgeCandidate(candidateId, { status, nota, inicio, fim, titulo, gancho, porque, tipo = null }) {
  await pool.query(
    `UPDATE live_candidates
        SET status = $2, final_score = $3, final_start = $4, final_end = $5, title = $6, hook = $7,
            reason = COALESCE(NULLIF($8, ''), reason), moment_type = $9, judged_at = now()
      WHERE id = $1 AND status = 'pendente'`,
    [candidateId, status, nota, inicio, fim, titulo, gancho, porque, tipo]
  );
}

// Aprovados pelo juiz, do melhor pro pior (empate: o que aconteceu antes).
async function approvedCandidates(sessionId) {
  const { rows } = await pool.query(
    `SELECT * FROM live_candidates
      WHERE session_id = $1 AND status = 'escolhido' AND final_score IS NOT NULL AND final_start IS NOT NULL
      ORDER BY final_score DESC, start_offset`,
    [sessionId]
  );
  return rows;
}

// Quem acompanha o canal, com o nivel de qualidade de cada um (padrao 3).
async function followersWithQuality(channelId) {
  const { rows } = await pool.query(
    `SELECT f.user_id, COALESCE(s.qualidade, 3) AS qualidade
       FROM live_channel_follows f
       LEFT JOIN live_clip_settings s ON s.user_id = f.user_id
      WHERE f.live_channel_id = $1 AND f.is_active
      ORDER BY f.user_id`,
    [channelId]
  );
  return rows.map((r) => ({ user_id: Number(r.user_id), qualidade: Number(r.qualidade) }));
}

// Cortes que o juiz ja deu pra este usuario nesta sessao (o "Clipar agora" nao
// conta: foi pedido a mao, nao entra no teto do nivel).
async function countUserClipsFromJudge(sessionId, userId) {
  const { rows } = await pool.query(
    "SELECT count(*) AS n FROM live_clips WHERE session_id = $1 AND user_id = $2 AND source <> 'clipar_agora'",
    [sessionId, userId]
  );
  return Number(rows[0].n);
}

async function userClipRanges(sessionId, userId) {
  const { rows } = await pool.query(
    'SELECT start_offset, end_offset FROM live_clips WHERE session_id = $1 AND user_id = $2',
    [sessionId, userId]
  );
  return rows;
}

// ---------------------------------------------------------------- configuracao por usuario

async function getClipSettings(userId) {
  const { rows } = await pool.query('SELECT * FROM live_clip_settings WHERE user_id = $1', [userId]);
  return rows[0] || null;
}

async function upsertClipSettings(userId, c) {
  const { rows } = await pool.query(
    `INSERT INTO live_clip_settings
       (user_id, usar_estilo_dos_videos, estilo, qualidade, camera_modo, camera_posicao, camera_altura_percent, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, now())
     ON CONFLICT (user_id) DO UPDATE SET
       usar_estilo_dos_videos = EXCLUDED.usar_estilo_dos_videos, estilo = EXCLUDED.estilo,
       qualidade = EXCLUDED.qualidade, camera_modo = EXCLUDED.camera_modo,
       camera_posicao = EXCLUDED.camera_posicao, camera_altura_percent = EXCLUDED.camera_altura_percent,
       updated_at = now()
     RETURNING *`,
    [userId, c.usar_estilo_dos_videos, JSON.stringify(c.estilo || {}), c.qualidade, c.camera_modo, c.camera_posicao, c.camera_altura_percent]
  );
  return rows[0];
}

// ---------------------------------------------------------------- cortes

async function insertClip({ sessionId, channelId, userId, candidateId, source, inicio, fim, titulo, gancho, nota }) {
  const { rows } = await pool.query(
    `INSERT INTO live_clips (session_id, live_channel_id, user_id, candidate_id, source, start_offset, end_offset, title, hook, score)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
    [sessionId, channelId, userId, candidateId, source, inicio, fim, titulo || null, gancho || null, nota ?? null]
  );
  return rows[0];
}

// Um candidato vira no maximo um corte por usuario (indice unico): duas voltas
// da distribuicao ao mesmo tempo nunca duplicam. Devolve null se ja existia.
async function insertClipOnce({ sessionId, channelId, userId, candidateId, source, inicio, fim, titulo, gancho, nota }) {
  const { rows } = await pool.query(
    `INSERT INTO live_clips (session_id, live_channel_id, user_id, candidate_id, source, start_offset, end_offset, title, hook, score)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (candidate_id, user_id) WHERE candidate_id IS NOT NULL DO NOTHING
     RETURNING *`,
    [sessionId, channelId, userId, candidateId, source, inicio, fim, titulo || null, gancho || null, nota ?? null]
  );
  return rows[0] || null;
}

async function setClipWebcam(clipId, webcam) {
  await pool.query('UPDATE live_clips SET webcam = $2 WHERE id = $1', [clipId, webcam ? JSON.stringify(webcam) : null]);
}

// Proximo corte a renderizar. O de "Clipar agora" so fica pronto pra render
// quando a gravacao ja passou do fim dele (o video ainda nao existe em disco
// antes disso) - por isso a condicao sobre recorded_seconds.
async function claimClipToRender() {
  const { rows } = await pool.query(
    `UPDATE live_clips k SET status = 'renderizando', render_progress = 0
      WHERE k.id = (
        SELECT k2.id FROM live_clips k2
          LEFT JOIN live_sessions s ON s.id = k2.session_id
         WHERE k2.status = 'na_fila'
           AND (k2.source <> 'clipar_agora' OR s.recorded_seconds >= k2.end_offset OR s.status <> 'gravando')
         ORDER BY (k2.source = 'clipar_agora') DESC, k2.created_at
         LIMIT 1 FOR UPDATE OF k2 SKIP LOCKED)
      RETURNING k.*`
  );
  return rows[0] || null;
}

async function updateClipProgress(clipId, percent) {
  await pool.query('UPDATE live_clips SET render_progress = $2 WHERE id = $1', [clipId, Math.round(percent)]);
}

async function finishClip(clipId, { inicio, fim, titulo, gancho, clipPath, thumbPath }) {
  await pool.query(
    `UPDATE live_clips SET status = 'pronto', render_progress = 100, ready_at = now(),
            start_offset = COALESCE($2, start_offset), end_offset = COALESCE($3, end_offset),
            title = COALESCE($4, title), hook = COALESCE($5, hook),
            local_clip_path = $6, thumbnail_path = $7, error_message = NULL
      WHERE id = $1`,
    [clipId, inicio, fim, titulo, gancho, clipPath, thumbPath]
  );
}

async function failClip(clipId, erro) {
  await pool.query("UPDATE live_clips SET status = 'erro', error_message = $2 WHERE id = $1", [clipId, String(erro).slice(0, 500)]);
}

// Na partida do worker: render interrompido volta pra fila.
async function requeueInterruptedRenders() {
  const { rowCount } = await pool.query("UPDATE live_clips SET status = 'na_fila', render_progress = 0 WHERE status = 'renderizando'");
  return rowCount;
}

async function listClipsForUser(userId, { channelId = null, ordem = 'recentes', limite = 100 } = {}) {
  const ordenacao = ordem === 'nota' ? 'k.score DESC NULLS LAST, k.created_at DESC' : 'k.created_at DESC';
  const { rows } = await pool.query(
    `SELECT k.*, c.login, c.display_name FROM live_clips k JOIN live_channels c ON c.id = k.live_channel_id
      WHERE k.user_id = $1 AND ($2::bigint IS NULL OR k.live_channel_id = $2)
      ORDER BY ${ordenacao} LIMIT $3`,
    [userId, channelId, limite]
  );
  return rows;
}

async function findClipForUser(clipId, userId) {
  const { rows } = await pool.query('SELECT * FROM live_clips WHERE id = $1 AND user_id = $2', [clipId, userId]);
  return rows[0] || null;
}

async function deleteClip(clipId, userId) {
  const { rows } = await pool.query('DELETE FROM live_clips WHERE id = $1 AND user_id = $2 RETURNING *', [clipId, userId]);
  return rows[0] || null;
}

// ---------------------------------------------------------------- custos

async function recordCost({ channelId, sessionId, kind, audioSeconds = 0, inputTokens = 0, outputTokens = 0, custoUsd = 0 }) {
  await pool.query(
    `INSERT INTO live_costs (live_channel_id, session_id, kind, audio_seconds, input_tokens, output_tokens, cost_usd)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [channelId, sessionId, kind, audioSeconds, inputTokens, outputTokens, custoUsd]
  );
}

// Custo e horas gravadas por canal num periodo, e o total - pra tela medir
// "quanto custa uma hora de live", que e a pergunta que a validacao responde.
async function costSummary(desde) {
  const { rows } = await pool.query(
    `SELECT c.id, c.login,
            (SELECT COALESCE(sum(cost_usd), 0) FROM live_costs x WHERE x.live_channel_id = c.id AND x.created_at >= $1) AS custo_usd,
            (SELECT COALESCE(sum(recorded_seconds), 0) FROM live_sessions s WHERE s.live_channel_id = c.id AND s.started_at >= $1) AS segundos_gravados,
            (SELECT count(*) FROM live_clips k WHERE k.live_channel_id = c.id AND k.status = 'pronto' AND k.created_at >= $1) AS cortes
       FROM live_channels c ORDER BY c.login`,
    [desde]
  );
  const porTipo = await pool.query(
    'SELECT kind, COALESCE(sum(cost_usd), 0) AS custo_usd FROM live_costs WHERE created_at >= $1 GROUP BY kind',
    [desde]
  );
  return {
    canais: rows.map((r) => ({
      id: Number(r.id),
      login: r.login,
      custoUsd: Number(r.custo_usd),
      horasGravadas: Number(r.segundos_gravados) / 3600,
      cortes: Number(r.cortes),
    })),
    porTipo: Object.fromEntries(porTipo.rows.map((r) => [r.kind, Number(r.custo_usd)])),
  };
}

module.exports = {
  upsertChannel,
  follow,
  unfollow,
  isFollowing,
  listWatchedChannels,
  activeFollowerIds,
  updateChannelStatus,
  listChannelsForUser,
  createSession,
  setSessionDir,
  findSession,
  listRecordingSessions,
  recordingSessionForChannel,
  endSession,
  interruptOrphanSessions,
  updateSessionProgress,
  recordedSecondsToday,
  setTriagedUntil,
  markSelection,
  listSessionsForAnalysis,
  insertSegments,
  sessionTotals,
  videoSegmentsBetween,
  segmentsOlderThan,
  markSegmentsDeleted,
  claimPendingTranscript,
  finishTranscript,
  failTranscript,
  transcriptCoverage,
  transcriptsBetween,
  saveChatBuckets,
  saveViewerClips,
  signalSources,
  insertCandidate,
  candidatesForSession,
  pendingCandidates,
  setCandidateStatus,
  discardStaleCandidates,
  setCandidateSignals,
  judgeCandidate,
  approvedCandidates,
  followersWithQuality,
  countUserClipsFromJudge,
  userClipRanges,
  getClipSettings,
  upsertClipSettings,
  insertClipOnce,
  setClipWebcam,
  insertClip,
  claimClipToRender,
  updateClipProgress,
  finishClip,
  failClip,
  requeueInterruptedRenders,
  listClipsForUser,
  findClipForUser,
  deleteClip,
  recordCost,
  costSummary,
};
