'use strict';

const pool = require('../db/pool');
const postingScheduleSettingsRepository = require('./postingScheduleSettingsRepository');
const { projectQueueTimes } = require('../lib/postingSchedule');

// Calcula UMA VEZ o horario previsto pra postagem que esta entrando na fila
// agora, encaixando depois de tudo que ja saiu hoje + tudo que ja esta
// esperando (mesma logica de projecao usada na tela, mas so pro proximo
// slot livre). Fica gravado em postings.scheduled_for e nunca mais muda
// sozinho - ver reflowScheduledFor() pro unico jeito de recalcular todo
// mundo de proposito (botao "Corrigir horarios").
async function computeNextScheduledFor(tiktokAccountId) {
  const settings = await postingScheduleSettingsRepository.findOrCreateByTiktokAccountId(tiktokAccountId);
  const postedToday = await countTodayForAccount(tiktokAccountId, settings.timezone);
  const pendingCount = await countPendingForAccount(tiktokAccountId);
  const [scheduledFor] = projectQueueTimes({
    mode: settings.mode,
    manualTimes: settings.manual_times,
    videosPerDay: settings.videos_per_day,
    timezone: settings.timezone,
    postedToday: Number(postedToday) + pendingCount,
    count: 1,
  });
  return scheduledFor;
}

// Usa ON CONFLICT DO NOTHING: a restricao UNIQUE(video_id, tiktok_account_id)
// garante que o mesmo video nunca gera duas postagens para a mesma conta.
// caption comeca igual a descricao do corte (quando ha uma), mas depois e
// editavel a parte na fila sem afetar o corte original.
async function createIfNotExists({ videoId, tiktokAccountId, caption = null }) {
  const scheduledFor = await computeNextScheduledFor(tiktokAccountId);
  const { rows } = await pool.query(
    `INSERT INTO postings (video_id, tiktok_account_id, caption, scheduled_for)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (video_id, tiktok_account_id) DO NOTHING
     RETURNING *`,
    [videoId, tiktokAccountId, caption, scheduledFor]
  );
  return rows[0] || null;
}

const ORIGIN_CASE = `
  CASE
    WHEN v.source_type = 'youtube_clip' THEN 'youtube_clip'
    ELSE 'drive_client'
  END AS origin
`;

// channel_name so existe pra postagens com origem youtube_clip (via
// video -> clip -> source_video -> canal); fica NULL pras de Drive.
const CHANNEL_JOIN = `
  LEFT JOIN clips c ON c.id = v.clip_id
  LEFT JOIN source_videos sv ON sv.id = c.source_video_id
  LEFT JOIN youtube_channels yc ON yc.id = sv.youtube_channel_id
`;

async function listForClient(clientUserId) {
  const { rows } = await pool.query(
    `SELECT p.*, v.filename, v.discovered_at, yc.channel_name, ${ORIGIN_CASE}
     FROM postings p
     JOIN videos v ON v.id = p.video_id
     ${CHANNEL_JOIN}
     JOIN tiktok_accounts ta ON ta.id = p.tiktok_account_id
     WHERE ta.client_user_id = $1
     ORDER BY p.created_at DESC`,
    [clientUserId]
  );
  return rows;
}

async function listAllWithDetails() {
  const { rows } = await pool.query(
    `SELECT p.*, v.filename, u.email AS client_email, u.business_name AS client_business_name,
            yc.channel_name, ta.display_name AS tiktok_display_name, ${ORIGIN_CASE}
     FROM postings p
     JOIN videos v ON v.id = p.video_id
     ${CHANNEL_JOIN}
     JOIN tiktok_accounts ta ON ta.id = p.tiktok_account_id
     JOIN users u ON u.id = ta.client_user_id
     ORDER BY p.created_at DESC
     LIMIT 200`
  );
  return rows;
}

async function updateStatus(id, { status, errorMessage = null, tiktokPublishId = null, tiktokPostId = null }) {
  const timestampColumn =
    status === 'queued' ? 'queued_at' : status === 'processing' ? 'started_at' : status === 'posted' ? 'posted_at' : null;

  const { rows } = await pool.query(
    `UPDATE postings
     SET status = $2,
         error_message = $3,
         tiktok_publish_id = COALESCE($4, tiktok_publish_id),
         tiktok_post_id = COALESCE($5, tiktok_post_id),
         attempts = CASE WHEN $2 = 'processing' THEN attempts + 1 ELSE attempts END,
         updated_at = now()
         ${timestampColumn ? `, ${timestampColumn} = now()` : ''}
     WHERE id = $1
     RETURNING *`,
    [id, status, errorMessage, tiktokPublishId, tiktokPostId]
  );
  return rows[0] || null;
}

// So cortes gerados a partir do YouTube tem arquivo local pra publicar
// (postagem vinda do Drive ainda nao tem esse caminho implementado) - por
// isso o INNER JOIN ate clips exclui automaticamente as de origem Drive.
const CLIP_FILE_JOIN = `
  JOIN videos v ON v.id = p.video_id
  JOIN clips c ON c.id = v.clip_id
  JOIN source_videos sv ON sv.id = c.source_video_id
`;

// LEFT porque video avulso/upload (source_videos.input_type != 'channel')
// nao tem canal nenhum - vira "Video avulso" na tela.
const YOUTUBE_CHANNEL_JOIN = `LEFT JOIN youtube_channels yc ON yc.id = sv.youtube_channel_id`;

// Ordem de exibicao/publicacao da fila: segue queue_order quando o cliente
// ja arrastou pra reordenar, senao cai na ordem de chegada (id crescente ==
// created_at crescente nessa tabela). Usada em toda consulta que lista ou
// escolhe o "proximo" da fila pendente - se so a tela usasse isso e o job
// de publicacao continuasse por created_at, arrastar pareceria funcionar
// mas nao mudaria o que sai de verdade no TikTok.
const PENDING_ORDER = 'COALESCE(p.queue_order, p.id) ASC';

// O proximo de CADA conta, pra caixa fechada da tela de Publicacao mostrar
// o que sai a seguir sem precisar abrir as configuracoes.
//
// Usa exatamente o mesmo PENDING_ORDER do job de publicacao: anunciar um
// "proximo" diferente do que realmente vai sair no TikTok seria pior do que
// nao anunciar nada. DISTINCT ON traz so a primeira linha de cada conta numa
// unica consulta, em vez de uma consulta por conta na tela.
async function findNextPendingForAccounts(accountIds) {
  if (!accountIds.length) return [];
  const { rows } = await pool.query(
    `SELECT DISTINCT ON (p.tiktok_account_id)
            p.tiktok_account_id, p.id, p.scheduled_for,
            c.id AS clip_id, c.title AS clip_title, c.thumbnail_path,
            c.start_seconds, c.end_seconds, yc.channel_name
     FROM postings p
     ${CLIP_FILE_JOIN}
     ${YOUTUBE_CHANNEL_JOIN}
     WHERE p.status = 'pending' AND p.tiktok_account_id = ANY($1::bigint[])
     ORDER BY p.tiktok_account_id, ${PENDING_ORDER}`,
    [accountIds]
  );
  return rows;
}

// Postagem pendente mais antiga (na ordem da fila) de uma conta - e o que
// o job de publicacao pega quando ha espaco na cota do dia.
async function findOldestPendingForAccount(tiktokAccountId) {
  const { rows } = await pool.query(
    `SELECT p.*, c.local_clip_path, c.title AS clip_title, v.file_size_bytes,
            -- Usados pra conferir o limite de duracao da conta ANTES de subir o
            -- arquivo inteiro (regra da Content Posting API).
            c.start_seconds AS clip_start_seconds, c.end_seconds AS clip_end_seconds
     FROM postings p
     ${CLIP_FILE_JOIN}
     WHERE p.tiktok_account_id = $1 AND p.status = 'pending'
     ORDER BY ${PENDING_ORDER}
     LIMIT 1`,
    [tiktokAccountId]
  );
  return rows[0] || null;
}

// Usado pelo botao "Postar agora": mesmos dados de findOldestPendingForAccount,
// mas buscando um corte especifico (e conferindo que pertence mesmo a esse
// cliente e ainda esta pendente - nao deixa postar de novo algo ja postado/
// cancelado clicando duas vezes rapido).
async function findPublishableByIdOwnedByClient(id, clientUserId) {
  const { rows } = await pool.query(
    `SELECT p.*, c.local_clip_path, c.title AS clip_title, v.file_size_bytes
     FROM postings p
     ${CLIP_FILE_JOIN}
     JOIN tiktok_accounts ta ON ta.id = p.tiktok_account_id
     WHERE p.id = $1 AND ta.client_user_id = $2 AND p.status = 'pending'`,
    [id, clientUserId]
  );
  return rows[0] || null;
}

// Quantas postagens ja saem hoje (no fuso da conta) - conta a partir do
// momento em que a postagem comecou a sair de verdade (queued_at), nao da
// criacao (que pode ser bem antes, quando o corte so ficou pronto).
async function countTodayForAccount(tiktokAccountId, timezone) {
  const { rows } = await pool.query(
    `SELECT count(*)::int AS count
     FROM postings
     WHERE tiktok_account_id = $1
       AND status IN ('queued', 'processing', 'posted')
       AND (queued_at AT TIME ZONE $2)::date = (now() AT TIME ZONE $2)::date`,
    [tiktokAccountId, timezone]
  );
  return rows[0].count;
}

// Ultima vez que essa conta mandou uma postagem pra fora (usado pelo modo
// automatico pra espacar - null se a conta nunca postou nada ainda).
// So conta postagens que realmente saíram (status='posted') - antes contava
// qualquer tentativa (inclusive as que falharam), fazendo uma conta com
// erro persistente (ex: permissão do TikTok recusada) esperar o mesmo
// espaçamento de "já postei recentemente" mesmo nunca tendo postado nada,
// travando o retry automático em horas em vez de minutos.
async function mostRecentPostedAt(tiktokAccountId) {
  const { rows } = await pool.query(
    "SELECT max(posted_at) AS last_posted_at FROM postings WHERE tiktok_account_id = $1 AND status = 'posted'",
    [tiktokAccountId]
  );
  return rows[0].last_posted_at;
}

// Quantos itens estao esperando na fila agora (independente de cliente) -
// usado pra encaixar o proximo slot livre ao criar uma postagem nova.
async function countPendingForAccount(tiktokAccountId) {
  const { rows } = await pool.query(
    "SELECT count(*)::int AS count FROM postings WHERE tiktok_account_id = $1 AND status = 'pending'",
    [tiktokAccountId]
  );
  return rows[0].count;
}

// Recalcula scheduled_for de TODA a fila pendente dessa conta, do zero, na
// ordem de chegada - e o unico jeito de "preencher os buracos" deixados por
// cortes que foram pulados/deram erro. So roda quando alguem pede
// explicitamente (botao "Corrigir horarios de posts"), nunca sozinho -
// senao volta o bug de um "Nao postar" empurrar todo mundo pra frente.
async function reflowScheduledFor(tiktokAccountId) {
  const settings = await postingScheduleSettingsRepository.findOrCreateByTiktokAccountId(tiktokAccountId);
  const postedToday = await countTodayForAccount(tiktokAccountId, settings.timezone);
  const { rows: pending } = await pool.query(
    `SELECT p.id FROM postings p WHERE p.tiktok_account_id = $1 AND p.status = 'pending' ORDER BY ${PENDING_ORDER}`,
    [tiktokAccountId]
  );
  const scheduledTimes = projectQueueTimes({
    mode: settings.mode,
    manualTimes: settings.manual_times,
    videosPerDay: settings.videos_per_day,
    timezone: settings.timezone,
    postedToday: Number(postedToday),
    count: pending.length,
  });
  for (let i = 0; i < pending.length; i++) {
    await pool.query('UPDATE postings SET scheduled_for = $2, updated_at = now() WHERE id = $1', [
      pending[i].id,
      scheduledTimes[i],
    ]);
  }
  return pending.length;
}

// Postagens em 'processing' ha um tempo - o job de publicacao revarre essas
// pra fechar o status quando a TikTok ja tiver terminado de processar.
async function listStaleProcessing() {
  const { rows } = await pool.query(
    `SELECT p.* FROM postings p
     WHERE p.status = 'processing' AND p.started_at < now() - interval '1 minute'`
  );
  return rows;
}

// Postagens 'posted' mais velhas que a retencao - usado pelo job de limpeza
// automatica.
//
// Varre o sistema inteiro de uma vez, sem passar por conta do TikTok: a
// retencao virou um valor unico e fixo (RETENCAO_CORTE_POSTADO_HORAS), entao
// nao existe mais "a retencao daquela conta" pra consultar. De quebra, isso
// resolve um buraco silencioso da versao anterior - uma conta que nunca teve
// linha em posting_schedule_settings nunca era varrida.
async function listPostedOlderThan(hours) {
  const { rows } = await pool.query(
    `SELECT p.*, c.id AS clip_id, c.local_clip_path, c.thumbnail_path, sv.id AS source_video_id
     FROM postings p
     ${CLIP_FILE_JOIN}
     WHERE p.status = 'posted' AND p.posted_at < now() - ($1 || ' hours')::interval`,
    [hours]
  );
  return rows;
}

// Fila de prontos aguardando postar - pro cliente revisar/editar legenda
// antes de sair.
async function listQueueForClient(clientUserId, tiktokAccountId = null) {
  const { rows } = await pool.query(
    `SELECT p.*, c.title AS clip_title, c.description AS clip_description, c.thumbnail_path,
            c.id AS clip_id, c.start_seconds, c.end_seconds, yc.id AS channel_id, yc.channel_name
     FROM postings p
     ${CLIP_FILE_JOIN}
     ${YOUTUBE_CHANNEL_JOIN}
     JOIN tiktok_accounts ta ON ta.id = p.tiktok_account_id
     WHERE ta.client_user_id = $1 AND p.status = 'pending'
       AND ($2::bigint IS NULL OR p.tiktok_account_id = $2)
     ORDER BY ${PENDING_ORDER}`,
    [clientUserId, tiktokAccountId]
  );
  return rows;
}

// Grava as escolhas de publicacao que o criador fez na tela (privacidade,
// interacoes, divulgacao comercial). So mexe em postagem PENDENTE dessa conta,
// e so do proprio cliente.
//
// options_confirmed_at aqui significa "este corte tem opcoes proprias", nao
// "ja confirmou": o padrao normal vem da conta. Quando e NULL, o corte segue o
// padrao da conta - ver src/lib/publishOptions.js.
// Desfaz a personalizacao de um corte: ele volta a seguir o padrao da conta.
// Zerar os campos e limpar options_confirmed_at e a mesma coisa pro resolvedor,
// mas deixar lixo pra tras faria a tela mostrar escolha que nao vale mais.
async function clearDirectPostOptionsOwnedByClient(id, clientUserId) {
  const { rows } = await pool.query(
    `UPDATE postings p
     SET privacy_level = NULL,
         disable_comment = false,
         disable_duet = false,
         disable_stitch = false,
         brand_organic_toggle = false,
         brand_content_toggle = false,
         options_confirmed_at = NULL,
         updated_at = now()
     FROM tiktok_accounts ta
     WHERE p.id = $1 AND p.tiktok_account_id = ta.id
       AND ta.client_user_id = $2 AND p.status = 'pending'
     RETURNING p.*`,
    [id, clientUserId]
  );
  return rows[0] || null;
}

async function saveDirectPostOptionsOwnedByClient(id, clientUserId, opcoes) {
  const { rows } = await pool.query(
    `UPDATE postings p
     SET privacy_level = $3,
         disable_comment = $4,
         disable_duet = $5,
         disable_stitch = $6,
         brand_organic_toggle = $7,
         brand_content_toggle = $8,
         options_confirmed_at = now(),
         updated_at = now()
     FROM tiktok_accounts ta
     WHERE p.id = $1 AND p.tiktok_account_id = ta.id
       AND ta.client_user_id = $2 AND p.status = 'pending'
     RETURNING p.*`,
    [
      id,
      clientUserId,
      opcoes.privacyLevel,
      opcoes.disableComment,
      opcoes.disableDuet,
      opcoes.disableStitch,
      opcoes.brandOrganicToggle,
      opcoes.brandContentToggle,
    ]
  );
  return rows[0] || null;
}

// Grava a ordem que o cliente escolheu arrastando os cortes na tela - so
// mexe em postagens PENDENTES dessa conta (defesa extra alem do que a tela
// ja filtra). Numeros pequenos e sequenciais (0,1,2...), sempre menores que
// qualquer id futuro, entao um corte novo continua entrando no fim da fila
// sozinho ate o cliente arrastar nele tambem.
async function setQueueOrder(tiktokAccountId, orderedIds) {
  for (let i = 0; i < orderedIds.length; i++) {
    await pool.query(
      "UPDATE postings SET queue_order = $3, updated_at = now() WHERE id = $1 AND tiktok_account_id = $2 AND status = 'pending'",
      [orderedIds[i], tiktokAccountId, i]
    );
  }
}

async function listPostedForClient(clientUserId, tiktokAccountId = null) {
  const { rows } = await pool.query(
    `SELECT p.*, c.title AS clip_title, c.thumbnail_path, c.id AS clip_id
     FROM postings p
     ${CLIP_FILE_JOIN}
     JOIN tiktok_accounts ta ON ta.id = p.tiktok_account_id
     WHERE ta.client_user_id = $1 AND p.status = 'posted'
       AND ($2::bigint IS NULL OR p.tiktok_account_id = $2)
     ORDER BY p.posted_at DESC
     LIMIT 100`,
    [clientUserId, tiktokAccountId]
  );
  return rows;
}

// Postagens que a TikTok recusou/falharam de vez - ficavam invisiveis pro
// cliente antes (so existiam no banco), sem nenhum jeito de saber que um
// corte nao saiu. Mostrado numa aba "Erro" ao lado de "Postados".
async function listErrorForClient(clientUserId, tiktokAccountId = null) {
  const { rows } = await pool.query(
    `SELECT p.*, c.title AS clip_title, c.thumbnail_path, c.id AS clip_id, yc.id AS channel_id, yc.channel_name
     FROM postings p
     ${CLIP_FILE_JOIN}
     ${YOUTUBE_CHANNEL_JOIN}
     JOIN tiktok_accounts ta ON ta.id = p.tiktok_account_id
     WHERE ta.client_user_id = $1 AND p.status = 'error'
       AND ($2::bigint IS NULL OR p.tiktok_account_id = $2)
     ORDER BY p.updated_at DESC
     LIMIT 100`,
    [clientUserId, tiktokAccountId]
  );
  return rows;
}

// Botao "Enviar pra fila novamente" (e passo inicial de "Tentar postar
// agora"): so mexe se a postagem realmente estiver em erro - evita reenviar
// algo que ja saiu ou que o cliente cancelou. Ganha um scheduled_for novo
// (entra no fim da fila, como se fosse recem-criada).
async function retryOwnedByClient(id, clientUserId) {
  const posting = await findByIdOwnedByClient(id, clientUserId);
  if (!posting || posting.status !== 'error') return null;

  const scheduledFor = await computeNextScheduledFor(posting.tiktok_account_id);
  const { rows } = await pool.query(
    `UPDATE postings SET status = 'pending', error_message = NULL, scheduled_for = $2, updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [id, scheduledFor]
  );
  return rows[0] || null;
}

// Resumo rapido pra caixa fechada da conta na tela (sem abrir nada) - so 3
// contagens, sem trazer os itens em si.
async function countByStatusForAccount(tiktokAccountId) {
  const { rows } = await pool.query(
    `SELECT status, count(*)::int AS count
     FROM postings
     WHERE tiktok_account_id = $1 AND status IN ('pending', 'posted', 'error')
     GROUP BY status`,
    [tiktokAccountId]
  );
  const result = { pending: 0, posted: 0, error: 0 };
  for (const row of rows) result[row.status] = row.count;
  return result;
}

async function countPendingForClient(clientUserId) {
  const { rows } = await pool.query(
    `SELECT count(*)::int AS count
     FROM postings p
     JOIN tiktok_accounts ta ON ta.id = p.tiktok_account_id
     WHERE ta.client_user_id = $1 AND p.status = 'pending'`,
    [clientUserId]
  );
  return rows[0].count;
}

async function findByIdOwnedByClient(id, clientUserId) {
  const { rows } = await pool.query(
    `SELECT p.* FROM postings p
     JOIN tiktok_accounts ta ON ta.id = p.tiktok_account_id
     WHERE p.id = $1 AND ta.client_user_id = $2`,
    [id, clientUserId]
  );
  return rows[0] || null;
}

async function updateCaptionOwnedByClient(id, clientUserId, caption) {
  const { rows } = await pool.query(
    `UPDATE postings SET caption = $3, updated_at = now()
     WHERE id = $1 AND status = 'pending'
       AND id IN (SELECT p.id FROM postings p JOIN tiktok_accounts ta ON ta.id = p.tiktok_account_id WHERE ta.client_user_id = $2)
     RETURNING *`,
    [id, clientUserId, caption]
  );
  return rows[0] || null;
}

async function skipOwnedByClient(id, clientUserId) {
  const { rows } = await pool.query(
    `UPDATE postings SET status = 'skipped', updated_at = now()
     WHERE id = $1 AND status = 'pending'
       AND id IN (SELECT p.id FROM postings p JOIN tiktok_accounts ta ON ta.id = p.tiktok_account_id WHERE ta.client_user_id = $2)
     RETURNING *`,
    [id, clientUserId]
  );
  return rows[0] || null;
}

// Sem filtro de dono: só o painel de erros do admin usa. As rotas do cliente
// continuam obrigadas a usar findByIdOwnedByClient.
async function findById(id) {
  const { rows } = await pool.query('SELECT * FROM postings WHERE id = $1', [id]);
  return rows[0] || null;
}

module.exports = {
  createIfNotExists,
  listForClient,
  listAllWithDetails,
  updateStatus,
  findOldestPendingForAccount,
  findNextPendingForAccounts,
  findPublishableByIdOwnedByClient,
  countTodayForAccount,
  countPendingForAccount,
  mostRecentPostedAt,
  reflowScheduledFor,
  setQueueOrder,
  saveDirectPostOptionsOwnedByClient,
  clearDirectPostOptionsOwnedByClient,
  listStaleProcessing,
  listPostedOlderThan,
  listQueueForClient,
  listPostedForClient,
  listErrorForClient,
  retryOwnedByClient,
  countByStatusForAccount,
  countPendingForClient,
  findById,
  findByIdOwnedByClient,
  updateCaptionOwnedByClient,
  skipOwnedByClient,
};
