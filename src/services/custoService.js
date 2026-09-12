// Registra o custo de cada video NO MOMENTO em que ele acontece.
//
// Por etapa, e nao de uma vez no fim, porque custo que ja saiu da nossa conta
// nao pode depender do video terminar bem: um video que baixa 200 MB, paga o
// Whisper e falha na renderizacao custou dinheiro de verdade. Registrar so no
// final apagaria justamente o custo das falhas - que e o que mais interessa
// vigiar.
//
// Quem guarda e videoCostsRepository, cujo lancamento sobrevive ao video ser
// apagado. As colunas de custo dentro de source_videos continuam existindo
// (a tela de processamento e o painel "Banda" usam), mas elas nao sao mais a
// contabilidade - sao o detalhe do video enquanto ele existe.
'use strict';

const videoCostsRepository = require('../repositories/videoCostsRepository');
const settingsRepository = require('../repositories/settingsRepository');
const logger = require('../lib/logger');

const BYTES_POR_GB = 1073741824;

// So o proxy PAGO vira dinheiro. Tunel (do fundador ou do cliente) e
// reaproveitamento nao custam por GB: essa banda ja esta paga na conta de
// internet de alguem, e transforma-la em custo aqui inventaria uma despesa
// que a empresa nunca teve. Mesma regra do painel "Banda" e da tela
// "Clientes" - se um dia divergirem, o mesmo GB vale dois valores diferentes
// em duas telas.
function ehPago(egressType) {
  return egressType === 'proxy';
}

async function precoDoGb() {
  return Number(await settingsRepository.getValue('custo_banda_por_gb_usd', 0)) || 0;
}

// Erro de contabilidade nunca pode derrubar o processamento de um video: o
// custo ja aconteceu de qualquer jeito, e perder a anotacao dele e menos grave
// do que perder o video. Por isso tudo aqui e best-effort com log.
async function seguro(o_que, fn) {
  try {
    return await fn();
  } catch (err) {
    logger.error(`Nao consegui registrar o custo (${o_que}):`, err);
    return null;
  }
}

function donoDe(sourceVideo) {
  return sourceVideo.owner_client_user_id || sourceVideo.client_user_id || null;
}

async function registrarDownload(sourceVideo, { bytes = 0, egressType = null } = {}) {
  return seguro(`download do video ${sourceVideo.id}`, async () => {
    const preco = ehPago(egressType) ? await precoDoGb() : 0;
    return videoCostsRepository.registrar(sourceVideo.id, donoDe(sourceVideo), {
      videoSeconds: sourceVideo.duration_seconds || 0,
      bandaUsd: (bytes / BYTES_POR_GB) * preco,
      downloadBytes: bytes,
      egressType,
      downloadReused: egressType === 'reuse',
    });
  });
}

async function registrarTranscricao(sourceVideo, { custoUsd = 0, reused = false } = {}) {
  return seguro(`transcricao do video ${sourceVideo.id}`, () =>
    videoCostsRepository.registrar(sourceVideo.id, donoDe(sourceVideo), {
      videoSeconds: sourceVideo.duration_seconds || 0,
      whisperUsd: reused ? 0 : custoUsd || 0,
      transcriptReused: reused,
    })
  );
}

async function registrarIa(sourceVideo, { custoUsd = 0 } = {}) {
  return seguro(`IA do video ${sourceVideo.id}`, () =>
    videoCostsRepository.registrar(sourceVideo.id, donoDe(sourceVideo), {
      videoSeconds: sourceVideo.duration_seconds || 0,
      iaUsd: custoUsd || 0,
    })
  );
}

// ---------------------------------------------------------------------------
// Video narrado (gerado a partir de um roteiro)
// ---------------------------------------------------------------------------

// Mesma disciplina do pipeline de cortes: cada etapa lanca o que gastou no
// momento em que gastou. Aqui isso importa ainda mais, porque a narracao e
// paga ANTES de existir qualquer imagem - um roteiro que falha na montagem ja
// custou a voz inteira.
//
// O dono do lancamento e o admin que pediu o video. Ele nao e cobrado (o
// recurso esta em modo de teste, sem tocar na cota), mas o custo precisa
// aparecer no painel: foi exatamente assim que US$ 16 em IA queimaram sem
// ninguem notar nesta VPS.
async function registrarNarrado(narratedVideo, campos = {}) {
  return seguro(`video narrado ${narratedVideo.id}`, () =>
    videoCostsRepository.registrarNarrado(narratedVideo.id, narratedVideo.admin_user_id, campos)
  );
}

module.exports = {
  registrarDownload,
  registrarTranscricao,
  registrarIa,
  registrarNarrado,
  ehPago,
  BYTES_POR_GB,
};
