// Apaga postagens ja publicadas ha mais tempo do que a retencao configurada
// pelo cliente (posting_schedule_settings.auto_delete_after_hours) - o corte,
// a capa e os arquivos em disco somem, mantendo o servidor enxuto. Se era o
// ultimo corte daquele video-fonte, o video-fonte tambem some (isso resolve
// de quebra a reclamacao antiga de "canal mostra video velho demais").
// Roda de hora em hora (ver videoScheduler.js).
'use strict';

const fs = require('fs');
const path = require('path');
const postingsRepository = require('../../repositories/postingsRepository');
const postingScheduleSettingsRepository = require('../../repositories/postingScheduleSettingsRepository');
const clipsRepository = require('../../repositories/clipsRepository');
const sourceVideosRepository = require('../../repositories/sourceVideosRepository');
const config = require('../../config');
const logger = require('../../lib/logger');

async function run() {
  const accountsWithRetention = await postingScheduleSettingsRepository.listWithAutoDelete();
  for (const settings of accountsWithRetention) {
    try {
      await cleanupAccount(settings);
    } catch (err) {
      logger.error(`Falha na limpeza automatica da conta TikTok ${settings.tiktok_account_id}:`, err);
    }
  }
}

async function cleanupAccount(settings) {
  const postings = await postingsRepository.listPostedOlderThan(
    settings.tiktok_account_id,
    settings.auto_delete_after_hours
  );
  for (const posting of postings) {
    await deletePostingAndClip(posting);
  }
}

async function deletePostingAndClip(posting) {
  // Apaga so o corte - video/posting ligados a ele caem em cascata no banco.
  await clipsRepository.deleteById(posting.clip_id);

  if (posting.local_clip_path) fs.rm(posting.local_clip_path, { force: true }, () => {});
  if (posting.thumbnail_path) fs.rm(posting.thumbnail_path, { force: true }, () => {});

  const remainingClips = await clipsRepository.listBySourceVideoId(posting.source_video_id);
  if (remainingClips.length === 0) {
    const sourceVideo = await sourceVideosRepository.findById(posting.source_video_id);
    if (sourceVideo) {
      await sourceVideosRepository.deleteById(sourceVideo.id);
      if (sourceVideo.local_video_path) fs.rm(sourceVideo.local_video_path, { force: true }, () => {});
      fs.rm(path.join(config.videoProcessing.workDir, String(sourceVideo.id)), { recursive: true, force: true }, () => {});
    }
  }

  logger.info(`Postagem ${posting.id} apagada automaticamente (retencao configurada expirou).`);
}

module.exports = { run };
