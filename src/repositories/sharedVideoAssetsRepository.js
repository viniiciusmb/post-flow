// O que já foi baixado e transcrito de cada vídeo do YouTube, para ser
// reaproveitado por qualquer cliente que monitore o mesmo canal.
//
// Uma linha por (youtube_video_id, idioma do áudio) — não por cliente, não por
// canal. Ver migrations/063_download_e_transcricao_compartilhados.sql para o
// compartilhamento em si, e 076_idioma_do_audio.sql para o idioma ter entrado
// na identidade: o mesmo vídeo dublado em português e em inglês são DOIS
// arquivos e DUAS transcrições, e confundi-los entregaria o idioma errado sem
// erro nenhum em lugar nenhum.
'use strict';

const pool = require('../db/pool');
const idiomaDoAudio = require('../lib/idiomaDoAudio');
const logger = require('../lib/logger');

async function findByYoutubeVideoId(youtubeVideoId, audioLanguage = idiomaDoAudio.ORIGINAL) {
  if (!youtubeVideoId) return null;
  const { rows } = await pool.query(
    'SELECT * FROM shared_video_assets WHERE youtube_video_id = $1 AND audio_language = $2',
    [youtubeVideoId, idiomaDoAudio.normalizar(audioLanguage)]
  );
  return rows[0] || null;
}

// Chamado depois que um download terminou de verdade. Upsert porque a linha
// pode já existir só com a transcrição (arquivo apagado pela limpeza e vídeo
// baixado de novo depois).
async function saveDownload(
  youtubeVideoId,
  { localVideoPath, bytes = null, egressType = null, tunnelId = null, audioLanguage = idiomaDoAudio.ORIGINAL }
) {
  const { rows } = await pool.query(
    `INSERT INTO shared_video_assets
       (youtube_video_id, audio_language, local_video_path, video_bytes, download_egress_type,
        download_tunnel_id, downloaded_at)
     VALUES ($1, $2, $3, $4, $5, $6, now())
     ON CONFLICT (youtube_video_id, audio_language) DO UPDATE SET
       local_video_path = $3, video_bytes = $4, download_egress_type = $5,
       download_tunnel_id = $6, downloaded_at = now(), updated_at = now()
     RETURNING *`,
    [youtubeVideoId, idiomaDoAudio.normalizar(audioLanguage), localVideoPath, bytes, egressType, tunnelId]
  );
  return rows[0];
}

async function saveTranscript(
  youtubeVideoId,
  {
    transcriptText,
    transcriptWords,
    whisperAudioSeconds = null,
    whisperCostUsd = null,
    language = null,
    audioLanguage = idiomaDoAudio.ORIGINAL,
  }
) {
  const { rows } = await pool.query(
    `INSERT INTO shared_video_assets
       (youtube_video_id, audio_language, transcript_text, transcript_words, whisper_audio_seconds,
        whisper_cost_usd, transcript_language, transcribed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, now())
     ON CONFLICT (youtube_video_id, audio_language) DO UPDATE SET
       transcript_text = $3, transcript_words = $4, whisper_audio_seconds = $5,
       whisper_cost_usd = $6, transcript_language = $7, transcribed_at = now(), updated_at = now()
     RETURNING *`,
    [
      youtubeVideoId,
      idiomaDoAudio.normalizar(audioLanguage),
      transcriptText,
      JSON.stringify(transcriptWords),
      whisperAudioSeconds,
      whisperCostUsd,
      language,
    ]
  );
  return rows[0];
}

// Contadores só de medição (painel "Banda"): quantas vezes cada etapa cara
// foi evitada. Nunca decidem nada no pipeline.
async function registerDownloadReuse(youtubeVideoId, audioLanguage = idiomaDoAudio.ORIGINAL) {
  await pool.query(
    `UPDATE shared_video_assets
       SET download_reuse_count = download_reuse_count + 1, updated_at = now()
     WHERE youtube_video_id = $1 AND audio_language = $2`,
    [youtubeVideoId, idiomaDoAudio.normalizar(audioLanguage)]
  );
}

async function registerTranscriptReuse(youtubeVideoId, audioLanguage = idiomaDoAudio.ORIGINAL) {
  await pool.query(
    `UPDATE shared_video_assets
       SET transcript_reuse_count = transcript_reuse_count + 1, updated_at = now()
     WHERE youtube_video_id = $1 AND audio_language = $2`,
    [youtubeVideoId, idiomaDoAudio.normalizar(audioLanguage)]
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
// O idioma NAO e opcional aqui de proposito. Limpar "todas as linhas deste
// video" apagaria do banco a referencia de um arquivo em OUTRO idioma que
// continua em disco - ele viraria orfao e seria varrido uma hora depois, no
// meio de um processamento que ainda ia usa-lo.
async function clearFile(youtubeVideoId, audioLanguage) {
  await pool.query(
    `UPDATE shared_video_assets
       SET local_video_path = NULL, updated_at = now()
     WHERE youtube_video_id = $1 AND audio_language = $2`,
    [youtubeVideoId, idiomaDoAudio.normalizar(audioLanguage)]
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
     -- O idioma entra no JOIN junto com o video. Sem ele, um video que existe
     -- em dois idiomas casaria DUAS linhas com o mesmo source_video e a
     -- economia apareceria dobrada - o mesmo fan-out que ja inflou custo na
     -- tela de Clientes uma vez.
     JOIN shared_video_assets sva
       ON sva.youtube_video_id = sv.youtube_video_id
      AND sva.audio_language = coalesce(sv.audio_language, 'original')
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

// Impede que DOIS vídeos do mesmo YouTube baixem o mesmo arquivo ao mesmo
// tempo.
//
// Com um vídeo por vez isso era impossível. Passando a processar vários em
// paralelo, dois clientes que acompanham o mesmo canal podem cair no download
// no mesmo instante: os dois consultam o cache, os dois não encontram nada, e
// os dois baixam — pagando a banda duas vezes, que é exatamente o desperdício
// que o compartilhamento existe para evitar.
//
// A trava é por VÍDEO, não global: downloads de vídeos diferentes seguem em
// paralelo normalmente. Quem chega depois espera, e ao entrar encontra o
// arquivo já no cache.
//
// Conexão DEDICADA, fora do pool: o bloqueio dura o download inteiro (minutos)
// e prender conexões do pool por tanto tempo secaria o resto do sistema.
async function comTravaDeDownload(youtubeVideoId, fn, audioLanguage = idiomaDoAudio.ORIGINAL) {
  if (!youtubeVideoId) return fn();

  // A trava e por (video, idioma): dois clientes baixando o MESMO video em
  // idiomas diferentes sao dois arquivos diferentes, e nao ha motivo pra um
  // esperar o outro.
  const chave = `${youtubeVideoId}:${idiomaDoAudio.normalizar(audioLanguage)}`;

  const { Client } = require('pg');
  const config = require('../config');
  const client = new Client({ connectionString: config.databaseUrl });

  try {
    await client.connect();
  } catch (err) {
    // Sem a trava o pior caso é baixar duas vezes - ruim, mas melhor do que
    // não processar o vídeo.
    logger.error(`Nao consegui abrir conexao pra trava de download (seguindo sem ela): ${err.message}`);
    return fn();
  }

  try {
    // hashtext transforma o id do vídeo num número, que é o que o advisory
    // lock aceita. Colisão entre dois ids diferentes só faria um esperar o
    // outro sem necessidade - não corrompe nada.
    await client.query('SELECT pg_advisory_lock(hashtext($1))', [chave]);
    return await fn();
  } finally {
    await client.query('SELECT pg_advisory_unlock(hashtext($1))', [chave]).catch(() => {});
    await client.end().catch(() => {});
  }
}

module.exports = {
  comTravaDeDownload,
  findByYoutubeVideoId,
  saveDownload,
  saveTranscript,
  registerDownloadReuse,
  registerTranscriptReuse,
  listWithFile,
  clearFile,
  savingsSince,
};
