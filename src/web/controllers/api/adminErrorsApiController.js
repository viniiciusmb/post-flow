// Painel de erros do admin.
//
// Uma tela, uma ação: tentar de novo. A ideia não é diagnosticar aqui dentro -
// é ter num lugar só a lista do que está quebrando, pra decidir o que arrumar.
'use strict';

const systemErrorsRepository = require('../../../repositories/systemErrorsRepository');
const sourceVideosRepository = require('../../../repositories/sourceVideosRepository');
const postingsRepository = require('../../../repositories/postingsRepository');
const queueService = require('../../../services/queueService');
const queuePriorityService = require('../../../services/queuePriorityService');
const clipsRepository = require('../../../repositories/clipsRepository');
const errorReportService = require('../../../services/errorReportService');
const logger = require('../../../lib/logger');

// "source_video #3" não diz nada pra quem lê. Estes são os nomes que a tela usa.
const ROTULO_ENTIDADE = Object.freeze({
  source_video: 'Vídeo',
  clip: 'Corte',
  youtube_channel: 'Canal',
  posting: 'Publicação',
  drive_folder: 'Pasta do Drive',
});

function toApi(e) {
  return {
    id: Number(e.id),
    operation: e.operation,
    operationLabel: errorReportService.ROTULO_OPERACAO[e.operation] || e.operation,
    entityType: e.entity_type,
    entityLabel: e.entity_type ? ROTULO_ENTIDADE[e.entity_type] || e.entity_type : null,
    entityId: e.entity_id ? Number(e.entity_id) : null,
    clientName: e.client_name || e.client_email || null,
    message: e.message,
    detail: e.detail,
    occurrences: e.occurrences,
    firstSeenAt: e.first_seen_at,
    lastSeenAt: e.last_seen_at,
    status: e.status,
    retryCount: e.retry_count,
    lastRetryAt: e.last_retry_at,
    canRetry: PODE_TENTAR_DE_NOVO.has(e.operation),
  };
}

// Operações que o botão sabe reexecutar. As de fora (backup, teste de conexão)
// aparecem na lista sem botão - fingir que dá pra tentar de novo e não fazer
// nada seria pior que não ter botão.
const PODE_TENTAR_DE_NOVO = new Set(['video_processing', 'channel_check', 'tiktok_posting', 'drive_export']);

async function list(req, res) {
  const status = ['abertos', 'resolvidos', 'todos'].includes(req.query.status) ? req.query.status : 'abertos';
  const [erros, contagem] = await Promise.all([
    systemErrorsRepository.list({ status }),
    systemErrorsRepository.counts(),
  ]);
  res.json({
    errors: erros.map(toApi),
    counts: {
      abertos: contagem.abertos,
      resolvidos: contagem.resolvidos,
      ocorrenciasAbertas: contagem.ocorrencias_abertas,
    },
  });
}

// Recoloca a operação na fila. Cada tipo tem o seu jeito - o que eles têm em
// comum é que NADA é executado aqui dentro da requisição: tudo volta pra fila
// e roda no worker, senão um clique no botão poderia segurar a resposta por
// minutos (um vídeo inteiro, por exemplo).
async function retry(req, res) {
  const erro = await systemErrorsRepository.findById(req.params.id);
  if (!erro) return res.status(404).json({ error: res.locals.t('erros.erroNaoEncontrado') });
  if (!PODE_TENTAR_DE_NOVO.has(erro.operation)) {
    return res.status(400).json({ error: res.locals.t('erros.operacaoNaoRefeita') });
  }

  await systemErrorsRepository.markRetrying(erro.id);

  try {
    const disparou = await reenfileirar(erro);
    if (!disparou) {
      await systemErrorsRepository.markOpenAgain(erro.id);
      return res.status(409).json({
        error: res.locals.t('erros.itemNaoExisteMais'),
      });
    }
  } catch (err) {
    // A tentativa não saiu do chão. Volta pra "aberto" - deixar em
    // "retentando" faria parecer que tem algo rodando quando não tem.
    await systemErrorsRepository.markOpenAgain(erro.id);
    logger.error(`Falha ao reenfileirar o erro ${erro.id}:`, err.message);
    return res.status(500).json({ error: res.locals.t('erros.naoRecolocouNaFila') });
  }

  const atualizado = await systemErrorsRepository.findById(erro.id);
  res.json({ error: toApi(atualizado) });
}

async function reenfileirar(erro) {
  const id = Number(erro.entity_id);

  if (erro.operation === 'video_processing') {
    // Tanto faz se o erro foi registrado no vídeo ou num corte dele: o que se
    // reenfileira é sempre o vídeo, e o pipeline já pula o que ficou pronto.
    const videoId = erro.entity_type === 'clip' ? await videoDoCorte(id) : id;
    if (!videoId) return false;
    const video = await sourceVideosRepository.findById(videoId);
    if (!video) return false;
    await sourceVideosRepository.updateStatus(videoId, 'detected', { errorMessage: null });
    const priority = await queuePriorityService.resolveQueuePriorityForClient(
      video.owner_client_user_id || video.client_user_id
    );
    const boss = await queueService.getBoss();
    await boss.send('video-processing', { sourceVideoId: videoId }, { priority });
    return true;
  }

  if (erro.operation === 'channel_check') {
    // A checagem é de todos os canais de uma vez (é um job só), então tentar
    // de novo aqui simplesmente adianta a próxima rodada.
    const boss = await queueService.getBoss();
    await boss.send('youtube-channel-check', {});
    return true;
  }

  if (erro.operation === 'tiktok_posting') {
    const posting = await postingsRepository.findById(id);
    if (!posting) return false;
    await postingsRepository.updateStatus(id, { status: 'pending', errorMessage: null });
    const boss = await queueService.getBoss();
    await boss.send('tiktok-posting', {});
    return true;
  }

  if (erro.operation === 'drive_export') {
    const boss = await queueService.getBoss();
    await boss.send('drive-export', {});
    return true;
  }

  return false;
}

async function videoDoCorte(clipId) {
  const clip = await clipsRepository.findById(clipId);
  return clip ? Number(clip.source_video_id) : null;
}

async function resolve(req, res) {
  const atualizado = await systemErrorsRepository.resolve(req.params.id);
  if (!atualizado) return res.status(404).json({ error: res.locals.t('erros.erroNaoEncontrado') });
  res.json({ error: toApi(atualizado) });
}

module.exports = { list, retry, resolve };
