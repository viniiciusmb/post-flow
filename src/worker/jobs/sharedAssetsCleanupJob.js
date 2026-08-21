// Apaga o vídeo-fonte compartilhado quando ninguém mais precisa dele.
//
// O arquivo compartilhado é o que permite dois clientes que monitoram o mesmo
// canal baixarem o vídeo uma vez só (ver processVideoJob.js). Em troca, ele
// não pode mais ser apagado assim que o primeiro cliente termina - o segundo
// ainda vai usá-lo. Este job é quem assume essa responsabilidade.
//
// Duas condições, e basta uma:
//
//   1. Nenhum source_video daquele vídeo do YouTube está mais em situação de
//      precisar do arquivo (ver STATUS_QUE_AINDA_PRECISA_DO_ARQUIVO). É o
//      caso normal e o mais rápido.
//   2. O arquivo passou de MAX_HORAS_EM_DISCO. Rede de segurança: um vídeo
//      esquecido em 'error' ou 'paused' para sempre prenderia centenas de MB
//      indefinidamente. Se depois disso alguém precisar, o pipeline
//      simplesmente baixa de novo - custa banda, não custa correção.
//
// A transcrição NUNCA é apagada aqui: ela é minúscula (JSONB) e é a parte mais
// cara de refazer (Whisper). Sobrevive ao arquivo de propósito.
'use strict';

const fs = require('fs');
const path = require('path');
const sharedVideoAssetsRepository = require('../../repositories/sharedVideoAssetsRepository');
const sourceVideosRepository = require('../../repositories/sourceVideosRepository');
const sharedVideoFiles = require('../../lib/sharedVideoFiles');
const logger = require('../../lib/logger');

const MAX_HORAS_EM_DISCO = 48;

// Arquivo órfão precisa desta idade mínima antes de ser varrido: existe uma
// janela de segundos entre o pipeline mover o arquivo pra pasta compartilhada
// e gravar a linha no banco. Apagar um arquivo "sem dono" nesse intervalo
// mataria um download que acabou de acontecer.
const IDADE_MINIMA_ORFAO_HORAS = 1;

async function run() {
  const apagados = await limparArquivosSemConsumidor();
  const orfaos = await limparOrfaos();
  return { apagados, orfaos };
}

async function limparArquivosSemConsumidor() {
  const assets = await sharedVideoAssetsRepository.listWithFile();
  let apagados = 0;

  for (const asset of assets) {
    try {
      const existeEmDisco = fs.existsSync(asset.local_video_path);
      const pendentes = await sourceVideosRepository.countPendingByYoutubeVideoId(asset.youtube_video_id);
      const horas = asset.downloaded_at ? (Date.now() - new Date(asset.downloaded_at).getTime()) / 3_600_000 : Infinity;
      const velhoDemais = horas >= MAX_HORAS_EM_DISCO;

      // O arquivo já não está lá (apagado à mão, disco limpo, deploy que
      // perdeu o volume): a linha precisa refletir isso, senão o pipeline
      // acha que dá pra reaproveitar e falha na hora de cortar.
      if (!existeEmDisco) {
        await sharedVideoAssetsRepository.clearFile(asset.youtube_video_id);
        continue;
      }

      if (pendentes > 0 && !velhoDemais) continue;

      fs.rmSync(asset.local_video_path, { force: true });
      await sharedVideoAssetsRepository.clearFile(asset.youtube_video_id);
      apagados += 1;
      logger.info(
        `Video compartilhado ${asset.youtube_video_id} apagado do disco ` +
          `(${pendentes} video(s) ainda pendente(s), ${Math.round(horas)}h em disco). ` +
          `Foi reaproveitado ${asset.download_reuse_count}x; a transcricao continua guardada.`
      );
    } catch (err) {
      // Um arquivo problemático não pode impedir a limpeza dos outros.
      logger.error(`Falha ao limpar o video compartilhado ${asset.youtube_video_id}:`, err);
    }
  }

  return apagados;
}

// Arquivo na pasta compartilhada sem nenhuma linha apontando pra ele. Acontece
// se o processo morrer entre mover o arquivo e gravar no banco - sem esta
// varredura, esse arquivo ficaria ocupando disco pra sempre sem ninguém saber.
async function limparOrfaos() {
  const dir = sharedVideoFiles.dir();
  if (!fs.existsSync(dir)) return 0;

  const assets = await sharedVideoAssetsRepository.listWithFile();
  const conhecidos = new Set(assets.map((a) => path.resolve(a.local_video_path)));

  let orfaos = 0;
  for (const nome of fs.readdirSync(dir)) {
    const caminho = path.join(dir, nome);
    try {
      const stat = fs.statSync(caminho);
      if (!stat.isFile()) continue;
      if (conhecidos.has(path.resolve(caminho))) continue;

      const horas = (Date.now() - stat.mtimeMs) / 3_600_000;
      if (horas < IDADE_MINIMA_ORFAO_HORAS) continue;

      fs.rmSync(caminho, { force: true });
      orfaos += 1;
      logger.info(`Arquivo orfao na pasta compartilhada apagado: ${nome} (${Math.round(horas)}h, sem dono no banco).`);
    } catch (err) {
      logger.error(`Falha ao conferir o arquivo compartilhado ${nome}:`, err);
    }
  }

  return orfaos;
}

module.exports = { run, MAX_HORAS_EM_DISCO, IDADE_MINIMA_ORFAO_HORAS };
