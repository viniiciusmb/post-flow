// Transforma um corte escolhido (inicio/fim na gravacao) no video vertical
// pronto, REAPROVEITANDO o pipeline do YouTube inteiro:
//   - legenda palavra por palavra: openaiTranscriptionService (whisper-1, o
//     unico modelo da OpenAI com tempo por palavra);
//   - reenquadramento 9:16, legenda queimada, titulo: videoEditingService.renderClip;
//   - estilo: o dos cortes de live do usuario (livesUserSettings) - proprio,
//     ou o mesmo dos cortes de video, se ele escolher assim.
//
// Com a transcricao por palavra em maos, o gpt-5-mini faz o AJUSTE FINO:
// onde o momento comeca (o gancho) e termina (logo depois da reacao). O juiz
// so via blocos de 30s; e aqui que o corte deixa de comecar no meio de uma
// frase. No "Clipar agora" (janela de ~150s, sem titulo) e esse mesmo passo
// que acha o momento. Uma transcricao so paga as duas coisas.
//
// E aqui tambem que a camera do streamer e localizada, num quadro do proprio
// trecho: o streamer muda de cena (jogo, conversa) e a camera muda de lugar.
'use strict';

const fs = require('fs');
const path = require('path');
const config = require('../../config');
const livesRepository = require('../../repositories/livesRepository');
const livesUserSettings = require('./livesUserSettings');
const liveFormatoService = require('./liveFormatoService');
const videoEditingService = require('../videoEditingService');
const openaiTranscriptionService = require('../openaiTranscriptionService');
const openaiLives = require('./openaiLives');
const { ajustarIntervalo } = require('./liveAnalysisService');
const logger = require('../../lib/logger');

// Quanto de video em volta do trecho pedido entra no arquivo de trabalho: e o
// espaco que o ajuste fino tem pra mover o inicio (achar o gancho) e o fim
// (pegar a reacao inteira). Custa ~30s a mais de transcricao por corte
// (~US$ 0,003).
const MARGEM_S = 15;

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

const SCHEMA_AJUSTE = {
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

const SISTEMA_AJUSTE = `Voce faz o ajuste fino de um corte de live para TikTok. Recebe a fala com o tempo (segundos) de cada trecho e o que o corte deve mostrar.
Devolva:
- inicio_s: o ponto em que quem assiste entende o que esta acontecendo em ate 3 segundos (o gancho). Inclua so a preparacao necessaria, nunca comece no meio de uma frase;
- fim_s: logo depois do desfecho ou da reacao - corte seco, sem "enrolacao" depois;
- duracao normalmente entre 25 e 60 segundos (nunca menos de 20, nunca mais de 90): corte curto demais perde a preparacao e ninguem entende a graca;
- titulo curto (ate 60 caracteres) e gancho (ate 100) no idioma falado, sem hashtag. Se ja vierem bons, pode manter.`;

const SISTEMA_CLIPAR_AGORA = `Alguem apertou "Clipar agora" durante uma live: algo interessante acabou de acontecer nos ultimos ~2 minutos e meio (normalmente perto do fim).
Ache o MOMENTO que motivou o clique e devolva onde o corte comeca (o gancho, entendivel em 3 segundos, nunca no meio de uma frase) e termina (logo depois da reacao), normalmente entre 25 e 60 segundos (minimo 20), com titulo curto (ate 60) e gancho (ate 100) no idioma falado, sem hashtag.`;

const SCHEMA_CAMERA = {
  type: 'object',
  additionalProperties: false,
  required: ['tem_webcam', 'x', 'y', 'largura', 'altura', 'confianca'],
  properties: {
    tem_webcam: { type: 'boolean' },
    x: { type: 'number' },
    y: { type: 'number' },
    largura: { type: 'number' },
    altura: { type: 'number' },
    confianca: { type: 'integer' },
  },
};

// Webcam de verdade e uma janela SOBREPOSTA e pequena, num canto. Visto no
// teste de 28/09/2026: numa live de "react", o video assistido tambem mostra
// gente, e a IA marcou o rosto GRANDE do video como se fosse a webcam - o corte
// saiu com a mesma pessoa em cima e embaixo. Retangulo maior que isto nao e
// overlay de camera (ou e a live inteira): fica o layout normal.
const CAMERA_LARGURA_MAX = 0.45;
const CAMERA_ALTURA_MAX = 0.55;
const CAMERA_AREA_MAX = 0.2;

const INSTRUCAO_CAMERA =
  'Procure a WEBCAM do streamer: uma janela pequena sobreposta, normalmente num canto, mostrando a pessoa que faz a live. ' +
  'ATENCAO: em live de "react" o video que o streamer esta assistindo ocupa a tela e tambem tem pessoas - isso NAO e a webcam. ' +
  'Devolva o retangulo da webcam em FRACOES da imagem (0 a 1): x,y do canto superior esquerdo, largura, altura. ' +
  'Se nao houver webcam sobreposta (ou a tela inteira ja for a camera), tem_webcam=false. Na duvida, tem_webcam=false. confianca de 0 a 100.';

function pareceOverlay(c) {
  return c.largura <= CAMERA_LARGURA_MAX && c.altura <= CAMERA_ALTURA_MAX && c.largura * c.altura <= CAMERA_AREA_MAX;
}

// Quanto dois retangulos se sobrepoem (0 a 1, intersecao sobre uniao).
function iou(a, b) {
  const ix = Math.max(0, Math.min(a.x + a.largura, b.x + b.largura) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.altura, b.y + b.altura) - Math.max(a.y, b.y));
  const inter = ix * iy;
  const uniao = a.largura * a.altura + b.largura * b.altura - inter;
  return uniao > 0 ? inter / uniao : 0;
}

async function detectarNoQuadro(videoPath, instante, custo) {
  const quadro = `${videoPath}.quadro-${Math.round(instante * 10)}.jpg`;
  try {
    await videoEditingService.runFfmpeg(['-ss', String(instante), '-i', videoPath, '-frames:v', '1', '-q:v', '3', quadro]);
    const r = await openaiLives.pedirJson({
      nome: 'camera_live',
      sistema: 'Voce localiza a webcam do streamer sobreposta num quadro de live da Twitch.',
      usuario: INSTRUCAO_CAMERA,
      schema: SCHEMA_CAMERA,
      modelo: openaiLives.MODELO_JUIZ,
      raciocinio: 'low',
      imagem: fs.readFileSync(quadro).toString('base64'),
    });
    await custo('camera', r);
    const c = r.dados;
    if (!c.tem_webcam || c.confianca < 60) return null;
    const cam = { x: c.x, y: c.y, largura: c.largura, altura: c.altura };
    return videoEditingService.webcamValida(cam) && pareceOverlay(cam) ? cam : null;
  } finally {
    fs.rm(quadro, { force: true }, () => {});
  }
}

// Acha a webcam do streamer em DOIS quadros do trecho (a 30% e a 70%) e so
// aceita se os dois concordarem: um rosto do video assistido muda de lugar
// entre um quadro e outro, a webcam sobreposta nao. Devolve null quando nao da
// pra confiar - ai o corte sai com o layout normal do estilo, que e sempre
// melhor que uma camera errada.
async function localizarCamera(videoPath, inicio, fim, custo) {
  try {
    const duracao = fim - inicio;
    const [a, b] = await Promise.all([
      detectarNoQuadro(videoPath, inicio + duracao * 0.3, custo),
      detectarNoQuadro(videoPath, inicio + duracao * 0.7, custo),
    ]);
    if (!a || !b || iou(a, b) < 0.5) return null;
    // Media dos dois quadros, SEM folga em volta: a janela da camera e um
    // retangulo exato na tela, e qualquer folga pega o que esta ao redor dela
    // (borda preta, @ do canal, icones) - foi o "espaco preto no canto" que o
    // fundador apontou em 29/09/2026.
    const media = (k) => (a[k] + b[k]) / 2;
    const cam = { x: media('x'), y: media('y'), largura: media('largura'), altura: media('altura') };
    return videoEditingService.webcamValida(cam) ? cam : null;
  } catch (err) {
    logger.warn(`Lives: nao consegui localizar a camera (${err.message}) - segue com o layout normal.`);
    return null;
  }
}

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

    // So o trecho pedido mais a folga do ajuste fino vai pra legenda - nao os
    // pedacos de 10s inteiros que o arquivo de trabalho carrega (ate 20s a mais
    // por corte, pagos no whisper-1). Os tempos das palavras voltam pro eixo
    // do arquivo de trabalho somando o inicio do recorte.
    const audioDe = Math.max(0, inicioPedido - origem - MARGEM_S);
    const audioAte = Math.min(duracaoBruto, fimPedido - origem + MARGEM_S);
    await videoEditingService.runFfmpeg([
      '-ss', String(audioDe), '-to', String(audioAte), '-i', bruto,
      '-vn', '-ac', '1', '-ar', '16000', '-b:a', '64k', audio,
    ]);
    const transcricaoDoRecorte = await openaiTranscriptionService.transcribeAudio(audio);
    const transcricao = {
      ...transcricaoDoRecorte,
      words: transcricaoDoRecorte.words.map((w) => ({ ...w, start: w.start + audioDe, end: w.end + audioDe })),
    };
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
    const custo = (kind, r) =>
      livesRepository.recordCost({
        channelId: clip.live_channel_id,
        sessionId: sessao.id,
        kind,
        inputTokens: r.inputTokens,
        outputTokens: r.outputTokens,
        custoUsd: r.custoUsd,
      });

    // Ajuste fino em TODO corte (nao so no "Clipar agora").
    const cliparAgora = clip.source === 'clipar_agora';
    const pedido = cliparAgora
      ? 'Momento: o que motivou o clique.'
      : `Trecho escolhido pelo juiz: ${inicioRel.toFixed(0)}s a ${fimRel.toFixed(0)}s. Titulo proposto: "${titulo || ''}". Gancho proposto: "${gancho || ''}".`;
    try {
      const r = await openaiLives.pedirJson({
        nome: cliparAgora ? 'clipar_agora' : 'ajuste_fino',
        sistema: cliparAgora ? SISTEMA_CLIPAR_AGORA : SISTEMA_AJUSTE,
        usuario: `${pedido}\n\n${linhasComTempo(transcricao.words) || '(ninguem falou nada nesse trecho)'}`,
        schema: SCHEMA_AJUSTE,
        modelo: openaiLives.MODELO_JUIZ,
        raciocinio: 'low',
      });
      await custo(cliparAgora ? 'clipar_agora' : 'ajuste_fino', r);
      // Fora do "Clipar agora", o ajuste fica a ate 20s do que o juiz pediu:
      // e ajuste, nao outra escolha.
      // Minimo de 20s: no teste real o ajuste apertou demais (18s e 21s) e o
      // corte perdia a preparacao do momento.
      const limites = cliparAgora
        ? { min: 0, max: duracaoBruto, minDuracao: 20 }
        : { min: Math.max(0, inicioRel - 20), max: Math.min(duracaoBruto, fimRel + 20), minDuracao: 20 };
      const ajuste = ajustarIntervalo(r.dados.inicio_s, r.dados.fim_s, limites);
      if (ajuste) {
        inicioRel = ajuste.inicio;
        fimRel = ajuste.fim;
      } else if (cliparAgora) {
        // Resposta inutil no Clipar agora: fica com os ultimos 60s.
        inicioRel = Math.max(0, fimRel - 60);
      }
      titulo = String(r.dados.titulo || '').slice(0, 80) || titulo;
      gancho = String(r.dados.gancho || '').slice(0, 150) || gancho;
    } catch (err) {
      // Ajuste fino e melhoria, nao requisito: sem ele o corte sai com o
      // trecho do juiz (ou os ultimos 60s, no Clipar agora).
      logger.warn(`Lives: ajuste fino do corte ${clip.id} falhou (${err.message}) - seguindo sem ele.`);
      if (cliparAgora) inicioRel = Math.max(0, fimRel - 60);
    }

    const words = transcricao.words.filter((w) => w.end > inicioRel && w.start < fimRel);
    const { estilo, camera } = await livesUserSettings.estiloParaRender(clip.user_id);
    // Enquadramento: 'ia' = a IA monta o formato deste corte (paineis ou
    // quadro inteiro); 'auto' = sempre destacar a webcam; 'desligado' =
    // estilo normal. O que foi decidido fica gravado no corte (coluna webcam)
    // pra dar pra conferir depois.
    let webcam = null;
    let formato = null;
    if (camera.modo === 'ia') {
      formato = await liveFormatoService.escolherFormato(bruto, inicioRel, fimRel, custo);
      await livesRepository.setClipWebcam(clip.id, { formato });
    } else if (camera.modo === 'auto') {
      webcam = await localizarCamera(bruto, inicioRel, fimRel, custo);
      if (webcam) {
        // A faixa tem o formato da propria camera (a altura escolhida na tela
        // vira o TETO): a cena inteira da camera aparece, sem esticar.
        const fonte = await liveFormatoService.dimensoes(bruto);
        webcam.alturaPercent = liveFormatoService.alturaDaJanela(webcam, fonte, camera.alturaPercent);
      }
      await livesRepository.setClipWebcam(clip.id, webcam);
    }
    await videoEditingService.renderClip({
      videoPath: bruto,
      startSeconds: inicioRel,
      endSeconds: fimRel,
      words,
      title: titulo || '',
      outputPath: saida,
      // Corte de live e peca unica: sem numeracao "Parte N".
      settings: {
        ...estilo,
        show_part_label: false,
        show_title: Boolean(titulo) && estilo.show_title !== false,
        live_webcam: webcam ? { ...webcam, heightPercent: webcam.alturaPercent, position: camera.posicao } : null,
        live_formato: formato,
      },
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

module.exports = { renderizarProximo, renderizar, linhasComTempo, pastaDosCortes, localizarCamera, pareceOverlay, iou };
