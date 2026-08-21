// Apaga postagens ja publicadas ha mais tempo que a retencao - o corte, a capa
// e os arquivos em disco somem, mantendo o servidor enxuto. Se era o ultimo
// corte daquele video-fonte, o video-fonte tambem some (isso resolve de quebra
// a reclamacao antiga de "canal mostra video velho demais").
//
// A retencao e um valor unico e fixo do sistema (RETENCAO_CORTE_POSTADO_HORAS
// = 3 dias), nao uma configuracao por conta - ver o porque em
// src/config/constants.js e na migration 062. Antes era escolha do cliente com
// padrao de 7 dias, e o resultado foi 33 GB de disco ocupado sem ninguem
// perceber.
//
// Roda de hora em hora (ver videoScheduler.js).
'use strict';

const fs = require('fs');
const path = require('path');
const postingsRepository = require('../../repositories/postingsRepository');
const clipsRepository = require('../../repositories/clipsRepository');
const sourceVideosRepository = require('../../repositories/sourceVideosRepository');
const sharedVideoFiles = require('../../lib/sharedVideoFiles');
const config = require('../../config');
const { RETENCAO_CORTE_POSTADO_HORAS } = require('../../config/constants');
const logger = require('../../lib/logger');

async function run() {
  const postings = await postingsRepository.listPostedOlderThan(RETENCAO_CORTE_POSTADO_HORAS);
  let apagadas = 0;

  for (const posting of postings) {
    try {
      await deletePostingAndClip(posting);
      apagadas += 1;
    } catch (err) {
      // Uma postagem problematica nao pode impedir a limpeza das outras - era
      // assim que o disco enchia sem ninguem perceber.
      logger.error(`Falha na limpeza automatica da postagem ${posting.id}:`, err);
    }
  }

  return { apagadas };
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
      // O arquivo compartilhado NAO sai daqui: ele pertence a todos os
      // clientes que monitoram o mesmo canal, e quem decide apaga-lo e o
      // sharedAssetsCleanupJob. Apagar aqui faria a limpeza de UM cliente
      // obrigar os outros a baixar o video de novo.
      if (sourceVideo.local_video_path && !sharedVideoFiles.isShared(sourceVideo.local_video_path)) {
        fs.rm(sourceVideo.local_video_path, { force: true }, () => {});
      }
      fs.rm(path.join(config.videoProcessing.workDir, String(sourceVideo.id)), { recursive: true, force: true }, () => {});
    }
  }

  logger.info(`Postagem ${posting.id} apagada automaticamente (${RETENCAO_CORTE_POSTADO_HORAS}h desde a publicacao).`);
}

module.exports = { run };
