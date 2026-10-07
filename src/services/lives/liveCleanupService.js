// Protecoes de disco do modulo de lives:
//  - apaga os pedacos BRUTOS gravados depois do prazo (lives_config.retencaoHoras);
//    os cortes prontos ficam em outra pasta e nao entram nesta limpeza;
//  - apaga os CORTES de live 3 dias depois de prontos (apagarCortesVencidos);
//  - mede o uso do disco, pro supervisor parar de gravar acima do limite.
'use strict';

const { RETENCAO_CORTE_LIVE_HORAS } = require('../../config/constants');

const fs = require('fs');
const path = require('path');
const config = require('../../config');
const livesRepository = require('../../repositories/livesRepository');
const logger = require('../../lib/logger');

function pastaDasGravacoes() {
  return path.join(config.videoProcessing.workDir, 'lives', 'gravacoes');
}

// Percentual usado do disco onde as gravacoes ficam (o mesmo dos cortes do
// YouTube: encher um enche o outro, por isso o limite e sobre o disco todo).
function usoDoDiscoPercent(pasta = config.videoProcessing.workDir) {
  const s = fs.statfsSync(pasta);
  const total = s.blocks * s.bsize;
  const livre = s.bavail * s.bsize;
  return total > 0 ? ((total - livre) / total) * 100 : 0;
}

async function apagarPedacosAntigos(retencaoHoras) {
  let apagados = 0;
  for (;;) {
    const lote = await livesRepository.segmentsOlderThan(retencaoHoras, 500);
    if (!lote.length) break;
    for (const s of lote) {
      try {
        fs.rmSync(s.file_path, { force: true });
      } catch (err) {
        logger.error(`Lives: nao consegui apagar ${s.file_path}:`, err.message);
      }
    }
    await livesRepository.markSegmentsDeleted(lote.map((s) => s.id));
    apagados += lote.length;
    if (lote.length < 500) break;
  }
  if (apagados) logger.info(`Lives: ${apagados} pedaco(s) gravado(s) apagado(s) (mais de ${retencaoHoras}h).`);
  return apagados;
}

// Cortes de live prontos ha mais de 3 dias: arquivo, capa e linha (a tela
// avisa o prazo). Corte na fila ou renderizando nunca e apagado no meio.
async function apagarCortesVencidos(horas = RETENCAO_CORTE_LIVE_HORAS) {
  let apagados = 0;
  for (;;) {
    const lote = await livesRepository.deleteClipsOlderThan(horas, 200);
    for (const k of lote) {
      for (const f of [k.local_clip_path, k.thumbnail_path]) {
        if (!f) continue;
        try {
          fs.rmSync(f, { force: true });
        } catch (err) {
          logger.error(`Lives: nao consegui apagar ${f}:`, err.message);
        }
      }
    }
    apagados += lote.length;
    if (lote.length < 200) break;
  }
  if (apagados) logger.info(`Lives: ${apagados} corte(s) de live apagado(s) (mais de ${horas}h).`);
  return apagados;
}

module.exports = { apagarPedacosAntigos, apagarCortesVencidos, usoDoDiscoPercent, pastaDasGravacoes };
