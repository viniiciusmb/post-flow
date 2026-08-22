'use strict';

const pool = require('../db/pool');

// ON CONFLICT precisa citar o mesmo predicado WHERE do indice parcial
// (uq_source_videos_video_per_owner, migrations/042) - sem isso o Postgres
// nao consegue inferir qual indice usar e a insercao falha com "there is no
// unique or exclusion constraint matching the ON CONFLICT specification".
// A unicidade e por (video, dono) - nao global - pra dois clientes
// diferentes poderem processar o MESMO video do YouTube de forma
// independente (cada um paga o proprio credito), inclusive quando os dois
// monitoram o mesmo canal real por engano/coincidencia.
async function createIfNotExists({ youtubeChannelId, ownerClientUserId, youtubeVideoId, title, thumbnailUrl, publishedAt, durationSeconds }) {
  const { rows } = await pool.query(
    `INSERT INTO source_videos (youtube_channel_id, owner_client_user_id, youtube_video_id, title, thumbnail_url, published_at, duration_seconds)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (youtube_video_id, owner_client_user_id) WHERE youtube_video_id IS NOT NULL DO NOTHING
     RETURNING *`,
    [youtubeChannelId, ownerClientUserId, youtubeVideoId, title, thumbnailUrl, publishedAt, durationSeconds]
  );
  return rows[0] || null;
}

// Video colado manualmente pelo cliente (input_type = 'manual') - nao tem
// canal, pertence direto ao cliente que colou o link (tambem o dono).
async function createManual({ clientUserId, youtubeVideoId, title, thumbnailUrl, publishedAt, durationSeconds }) {
  const { rows } = await pool.query(
    `INSERT INTO source_videos (client_user_id, owner_client_user_id, input_type, youtube_video_id, title, thumbnail_url, published_at, duration_seconds)
     VALUES ($1, $1, 'manual', $2, $3, $4, $5, $6)
     ON CONFLICT (youtube_video_id, owner_client_user_id) WHERE youtube_video_id IS NOT NULL DO NOTHING
     RETURNING *`,
    [clientUserId, youtubeVideoId, title, thumbnailUrl, publishedAt, durationSeconds]
  );
  return rows[0] || null;
}

// Video enviado por upload direto (input_type = 'upload') - sem
// youtube_video_id nenhum, pertence direto ao cliente que enviou.
async function createUpload({ clientUserId, title, localVideoPath, durationSeconds }) {
  const { rows } = await pool.query(
    `INSERT INTO source_videos (client_user_id, owner_client_user_id, input_type, title, local_video_path, duration_seconds, status)
     VALUES ($1, $1, 'upload', $2, $3, $4, 'detected')
     RETURNING *`,
    [clientUserId, title, localVideoPath, durationSeconds]
  );
  return rows[0];
}

// Escopado por dono - cada cliente enxerga so a propria copia do video (ver
// migration 042). E o que permite dois clientes processarem o mesmo video
// do YouTube de forma independente, sem um bloquear o outro.
async function findByYoutubeVideoIdForOwner(youtubeVideoId, ownerClientUserId) {
  const { rows } = await pool.query(
    'SELECT * FROM source_videos WHERE youtube_video_id = $1 AND owner_client_user_id = $2',
    [youtubeVideoId, ownerClientUserId]
  );
  return rows[0] || null;
}

async function findById(id) {
  const { rows } = await pool.query('SELECT * FROM source_videos WHERE id = $1', [id]);
  return rows[0] || null;
}

// Mesma logica de posse do listForClient (canal ou dono direto pra video
// manual) - usado pra garantir que o cliente so mexe nos proprios videos.
async function findByIdOwnedByClient(id, clientUserId) {
  const { rows } = await pool.query(
    `SELECT sv.* FROM source_videos sv
     LEFT JOIN youtube_channels yc ON yc.id = sv.youtube_channel_id
     WHERE sv.id = $1 AND coalesce(yc.client_user_id, sv.client_user_id) = $2`,
    [id, clientUserId]
  );
  return rows[0] || null;
}

// Reinicia um video que ficou em erro (ex: bloqueio do YouTube que ja foi
// corrigido) - so mexe se ainda estiver em 'error', pra nao interferir com
// um processamento em andamento.
// Remove o video-fonte (cortes/videos/postagens ligados caem em cascata).
// So mexe se pertencer mesmo ao cliente pedindo.
async function deleteByIdOwnedByClient(id, clientUserId) {
  const { rowCount } = await pool.query(
    `DELETE FROM source_videos
     WHERE id = $1
       AND id IN (
         SELECT sv.id FROM source_videos sv
         LEFT JOIN youtube_channels yc ON yc.id = sv.youtube_channel_id
         WHERE coalesce(yc.client_user_id, sv.client_user_id) = $2
       )`,
    [id, clientUserId]
  );
  return rowCount > 0;
}

// Retry manual (cliente ou admin clicou "tentar novamente") - so mexe se
// estiver em 'error' ou 'cancelled', pra nunca reiniciar um video que ja
// esta 'ready' ou em andamento (era isso que causava reprocessamento
// duplicado quando o retry do admin nao tinha essa checagem). Zera o
// contador de retry automatico, ja que essa foi uma tentativa manual.
// Usado pela limpeza automatica de retencao (job de fundo, sem dono pra
// checar) - so chamado depois que todos os cortes desse video ja foram
// apagados (ver postingCleanupJob.js).
async function deleteById(id) {
  await pool.query('DELETE FROM source_videos WHERE id = $1', [id]);
}

async function resetForRetry(id) {
  const { rows } = await pool.query(
    `UPDATE source_videos
     SET status = 'detected', error_message = NULL, local_video_path = NULL,
         transcript_text = NULL, transcript_words = NULL, transcript_reused = false,
         processing_started_at = NULL,
         cancel_requested = false, auto_retry_count = 0, updated_at = now()
     WHERE id = $1 AND status IN ('error', 'cancelled')
     RETURNING *`,
    [id]
  );
  return rows[0] || null;
}

// Retry automatico (job de fundo) - mesma logica do manual, mas incrementa
// o contador em vez de zerar, pra parar de tentar sozinho depois de um teto.
async function resetForAutoRetry(id) {
  const { rows } = await pool.query(
    `UPDATE source_videos
     SET status = 'detected', error_message = NULL, local_video_path = NULL,
         transcript_text = NULL, transcript_words = NULL, transcript_reused = false,
         processing_started_at = NULL,
         cancel_requested = false, auto_retry_count = auto_retry_count + 1, updated_at = now()
     WHERE id = $1 AND status = 'error'
     RETURNING *`,
    [id]
  );
  return rows[0] || null;
}

// Pedido de pausa (cooperativo - o worker confere a flag entre etapas). So
// permitido enquanto o video esta mesmo em andamento.
const ACTIVE_STATUSES_FOR_PAUSE = ['downloading', 'transcribing', 'selecting_clips', 'cutting'];
async function requestPauseByIdOwnedByClient(id, clientUserId) {
  const { rows } = await pool.query(
    `UPDATE source_videos
     SET cancel_requested = true, updated_at = now()
     WHERE id = $1 AND status = ANY($2)
       AND id IN (
         SELECT sv.id FROM source_videos sv
         LEFT JOIN youtube_channels yc ON yc.id = sv.youtube_channel_id
         WHERE coalesce(yc.client_user_id, sv.client_user_id) = $3
       )
     RETURNING *`,
    [id, ACTIVE_STATUSES_FOR_PAUSE, clientUserId]
  );
  return rows[0] || null;
}

// Retomar um video pausado - so limpa a flag (o job, ao ser reenfileirado,
// ve status='paused' e continua de onde parou sozinho, ver processVideoJob.js).
async function resumeByIdOwnedByClient(id, clientUserId) {
  const { rows } = await pool.query(
    `UPDATE source_videos
     SET cancel_requested = false, updated_at = now()
     WHERE id = $1 AND status = 'paused'
       AND id IN (
         SELECT sv.id FROM source_videos sv
         LEFT JOIN youtube_channels yc ON yc.id = sv.youtube_channel_id
         WHERE coalesce(yc.client_user_id, sv.client_user_id) = $2
       )
     RETURNING *`,
    [id, clientUserId]
  );
  return rows[0] || null;
}

// Videos parados por falta de credito (ver creditsService/AwaitingCreditsError) -
// usado pra "destravar" tudo de um cliente quando ele compra credito avulso
// ou liga o cartao de excedente (ver creditsUnlockService).
async function findAwaitingCreditsByClientId(clientUserId) {
  const { rows } = await pool.query(
    `SELECT sv.* FROM source_videos sv
     LEFT JOIN youtube_channels yc ON yc.id = sv.youtube_channel_id
     WHERE coalesce(yc.client_user_id, sv.client_user_id) = $1 AND sv.status = 'aguardando_creditos'`,
    [clientUserId]
  );
  return rows;
}

async function resumeAwaitingCredits(id) {
  const { rows } = await pool.query(
    `UPDATE source_videos SET status = 'detected', updated_at = now() WHERE id = $1 AND status = 'aguardando_creditos' RETURNING *`,
    [id]
  );
  return rows[0] || null;
}

// Videos parados esperando o computador do cliente voltar (ele escolheu so
// baixar pela internet dele). Mesmo par de consultas do fluxo de credito.
async function findAwaitingTunnelByClientId(clientUserId) {
  const { rows } = await pool.query(
    `SELECT sv.* FROM source_videos sv
     LEFT JOIN youtube_channels yc ON yc.id = sv.youtube_channel_id
     WHERE coalesce(yc.client_user_id, sv.client_user_id) = $1 AND sv.status = 'aguardando_conexao'`,
    [clientUserId]
  );
  return rows;
}

async function resumeAwaitingTunnel(id) {
  const { rows } = await pool.query(
    `UPDATE source_videos SET status = 'detected', updated_at = now()
      WHERE id = $1 AND status = 'aguardando_conexao' RETURNING *`,
    [id]
  );
  return rows[0] || null;
}

// Erros que parecem transitorios (proxy/rede) e ainda nao esgotaram as
// tentativas automaticas, parados ha tempo suficiente pra nao brigar com um
// retry manual que o cliente acabou de disparar.
async function findTransientErrorsForAutoRetry() {
  const { rows } = await pool.query(
    `SELECT * FROM source_videos
     WHERE status = 'error' AND auto_retry_count < 3
       AND updated_at < now() - interval '10 minutes'
       AND error_message ~* 'proxy|tunnel|timeout|econnreset|network|407|502|503'`
  );
  return rows;
}

// Videos detectados que nunca chegaram a comecar (protecao pro caso raro do
// enfileiramento falhar silenciosamente entre a deteccao e o processamento).
async function findStuckDetected() {
  const { rows } = await pool.query(
    `SELECT * FROM source_videos WHERE status = 'detected' AND created_at < now() - interval '30 minutes'`
  );
  return rows;
}

// billingBlockReason so faz sentido junto de 'aguardando_creditos'. Qualquer
// outro status limpa o motivo: sem isso, um video que voltou a processar
// continuaria carregando "cartao recusado" e a tela mostraria o aviso antigo.
async function updateStatus(id, status, { errorMessage = null, billingBlockReason = null } = {}) {
  const { rows } = await pool.query(
    `UPDATE source_videos
        SET status = $2,
            error_message = $3,
            billing_block_reason = CASE WHEN $2 = 'aguardando_creditos' THEN $4::text ELSE NULL END,
            updated_at = now()
      WHERE id = $1
      RETURNING *`,
    [id, status, errorMessage, billingBlockReason]
  );
  return rows[0] || null;
}

async function saveDownload(id, localVideoPath, { bytes = null, egressType = null, tunnelId = null } = {}) {
  await pool.query(
    `UPDATE source_videos
     SET local_video_path = $2, download_bytes = $3, download_egress_type = $4, download_tunnel_id = $5,
         download_completed_at = now(), updated_at = now()
     WHERE id = $1`,
    [id, localVideoPath, bytes, egressType, tunnelId]
  );
}

// reused = a transcricao veio pronta de shared_video_assets (outro cliente
// ja tinha pago o Whisper por este mesmo video do YouTube). Fica gravado
// porque o painel "Banda" mede a economia - deduzir por "custo zero" mentiria,
// ja que existe mais de um jeito de o custo ser zero.
async function saveTranscript(
  id,
  {
    transcriptText,
    transcriptWords,
    whisperAudioSeconds = null,
    whisperCostUsd = null,
    language = null,
    reused = false,
  }
) {
  await pool.query(
    `UPDATE source_videos
     SET transcript_text = $2, transcript_words = $3,
         whisper_audio_seconds = $4, whisper_cost_usd = $5,
         transcript_language = $6, transcript_reused = $7,
         transcription_completed_at = now(), updated_at = now()
     WHERE id = $1`,
    [id, transcriptText, JSON.stringify(transcriptWords), whisperAudioSeconds, whisperCostUsd, language, reused]
  );
}

// Quantos videos ainda vao PRECISAR do arquivo baixado deste video do
// YouTube. Usado pelo sharedAssetsCleanupJob pra decidir se ja pode apagar o
// arquivo compartilhado - 'ready' e 'cancelled' ficam de fora porque quem ja
// terminou nao volta a ler o video original; 'error' entra porque o retry
// automatico ainda pode reprocessa-lo.
const STATUS_QUE_AINDA_PRECISA_DO_ARQUIVO = [
  'detected',
  'downloading',
  'transcribing',
  'selecting_clips',
  'cutting',
  'paused',
  'aguardando_creditos',
  'aguardando_conexao',
  'error',
];

async function countPendingByYoutubeVideoId(youtubeVideoId) {
  const { rows } = await pool.query(
    `SELECT count(*)::int AS n
       FROM source_videos
      WHERE youtube_video_id = $1 AND status = ANY($2::text[])`,
    [youtubeVideoId, STATUS_QUE_AINDA_PRECISA_DO_ARQUIVO]
  );
  return rows[0].n;
}

async function saveClaudeUsage(id, { inputTokens, outputTokens, costUsd }) {
  await pool.query(
    `UPDATE source_videos
     SET claude_input_tokens = $2, claude_output_tokens = $3, claude_cost_usd = $4, updated_at = now()
     WHERE id = $1`,
    [id, inputTokens, outputTokens, costUsd]
  );
}

// Marca o fim da etapa de selecao de cortes (seja pela IA ou pelo modo
// "video inteiro"/"quantidade fixa") - usado pra calcular quanto tempo cada
// etapa do pipeline levou (ver metricsRepository.stageTimingsSince). COALESCE
// pra nao sobrescrever se o video for retomado depois de uma pausa e passar
// de novo por esse ponto com os cortes ja escolhidos antes.
async function markClipSelectionCompleted(id) {
  await pool.query(
    `UPDATE source_videos SET clip_selection_completed_at = COALESCE(clip_selection_completed_at, now()) WHERE id = $1`,
    [id]
  );
}

async function markProcessingStarted(id) {
  await pool.query(
    'UPDATE source_videos SET processing_started_at = now(), processing_heartbeat_at = now() WHERE id = $1',
    [id]
  );
}

// Sinal de vida do worker que esta processando este video AGORA. Chamado a
// cada ~60s enquanto o pipeline roda (ver processVideoJob). NAO mexe em
// updated_at de proposito: updated_at e usado por outras consultas (retry
// automatico, por exemplo) e ficaria poluido por um heartbeat de minuto em
// minuto.
async function touchProcessingHeartbeat(id) {
  await pool.query('UPDATE source_videos SET processing_heartbeat_at = now() WHERE id = $1', [id]);
}

// Videos presos numa etapa "em andamento" cujo worker parou de dar sinal de
// vida ha mais de staleMinutes - o processo que os segurava morreu (deploy,
// crash, OOM). Como o heartbeat e de 60s, qualquer staleMinutes >= 5 da uma
// margem enorme; quem ainda esta vivo (inclusive o container antigo durante um
// deploy start-first) continua batendo e nunca aparece aqui.
async function findStuckProcessing(staleMinutes = 10) {
  const { rows } = await pool.query(
    `SELECT * FROM source_videos
     WHERE status IN ('downloading', 'transcribing', 'selecting_clips', 'cutting')
       AND COALESCE(processing_heartbeat_at, processing_started_at, updated_at) < now() - ($1 || ' minutes')::interval`,
    [String(staleMinutes)]
  );
  return rows;
}

// Devolve um video travado pro inicio do pipeline. Nao perde trabalho: o
// processVideoJob pula download/transcricao/cortes ja concluidos (a retomada
// e a mesma usada pelo pausar/retomar). Retorna null se ja estourou o limite
// de ressurreicoes - nesse caso o chamador marca como erro de verdade.
async function markRecoveredFromStuck(id, maxRecoveries = 3) {
  const { rows } = await pool.query(
    `UPDATE source_videos
     SET status = 'detected',
         stuck_recovery_count = stuck_recovery_count + 1,
         processing_heartbeat_at = NULL,
         updated_at = now()
     WHERE id = $1 AND stuck_recovery_count < $2
     RETURNING *`,
    [id, maxRecoveries]
  );
  return rows[0] || null;
}

// Lista videos-fonte de um cliente (via canal ou colados manualmente), com
// contagem de cortes - usada na tela "Videos & Cortes". LEFT JOIN porque
// video manual nao tem canal (yc.client_user_id seria NULL nesse caso).
// tiktok_account_names: pro canal, a (unica) conta vinculada a ele; pra
// video avulso (manual/upload), as contas escolhidas em source_video_tiktok_targets.
// Usado pra mostrar "vai postar em qual conta" na tela Videos & Cortes.
async function listForClient(clientUserId, { youtubeChannelId = null } = {}) {
  const { rows } = await pool.query(
    `SELECT sv.*, yc.channel_name,
            (SELECT count(*) FROM clips c WHERE c.source_video_id = sv.id) AS clip_count,
            (SELECT count(*) FROM clips c WHERE c.source_video_id = sv.id AND c.status = 'ready') AS ready_clip_count,
            COALESCE(
              (SELECT array_agg(ta.display_name ORDER BY ta.display_name) FROM tiktok_accounts ta WHERE ta.id = yc.tiktok_account_id),
              (SELECT array_agg(ta2.display_name ORDER BY ta2.display_name)
               FROM source_video_tiktok_targets svt
               JOIN tiktok_accounts ta2 ON ta2.id = svt.tiktok_account_id
               WHERE svt.source_video_id = sv.id)
            ) AS tiktok_account_names
     FROM source_videos sv
     LEFT JOIN youtube_channels yc ON yc.id = sv.youtube_channel_id
     WHERE coalesce(yc.client_user_id, sv.client_user_id) = $1
       AND ($2::bigint IS NULL OR yc.id = $2)
     -- Ordem da tela "Cortes". Antes era so created_at DESC, entao o video que
     -- estava SENDO PROCESSADO aparecia no fim da lista se tivesse sido
     -- detectado antes dos outros - justamente o que a pessoa mais quer ver
     -- ficava escondido embaixo de tudo.
     --
     -- Agora manda o ESTADO primeiro:
     --   0  processando agora  (e o unico que se mexe sozinho na tela)
     --   1  esperando na fila
     --   2  parado esperando credito
     --   3  pausado pelo cliente
     --   4  com erro           (precisa de atencao, mas nao esta andando)
     --   5  pronto / cancelado (a aba "Prontos" cuida deles)
     ORDER BY
       CASE sv.status
         WHEN 'downloading' THEN 0
         WHEN 'transcribing' THEN 0
         WHEN 'selecting_clips' THEN 0
         WHEN 'cutting' THEN 0
         WHEN 'detected' THEN 1
         WHEN 'aguardando_creditos' THEN 2
         WHEN 'paused' THEN 3
         WHEN 'error' THEN 4
         ELSE 5
       END,
       -- Dentro da fila a ordem e de chegada (o primeiro a entrar e o proximo
       -- a rodar), entao ali o mais ANTIGO vem primeiro. Nos outros grupos o
       -- mais recente e o mais relevante, entao inverte.
       CASE WHEN sv.status IN ('detected', 'aguardando_creditos') THEN sv.created_at END ASC,
       sv.created_at DESC
     LIMIT 100`,
    [clientUserId, youtubeChannelId]
  );
  return rows;
}

const ACTIVE_STATUSES = ['downloading', 'transcribing', 'selecting_clips', 'cutting'];

// Estatisticas pro card "Vídeos na fila" (admin) - qualquer coisa que ainda
// nao chegou em 'ready'/'error'.
async function countInProgress() {
  const { rows } = await pool.query(
    "SELECT count(*)::int AS count FROM source_videos WHERE status NOT IN ('ready', 'error')"
  );
  return rows[0].count;
}

async function countByClientSince(clientUserId, since, until = new Date()) {
  const { rows } = await pool.query(
    `SELECT count(*)::int AS count
     FROM source_videos sv
     LEFT JOIN youtube_channels yc ON yc.id = sv.youtube_channel_id
     WHERE coalesce(yc.client_user_id, sv.client_user_id) = $1
       AND sv.created_at >= $2 AND sv.created_at <= $3`,
    [clientUserId, since, until]
  );
  return rows[0].count;
}

// O video que esta sendo processado agora (se algum) - pro card de destaque
// da tela "Fila de Processamento" do admin. LEFT JOIN pra cobrir video
// manual tambem (sem canal).
// Devolve TODOS os videos em andamento, nao so um. Com o maximo de videos
// simultaneos configuravel, "processando agora" virou uma lista: se o admin
// escolhe 2 e a tela so mostra 1, parece que a configuracao nao funcionou.
async function listCurrentlyProcessing() {
  const { rows } = await pool.query(
    `SELECT sv.*, yc.channel_name, u.email AS client_email, u.business_name AS client_business_name
     FROM source_videos sv
     LEFT JOIN youtube_channels yc ON yc.id = sv.youtube_channel_id
     JOIN users u ON u.id = coalesce(yc.client_user_id, sv.client_user_id)
     WHERE sv.status = ANY($1)
     ORDER BY sv.updated_at ASC`,
    [ACTIVE_STATUSES]
  );
  return rows;
}

// 'aguardando_creditos' entra aqui tambem (nao so 'detected') - senao esses
// videos ficavam invisiveis pro admin (nao aparecem em nenhuma outra lista).
async function listWaiting() {
  const { rows } = await pool.query(
    `SELECT sv.*, yc.channel_name, u.email AS client_email, u.business_name AS client_business_name
     FROM source_videos sv
     LEFT JOIN youtube_channels yc ON yc.id = sv.youtube_channel_id
     JOIN users u ON u.id = coalesce(yc.client_user_id, sv.client_user_id)
     WHERE sv.status IN ('detected', 'aguardando_creditos')
     ORDER BY sv.created_at ASC`
  );
  return rows;
}

// Histórico com o custo real de cada vídeo.
//
// "Real" importa por causa do reaproveitamento: quando dois clientes seguem o
// mesmo canal, só o PRIMEIRO paga o download e o Whisper. O segundo aparece
// com esses custos zerados e marcado como reaproveitado — somar de novo neles
// inflaria o custo total do sistema e faria a margem parecer pior do que é.
//
// Isso já vem naturalmente dos dados: no reaproveitamento o pipeline grava
// download_bytes = 0 e whisper_cost_usd = 0 no segundo vídeo.
async function listRecentHistory({ limit = 20 } = {}) {
  const { rows } = await pool.query(
    `SELECT sv.*, yc.channel_name, u.email AS client_email, u.business_name AS client_business_name,
            (SELECT count(*)::int FROM clips c WHERE c.source_video_id = sv.id) AS clips_count,
            EXTRACT(EPOCH FROM (sv.updated_at - sv.processing_started_at)) AS processing_seconds
     FROM source_videos sv
     LEFT JOIN youtube_channels yc ON yc.id = sv.youtube_channel_id
     JOIN users u ON u.id = coalesce(yc.client_user_id, sv.client_user_id)
     WHERE sv.status IN ('ready', 'error')
     ORDER BY sv.updated_at DESC
     LIMIT $1`,
    [limit]
  );
  return rows;
}

module.exports = {
  createIfNotExists,
  createManual,
  createUpload,
  findByYoutubeVideoIdForOwner,
  findById,
  findByIdOwnedByClient,
  deleteByIdOwnedByClient,
  deleteById,
  resetForRetry,
  resetForAutoRetry,
  requestPauseByIdOwnedByClient,
  resumeByIdOwnedByClient,
  findTransientErrorsForAutoRetry,
  findStuckDetected,
  touchProcessingHeartbeat,
  findStuckProcessing,
  markRecoveredFromStuck,
  findAwaitingCreditsByClientId,
  resumeAwaitingCredits,
  findAwaitingTunnelByClientId,
  resumeAwaitingTunnel,
  updateStatus,
  saveDownload,
  saveTranscript,
  countPendingByYoutubeVideoId,
  STATUS_QUE_AINDA_PRECISA_DO_ARQUIVO,
  saveClaudeUsage,
  markClipSelectionCompleted,
  markProcessingStarted,
  listForClient,
  countInProgress,
  countByClientSince,
  listCurrentlyProcessing,
  listWaiting,
  listRecentHistory,
};
