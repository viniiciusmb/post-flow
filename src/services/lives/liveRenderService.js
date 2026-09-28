// Transforma um corte escolhido (inicio/fim na gravacao) no video vertical
// pronto, REAPROVEITANDO o pipeline do YouTube inteiro:
//   - legenda palavra por palavra: openaiTranscriptionService (whisper-1, o
//     unico modelo da OpenAI com tempo por palavra);
//   - reenquadramento 9:16, legenda queimada, titulo: videoEditingService.renderClip;
//   - estilo: o que o usuario ja configurou em "Configurar cortes"
//     (clientVideoSettingsRepository), o mesmo que vale pros cortes dele do YouTube.
//
// Corte de "Clipar agora" chega com uma janela de ~150s e sem titulo: aqui,
// com a transcricao por palavra em maos, o modelo barato acha onde o momento
// comeca e termina dentro dela - uma transcricao so paga as duas coisas.
'use strict';

const fs = require('fs');
const path = require('path');
const config = require('../../config');
const livesRepository = require('../../repositories/livesRepository');
const clientVideoSettingsRepository = require('../../repositories/clientVideoSettingsRepository');
const videoEditingService = require('../videoEditingService');
const openaiTranscriptionService = require('../openaiTranscriptionService');
const openaiLives = require('./openaiLives');
const { ajustarIntervalo } = require('./liveAnalysisService');
const logger = require('../../lib/logger');

// Folga antes/depois pra legenda e fade nao cortarem a primeira/ultima palavra.
const MARGEM_S = 2;

function pastaDosCortes(userId) {
  return path.join(config.videoProcessing.workDir, 'lives', 'cortes', String(userId));
}

// Palavras agrupadas em linhas de ~4s com o tempo na frente: e o formato que
// deixa o modelo apontar inicio/fim com precisao de segundo.
function linhasComTempo(words) {
  const linhas = [];
  let atual = null;
  for (const w of words) {
    if (!atual || w.start - atual.inicio > 4) {
      atual = { inicio: w.start, texto: [] };
      linhas.push(atual);
    }
    atual.texto.push(w.word.trim());
  }
  return linhas.map((l) => `[${l.inicio.toFixed(1)}s] ${l.texto.join(' ')}`).join('\n');
}

const SCHEMA_CLIPAR_AGORA = {
  type: 'object',
  additionalProperties: false,
  required: ['inicio_s', 'fim_s', 'titulo', 'gancho'],
  properties: {
    inicio_s: { type: 'number' },
    fim_s: { type: 'number' },
    titulo: { type: 'string' },
    gancho: { type: 'string' },
  },
};

const SISTEMA_CLIPAR_AGORA = `Alguem apertou "Clipar agora" durante uma live: algo interessante acabou de acontecer nos ultimos ~2 minutos e meio.
Voce recebe a fala com o tempo (segundos) de cada trecho. Ache o MOMENTO que motivou o clique - normalmente perto do fim - e devolva:
- inicio_s: onde o corte deve comecar para o momento fazer sentido sozinho (inclua a preparacao necessaria, nada alem);
- fim_s: logo depois do desfecho/reacao;
- duracao entre 15 e 90 segundos;
- titulo curto (ate 60 caracteres) e gancho (ate 100 caracteres), no mesmo idioma da fala, sem hashtag.`;

async function renderizar(clip) {
  const sessao = await livesRepository.findSession(clip.session_id);
  if (!sessao) throw new Error('A gravacao desse corte nao existe mais.');

  const inicioPedido = Number(clip.start_offset);
  const fimPedido = Number(clip.end_offset);
  const segmentos = await livesRepository.videoSegmentsBetween(sessao.id, inicioPedido - MARGEM_S, fimPedido + MARGEM_S);
  if (!segmentos.length) throw new Error('Os pedacos gravados desse trecho ja foram apagados (retencao).');

  const pasta = pastaDosCortes(clip.user_id);
  fs.mkdirSync(pasta, { recursive: true });
  const base = path.join(pasta, `clip-${clip.id}`);
  const lista = `${base}.concat.txt`;
  const bruto = `${base}.bruto.mp4`;
  const audio = `${base}.audio.mp3`;
  const saida = `${base}.mp4`;
  const capa = `${base}.jpg`;

  try {
    // Junta os pedacos de 10s sem recodificar (so reembala .ts -> .mp4): o
    // unico passo pesado e o render final, igual no fluxo do YouTube.
    fs.writeFileSync(lista, segmentos.map((s) => `file '${s.file_path.replace(/'/g, "'\\''")}'`).join('\n'));
    await videoEditingService.runFfmpeg([
      '-f', 'concat', '-safe', '0', '-i', lista,
      '-c', 'copy', '-bsf:a', 'aac_adtstoasc', '-movflags', '+faststart', bruto,
    ]);
    // Eixo do arquivo juntado: o segundo 0 dele e o inicio do primeiro pedaco.
    const origem = Number(segmentos[0].start_offset);
    const duracaoBruto = await videoEditingService.probeDuration(bruto);

    await videoEditingService.extractAudio(bruto, audio);
    const transcricao = await openaiTranscriptionService.transcribeAudio(audio);
    await livesRepository.recordCost({
      channelId: clip.live_channel_id,
      sessionId: sessao.id,
      kind: 'legenda',
      audioSeconds: transcricao.durationSeconds,
      custoUsd: transcricao.costUsd,
    });

    let inicioRel = Math.max(0, inicioPedido - origem);
    let fimRel = Math.min(duracaoBruto, fimPedido - origem);
    let titulo = clip.title;
    let gancho = clip.hook;

    if (clip.source === 'clipar_agora') {
      const r = await openaiLives.pedirJson({
        nome: 'clipar_agora',
        sistema: SISTEMA_CLIPAR_AGORA,
        usuario: linhasComTempo(transcricao.words) || '(ninguem falou nada nesse trecho)',
        schema: SCHEMA_CLIPAR_AGORA,
      });
      await livesRepository.recordCost({
        channelId: clip.live_channel_id,
        sessionId: sessao.id,
        kind: 'clipar_agora',
        inputTokens: r.inputTokens,
        outputTokens: r.outputTokens,
        custoUsd: r.custoUsd,
      });
      const ajuste = ajustarIntervalo(r.dados.inicio_s, r.dados.fim_s, { min: 0, max: duracaoBruto });
      // Resposta que nao da pra usar: fica com os ultimos 60s, que e o que a
      // pessoa quis dizer com "agora" na maior parte das vezes.
      if (ajuste) {
        inicioRel = ajuste.inicio;
        fimRel = ajuste.fim;
      } else {
        inicioRel = Math.max(0, fimRel - 60);
      }
      titulo = String(r.dados.titulo || '').slice(0, 80) || null;
      gancho = String(r.dados.gancho || '').slice(0, 150) || null;
    }

    const words = transcricao.words.filter((w) => w.end > inicioRel && w.start < fimRel);
    const estilo = await clientVideoSettingsRepository.resolveForVideo(clip.user_id);
    await videoEditingService.renderClip({
      videoPath: bruto,
      startSeconds: inicioRel,
      endSeconds: fimRel,
      words,
      title: titulo || '',
      outputPath: saida,
      // Corte de live e peca unica: sem numeracao "Parte N".
      settings: { ...estilo, show_part_label: false, show_title: Boolean(titulo) && estilo.show_title !== false },
      partIndex: 1,
      partTotal: 1,
      onProgress: (p) => {
        livesRepository.updateClipProgress(clip.id, p).catch((err) => logger.error(`Lives: progresso do corte ${clip.id}:`, err.message));
      },
    });
    await videoEditingService.extractThumbnail(saida, capa, 0.5);

    await livesRepository.finishClip(clip.id, {
      inicio: origem + inicioRel,
      fim: origem + fimRel,
      titulo,
      gancho,
      clipPath: saida,
      thumbPath: capa,
    });
    logger.info(`Lives: corte ${clip.id} pronto (${sessao.id}, ${(fimRel - inicioRel).toFixed(0)}s).`);
  } finally {
    for (const f of [lista, bruto, audio]) fs.rm(f, { force: true }, () => {});
  }
}

// Renderiza o proximo da fila. Devolve false quando nao ha nada.
async function renderizarProximo() {
  const clip = await livesRepository.claimClipToRender();
  if (!clip) return false;
  try {
    await renderizar(clip);
  } catch (err) {
    logger.error(`Lives: corte ${clip.id} falhou:`, err.message);
    await livesRepository.failClip(clip.id, err.message);
  }
  return true;
}

module.exports = { renderizarProximo, renderizar, linhasComTempo, pastaDosCortes };
