// Deixa o arquivo do corte dentro do tamanho que a rede aceita (11/10/2026).
//
// Hoje só o Bluesky precisa disto: ele recusa vídeo acima de 50 MB, e metade
// dos cortes do sistema passa disso (medido em produção: mediana 44 MB, 90%
// abaixo de 72 MB). Em vez de recusar o corte, recomprime numa cópia
// temporária com a taxa de bits calculada pra caber - o original não é tocado.
//
// Usa o runFfmpegWithProgress do videoEditingService, que já mata o grupo de
// processos e tem teto de tempo (as duas coisas já custaram incidente aqui).
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const videoEditingService = require('./videoEditingService');
const logger = require('../lib/logger');

const AUDIO_KBPS = 96;

// Taxa de vídeo (kbit/s) pra um arquivo de `bytes` com `segundos` de duração,
// com folga pro cabeçalho do MP4 e pra variação do codificador.
function taxaDeVideo(bytes, segundos, folga) {
  const totalKbps = (bytes * 8) / 1000 / Math.max(1, segundos);
  return Math.max(150, Math.floor(totalKbps * folga - AUDIO_KBPS));
}

// Devolve { caminho, temporario }. `temporario` = true quando foi criada uma
// cópia, que quem chamou precisa apagar depois do envio.
async function caberEm(caminho, bytesMax, duracaoSegundos) {
  if (!bytesMax || fs.statSync(caminho).size <= bytesMax) return { caminho, temporario: false };
  const segundos = Number(duracaoSegundos) || (await videoEditingService.probeDuration(caminho));
  const saida = path.join(path.dirname(caminho), `${path.basename(caminho, path.extname(caminho))}-rede-${process.pid}-${Date.now()}.mp4`);
  // Duas tentativas: a codificação por taxa média às vezes passa um pouco do
  // alvo; a segunda aperta mais.
  for (const folga of [0.9, 0.72]) {
    const kbps = taxaDeVideo(bytesMax, segundos, folga);
    try {
      await videoEditingService.runFfmpegWithProgress(
        [
          '-i', caminho,
          '-c:v', 'libx264', '-preset', 'veryfast',
          '-b:v', `${kbps}k`, '-maxrate', `${Math.floor(kbps * 1.2)}k`, '-bufsize', `${kbps * 2}k`,
          '-pix_fmt', 'yuv420p',
          '-c:a', 'aac', '-b:a', `${AUDIO_KBPS}k`,
          '-movflags', '+faststart',
          saida,
        ],
        segundos,
        () => {},
        null
      );
    } catch (err) {
      fs.rmSync(saida, { force: true });
      throw err;
    }
    const tamanho = fs.statSync(saida).size;
    if (tamanho <= bytesMax) {
      logger.info(`Corte recomprimido pra caber na rede: ${fs.statSync(caminho).size} -> ${tamanho} bytes (${kbps} kbps).`);
      return { caminho: saida, temporario: true };
    }
  }
  fs.rmSync(saida, { force: true });
  throw new Error(`Não foi possível deixar o vídeo abaixo de ${Math.round(bytesMax / 1024 / 1024)} MB.`);
}

module.exports = { caberEm, taxaDeVideo };
