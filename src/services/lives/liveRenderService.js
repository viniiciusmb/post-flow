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
const tiposDeMomento = require('./tiposDeMomento');
const logger = require('../../lib/logger');

// Quanto de video em volta do trecho pedido entra no arquivo de trabalho: e o
// espaco que o ajuste fino tem pra mover o inicio (achar o gancho) e o fim.
// DEPOIS do trecho a folga e maior: o desfecho costuma vir logo depois de onde
// o juiz marcou - no teste de 29/09 o corte "Vai chegar um amigo novo (mas nao
// e bom)" terminou em "que pode..." e o "mas nao vai ser uma boa" ficou de
// fora. Custa ~30s a mais de transcricao por corte (~US$ 0,003).
const MARGEM_ANTES_S = 15;
const MARGEM_DEPOIS_S = 30;
// Historia/intriga/briga: o ajuste fino pode precisar voltar mais pra pegar
// o comeco do assunto. Custa ~30s a mais de transcricao so nesses cortes.
const MARGEM_ANTES_LONGA_S = 45;

function margemAntes(tipo) {
  return tiposDeMomento.duracaoMaxDoTipo(tipo) > tiposDeMomento.DURACAO_MAX_PADRAO ? MARGEM_ANTES_LONGA_S : MARGEM_ANTES_S;
}

function pastaDosCortes(userId) {
  return path.join(config.videoProcessing.workDir, 'lives', 'cortes', String(userId));
}

// A fala FRASE A FRASE com inicio e fim - e o que deixa o modelo ver onde
// cada frase termina (pedacos fixos de 4s cortavam frases ao meio e ele
// escolhia o fim no meio de uma fala).
function frasesComTempo(segments) {
  return segments.map((sg) => `[${sg.start.toFixed(1)}s - ${sg.end.toFixed(1)}s] ${sg.text}`).join('\n');
}

// Palavras agrupadas em linhas de ~4s com o tempo na frente (usado quando o
// Whisper nao devolve frases).
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

// Encaixa inicio e fim do corte nos LIMITES DA FALA - garantido aqui, nao
// pedido a IA (que no teste terminou o corte no meio de uma frase):
//  - fim: vai ate o FIM da frase em andamento (mais um respiro). Se a frase
//    for longa demais (a transcricao junta falas corridas), usa a pausa entre
//    palavras mais proxima;
//  - inicio: volta pro COMECO da frase em andamento.
// Tempos em segundos do arquivo de trabalho; "duracao" e o fim do arquivo.
const RESPIRO_FIM_S = 0.4;
const PAUSA_MIN_S = 0.45;
const ESTENDER_FIM_MAX_S = 10;
const RECUAR_INICIO_MAX_S = 8;

function encaixarNaFala({ inicio, fim, segments = [], words = [], duracao, duracaoMax = tiposDeMomento.DURACAO_MAX_PADRAO }) {
  let novoFim = fim;
  const fraseDoFim = segments.find((sg) => sg.end >= fim - 0.3);
  if (fraseDoFim && fraseDoFim.end - fim <= ESTENDER_FIM_MAX_S) {
    novoFim = fraseDoFim.end + RESPIRO_FIM_S;
  } else {
    // Sem frase que termine perto: a pausa entre palavras mais proxima depois
    // do fim pedido (ou a ultima palavra ja dita, se nao houver pausa).
    const pausa = words.findIndex((w, i) => i + 1 < words.length && w.end >= fim - 1 && words[i + 1].start - w.end >= PAUSA_MIN_S && w.end - fim <= ESTENDER_FIM_MAX_S);
    if (pausa >= 0) novoFim = words[pausa].end + RESPIRO_FIM_S;
  }
  let novoInicio = inicio;
  const fraseDoInicio = [...segments].reverse().find((sg) => sg.start <= inicio + 0.3);
  if (fraseDoInicio && inicio - fraseDoInicio.start <= RECUAR_INICIO_MAX_S) novoInicio = Math.max(0, fraseDoInicio.start - 0.15);
  novoFim = Math.min(duracao, novoFim);
  // Passou do teto: encurta pelo fim de uma frase anterior que ainda caiba.
  if (novoFim - novoInicio > duracaoMax) {
    const cabe = [...segments].reverse().find((sg) => sg.end + RESPIRO_FIM_S - novoInicio <= duracaoMax && sg.end > novoInicio + 15);
    novoFim = cabe ? cabe.end + RESPIRO_FIM_S : novoInicio + duracaoMax;
  }
  return { inicio: Math.round(novoInicio * 100) / 100, fim: Math.round(novoFim * 100) / 100 };
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
- inicio_s: o COMECO de uma frase, no ponto em que quem assiste entende o que esta acontecendo em ate 3 segundos (o gancho). Inclua so a preparacao necessaria;
- fim_s: o FIM da frase em que o ASSUNTO DO TITULO se conclui (a resposta, a piada, a revelacao, a reacao a ela). Duas regras, as duas valem:
  1. nunca termine antes da conclusao nem no meio de uma fala - se o desfecho vem nas frases seguintes, estenda ate ele;
  2. nunca continue num assunto NOVO - quando alguem muda de assunto (outra pergunta, outro tema, "e o fulano?"), o corte termina na frase ANTERIOR a essa mudanca;
- o corte tem que fazer sentido do comeco ao fim pra quem NUNCA viu a live: a primeira frase situa (do que se trata, quem fala com quem), o meio desenvolve, o fim conclui;
- duracao: momento rapido (piada, reacao, mancada) normalmente entre 25 e 60 segundos, nunca menos de 20; historia, intriga, reflexao, briga e polemica podem ir ate o limite informado se precisarem disso pra ter comeco, meio e fim. Corte curto demais perde a preparacao e ninguem entende a graca; longo demais perde quem assiste;
- titulo curto (ate 60 caracteres) e gancho (ate 100) no idioma falado, sem hashtag. Se ja vierem bons, pode manter.`;

const SISTEMA_CLIPAR_AGORA = `Alguem apertou "Clipar agora" durante uma live: algo interessante acabou de acontecer nos ultimos ~2 minutos e meio (normalmente perto do fim).
Ache o MOMENTO que motivou o clique e devolva onde o corte comeca (o COMECO de uma frase, com o gancho entendivel em 3 segundos) e termina (o FIM de uma frase, depois da conclusao/reacao - nunca no meio de uma fala), normalmente entre 25 e 60 segundos (minimo 20), com titulo curto (ate 60) e gancho (ate 100) no idioma falado, sem hashtag.`;

// ------------------------------------------------------------------ revisao final
//
// Ultima camada antes do video existir (pedido de 04/10/2026: "o corte fazer
// sentido do comeco ao fim"). O juiz e o ajuste fino escolhem olhando a live
// em volta; a revisao le SO o que ficou dentro do corte, como quem esta
// rolando o feed e nunca viu a live, e responde: da pra entender do que se
// trata logo no comeco? termina na conclusao? o titulo promete o que o corte
// entrega? Pode corrigir inicio/fim (dentro do que foi transcrito), reescrever
// o titulo, ou descartar - corte descartado nao renderiza e abre vaga pro
// proximo candidato. No "Clipar agora" nunca descarta: alguem pediu o corte.
const SCHEMA_REVISAO = {
  type: 'object',
  additionalProperties: false,
  required: ['entende_sozinho', 'comeco_ok', 'fim_ok', 'nota_historia', 'problemas', 'veredito', 'inicio_s', 'fim_s', 'titulo', 'gancho'],
  properties: {
    entende_sozinho: { type: 'boolean' },
    comeco_ok: { type: 'boolean' },
    fim_ok: { type: 'boolean' },
    nota_historia: { type: 'integer' },
    problemas: { type: 'string' },
    veredito: { type: 'string', enum: ['aprovado', 'corrigido', 'descartar'] },
    inicio_s: { type: 'number' },
    fim_s: { type: 'number' },
    titulo: { type: 'string' },
    gancho: { type: 'string' },
  },
};

const SISTEMA_REVISAO = `Voce e o revisor final de um canal de cortes de live no TikTok. O corte ja foi escolhido e recortado; voce decide se ele se sustenta SOZINHO.
Voce recebe a fala frase a frase (segundos) em tres partes: ANTES DO CORTE (fica de fora), DENTRO DO CORTE (e o que a pessoa vai ver) e DEPOIS DO CORTE (fica de fora). Leia DENTRO DO CORTE como alguem rolando o feed que nunca viu essa live.

Responda:
- comeco_ok: nas primeiras frases da pra entender do que se trata? Comecar no meio de uma conversa ("e ai ele falou que..." sem saber quem e ele), responder uma pergunta que ficou de fora, ou continuar um assunto que comecou antes = false;
- fim_ok: termina na conclusao (a piada, a resposta, a revelacao, o desfecho da historia, a reacao)? Parar antes do desfecho, ou emendar um assunto novo depois dele = false;
- entende_sozinho: quem nunca viu a live entende o corte do comeco ao fim (o titulo pode dar o contexto de uma linha)?
- nota_historia (0 a 10): o quanto o corte funciona como uma peca fechada - comeco que situa, meio que prende, fim que entrega;
- problemas: em uma frase, o que esta errado (vazio se nada).

veredito:
- "aprovado": comeco e fim ja estao certos. Devolva inicio_s/fim_s iguais aos atuais;
- "corrigido": da pra consertar mexendo no inicio e/ou no fim usando o que esta ANTES ou DEPOIS (ex.: puxar o inicio pra pergunta que gerou a resposta; estender o fim ate a conclusao; cortar o assunto novo que comecou no final). Devolva os novos inicio_s/fim_s - sempre no comeco de uma frase e no fim de outra;
- "descartar": nem mexendo no inicio/fim vira uma peca que se entende sozinha (precisa de contexto demais, nao tem desfecho em lugar nenhum, e conversa morna). Seja honesto: e melhor descartar do que publicar corte sem sentido.

titulo (ate 60 caracteres) e gancho (ate 100), no idioma falado, sem hashtag: reescreva pra descrever EXATAMENTE o que acontece dentro do corte final - nunca prometa algo que o corte nao mostra. O titulo pode dar o contexto que falta em uma linha ("Contou como perdeu 50 mil num dia"). Dinheiro/ostentacao: o numero ou o item vai no titulo.`;

function frasesEntre(segments, de, ate) {
  return segments.filter((sg) => sg.end > de + 0.05 && sg.start < ate - 0.05);
}

async function revisarCorte({ transcricao, inicio, fim, duracao, tipo, titulo, gancho, cliparAgora, custo }) {
  const segs = transcricao.segments || [];
  if (!segs.length) return null;
  const texto = (lista) => (lista.length ? frasesComTempo(lista) : '(nada)');
  const r = await openaiLives.pedirJson({
    nome: 'revisao_corte',
    sistema: SISTEMA_REVISAO,
    usuario:
      `Tipo do momento: ${tipo || 'nao classificado'}. Limite de duracao: ${tiposDeMomento.duracaoMaxDoTipo(tipo)}s.
` +
      `Titulo atual: "${titulo || ''}". Gancho atual: "${gancho || ''}".
` +
      `Corte atual: ${inicio.toFixed(1)}s a ${fim.toFixed(1)}s.

` +
      `ANTES DO CORTE (fica de fora):
${texto(frasesEntre(segs, Math.max(0, inicio - 60), inicio))}

` +
      `DENTRO DO CORTE:
${texto(frasesEntre(segs, inicio, fim))}

` +
      `DEPOIS DO CORTE (fica de fora):
${texto(frasesEntre(segs, fim, Math.min(duracao, fim + 30)))}`,
    schema: SCHEMA_REVISAO,
    modelo: openaiLives.MODELO_JUIZ,
    raciocinio: 'medium',
  });
  await custo('revisao', r);
  const d = r.dados;
  const veredito = cliparAgora && d.veredito === 'descartar' ? 'corrigido' : d.veredito;
  return {
    veredito,
    entendeSozinho: d.entende_sozinho,
    comecoOk: d.comeco_ok,
    fimOk: d.fim_ok,
    notaHistoria: Math.max(0, Math.min(10, Math.round(Number(d.nota_historia) || 0))),
    problemas: String(d.problemas || '').slice(0, 300),
    inicio: Number(d.inicio_s),
    fim: Number(d.fim_s),
    titulo: String(d.titulo || '').slice(0, 80),
    gancho: String(d.gancho || '').slice(0, 150),
  };
}

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
      sistema: 'Voce localiza a webcam do streamer sobreposta num quadro de live (Twitch ou Kick).',
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
  const tipo = clip.moment_type || null;
  const antes = margemAntes(tipo);
  const duracaoMax = tiposDeMomento.duracaoMaxDoTipo(tipo);
  const segmentos = await livesRepository.videoSegmentsBetween(sessao.id, inicioPedido - antes, fimPedido + MARGEM_DEPOIS_S);
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
    const audioDe = Math.max(0, inicioPedido - origem - antes);
    const audioAte = Math.min(duracaoBruto, fimPedido - origem + MARGEM_DEPOIS_S);
    await videoEditingService.runFfmpeg([
      '-ss', String(audioDe), '-to', String(audioAte), '-i', bruto,
      '-vn', '-ac', '1', '-ar', '16000', '-b:a', '64k', audio,
    ]);
    const transcricaoDoRecorte = await openaiTranscriptionService.transcribeAudio(audio);
    const transcricao = {
      ...transcricaoDoRecorte,
      words: transcricaoDoRecorte.words.map((w) => ({ ...w, start: w.start + audioDe, end: w.end + audioDe })),
      segments: (transcricaoDoRecorte.segments || []).map((sg) => ({ ...sg, start: sg.start + audioDe, end: sg.end + audioDe })),
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
        tier: r.tier || null,
      });

    // Ajuste fino em TODO corte (nao so no "Clipar agora").
    const cliparAgora = clip.source === 'clipar_agora';
    const pedido = cliparAgora
      ? 'Momento: o que motivou o clique.'
      : `Trecho escolhido pelo juiz: ${inicioRel.toFixed(0)}s a ${fimRel.toFixed(0)}s. Tipo do momento: ${tipo || 'nao classificado'} (limite de ${duracaoMax}s). Titulo proposto: "${titulo || ''}". Gancho proposto: "${gancho || ''}".`;
    try {
      const r = await openaiLives.pedirJson({
        nome: cliparAgora ? 'clipar_agora' : 'ajuste_fino',
        sistema: cliparAgora ? SISTEMA_CLIPAR_AGORA : SISTEMA_AJUSTE,
        usuario: `${pedido}\n\nFala, frase a frase (segundos):\n${
          (transcricao.segments.length ? frasesComTempo(transcricao.segments) : linhasComTempo(transcricao.words)) || '(ninguem falou nada nesse trecho)'
        }`,
        schema: SCHEMA_AJUSTE,
        modelo: openaiLives.MODELO_JUIZ,
        // 'medium': achar onde o assunto comeca e termina e o que faz o
        // corte ter sentido; custa ~US$ 0,002 a mais por corte.
        raciocinio: 'medium',
      });
      await custo(cliparAgora ? 'clipar_agora' : 'ajuste_fino', r);
      // Fora do "Clipar agora", o ajuste fica a ate 20s do que o juiz pediu:
      // e ajuste, nao outra escolha.
      // Minimo de 20s: no teste real o ajuste apertou demais (18s e 21s) e o
      // corte perdia a preparacao do momento.
      // Historia pode voltar ate o comeco da margem pra pegar a preparacao.
      const limites = cliparAgora
        ? { min: 0, max: duracaoBruto, minDuracao: 20, duracaoMax }
        : { min: Math.max(0, inicioRel - (antes > MARGEM_ANTES_S ? antes : 20)), max: Math.min(duracaoBruto, fimRel + MARGEM_DEPOIS_S), minDuracao: 20, duracaoMax };
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

    // Garantia: comeca no inicio de uma frase e termina no fim de uma.
    const naFala = encaixarNaFala({
      inicio: inicioRel,
      fim: fimRel,
      segments: transcricao.segments,
      words: transcricao.words,
      duracao: duracaoBruto,
      duracaoMax,
    });
    inicioRel = naFala.inicio;
    fimRel = naFala.fim;

    // Revisao final: le so o que ficou dentro do corte. Falha da IA nao
    // segura o corte (e melhoria, nao requisito).
    let revisao = null;
    try {
      revisao = await revisarCorte({ transcricao, inicio: inicioRel, fim: fimRel, duracao: duracaoBruto, tipo, titulo, gancho, cliparAgora, custo });
    } catch (err) {
      logger.warn(`Lives: revisao do corte ${clip.id} falhou (${err.message}) - seguindo sem ela.`);
    }
    if (revisao) {
      if (revisao.veredito === 'descartar') {
        await livesRepository.discardClip(clip.id, { motivo: revisao.problemas || 'A revisao final achou que o corte nao se sustenta sozinho.', review: revisao });
        logger.info(`Lives: corte ${clip.id} descartado na revisao (${revisao.problemas}).`);
        return;
      }
      if (revisao.veredito === 'corrigido') {
        // So dentro do que foi transcrito (o arquivo de trabalho), e de novo
        // encaixado na fala.
        const corrigido = ajustarIntervalo(revisao.inicio, revisao.fim, { min: 0, max: duracaoBruto, minDuracao: 20, duracaoMax });
        if (corrigido) {
          const ok = encaixarNaFala({ ...corrigido, segments: transcricao.segments, words: transcricao.words, duracao: duracaoBruto, duracaoMax });
          inicioRel = ok.inicio;
          fimRel = ok.fim;
        }
      }
      titulo = revisao.titulo || titulo;
      gancho = revisao.gancho || gancho;
      await livesRepository.setClipReview(clip.id, { ...revisao, inicioFinal: inicioRel, fimFinal: fimRel });
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
    // Legenda e titulo na mesma altura se sobrepoem (visto no corte "Janela
    // do banheiro caiu": legenda a 60% do topo, titulo a 62%). O titulo sobe
    // pro topo - so aqui, nas lives: o estilo salvo nao muda.
    const legendaDoTopo = 100 - Number(estilo.caption_height_percent ?? 14);
    const tituloDoTopo = Number(estilo.title_height_percent ?? 8);
    const titleHeight = Math.abs(legendaDoTopo - tituloDoTopo) < 15 ? 6 : tituloDoTopo;
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
        title_height_percent: titleHeight,
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

module.exports = { renderizarProximo, renderizar, revisarCorte, margemAntes, encaixarNaFala, frasesComTempo, linhasComTempo, pastaDosCortes, localizarCamera, pareceOverlay, iou };
