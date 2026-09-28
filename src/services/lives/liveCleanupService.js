// Protecoes de disco do modulo de lives:
//  - apaga os pedacos BRUTOS gravados depois do prazo (lives_config.retencaoHoras);
//    os cortes prontos ficam em outra pasta e nao entram nesta limpeza;
//  - mede o uso do disco, pro supervisor parar de gravar acima do limite.
'use strict';

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

module.exports = { apagarPedacosAntigos, usoDoDiscoPercent, pastaDasGravacoes };
