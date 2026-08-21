// O que já foi baixado e transcrito de cada vídeo do YouTube, para ser
// reaproveitado por qualquer cliente que monitore o mesmo canal.
//
// Uma linha por youtube_video_id (não por cliente, não por canal). Ver
// migrations/063_download_e_transcricao_compartilhados.sql para o porquê.
'use strict';

const pool = require('../db/pool');

async function findByYoutubeVideoId(youtubeVideoId) {
  if (!youtubeVideoId) return null;
  const { rows } = await pool.query('SELECT * FROM shared_video_assets WHERE youtube_video_id = $1', [
    youtubeVideoId,
  ]);
  return rows[0] || null;
}

// Chamado depois que um download terminou de verdade. Upsert porque a linha
// pode já existir só com a transcrição (arquivo apagado pela limpeza e vídeo
// baixado de novo depois).
async function saveDownload(youtubeVideoId, { localVideoPath, bytes = null, egressType = null, tunnelId = null }) {
  const { rows } = await pool.query(
    `INSERT INTO shared_video_assets
       (youtube_video_id, local_video_path, video_bytes, download_egress_type, download_tunnel_id, downloaded_at)
     VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (youtube_video_id) DO UPDATE SET
       local_video_path = $2, video_bytes = $3, download_egress_type = $4,
       download_tunnel_id = $5, downloaded_at = now(), updated_at = now()
     RETURNING *`,
    [youtubeVideoId, localVideoPath, bytes, egressType, tunnelId]
  );
  return rows[0];
}

async function saveTranscript(
  youtubeVideoId,
  { transcriptText, transcriptWords, whisperAudioSeconds = null, whisperCostUsd = null, language = null }
) {
  const { rows } = await pool.query(
    `INSERT INTO shared_video_assets
       (youtube_video_id, transcript_text, transcript_words, whisper_audio_seconds,
        whisper_cost_usd, transcript_language, transcribed_at)
     VALUES ($1, $2, $3, $4, $5, $6, now())
     ON CONFLICT (youtube_video_id) DO UPDATE SET
       transcript_text = $2, transcript_words = $3, whisper_audio_seconds = $4,
       whisper_cost_usd = $5, transcript_language = $6, transcribed_at = now(), updated_at = now()
     RETURNING *`,
    [youtubeVideoId, transcriptText, JSON.stringify(transcriptWords), whisperAudioSeconds, whisperCostUsd, language]
  );
  return rows[0];
}

// Contadores só de medição (painel "Banda"): quantas vezes cada etapa cara
// foi evitada. Nunca decidem nada no pipeline.
async function registerDownloadReuse(youtubeVideoId) {
  await pool.query(
    `UPDATE shared_video_assets
       SET download_reuse_count = download_reuse_count + 1, updated_at = now()
     WHERE youtube_video_id = $1`,
    [youtubeVideoId]
  );
}

async function registerTranscriptReuse(youtubeVideoId) {
  await pool.query(
    `UPDATE shared_video_assets
       SET transcript_reuse_count = transcript_reuse_count + 1, updated_at = now()
     WHERE youtube_video_id = $1`,
    [youtubeVideoId]
  );
}

// Só quem ainda ocupa disco - é o que o job de limpeza precisa varrer.
async function listWithFile() {
  const { rows } = await pool.query(
    'SELECT * FROM shared_video_assets WHERE local_video_path IS NOT NULL ORDER BY downloaded_at'
  );
  return rows;
}

// O arquivo saiu do disco; a transcrição continua valendo (é o pedaço barato
// de guardar e caro de refazer).
async function clearFile(youtubeVideoId) {
  await pool.query(
    `UPDATE shared_video_assets
       SET local_video_path = NULL, updated_at = now()
     WHERE youtube_video_id = $1`,
    [youtubeVideoId]
  );
}

// Economia acumulada no período, para o painel "Banda" do admin.
async function savingsSince(since, until = new Date()) {
  const { rows } = await pool.query(
    `SELECT
       count(*) FILTER (WHERE sv.download_egress_type = 'reuse')::int AS downloads_reaproveitados,
       coalesce(sum(sva.video_bytes) FILTER (WHERE sv.download_egress_type = 'reuse'), 0) AS bytes_economizados,
       count(*) FILTER (WHERE sv.transcript_reused)::int AS transcricoes_reaproveitadas,
       coalesce(sum(sva.whisper_cost_usd) FILTER (WHERE sv.transcript_reused), 0) AS whisper_usd_economizado
     FROM source_videos sv
     JOIN shared_video_assets sva ON sva.youtube_video_id = sv.youtube_video_id
     WHERE sv.created_at >= $1 AND sv.created_at <= $2`,
    [since, until]
  );
  const r = rows[0];
  return {
    downloadsReaproveitados: r.downloads_reaproveitados,
    bytesEconomizados: Number(r.bytes_economizados),
    transcricoesReaproveitadas: r.transcricoes_reaproveitadas,
    whisperUsdEconomizado: Number(r.whisper_usd_economizado),
  };
}

module.exports = {
  findByYoutubeVideoId,
  saveDownload,
  saveTranscript,
  registerDownloadReuse,
  registerTranscriptReuse,
  listWithFile,
  clearFile,
  savingsSince,
};
