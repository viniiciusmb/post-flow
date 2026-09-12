// Monta o video narrado: imagens em slides + narracao + legenda + musica.
//
// O filtro aqui nao e teorico - e exatamente o que foi validado numa amostra
// real de 31s rodada nesta VPS antes de existir este arquivo, com dois numeros
// medidos que decidiram o desenho:
//
//   desfoque em resolucao cheia (2560x1440) ... 3,82x o tempo real
//   desfoque PEQUENO (480x270) e ampliado ..... 1,67x o tempo real
//
// O resultado visual e o mesmo (desfoque forte destroi detalhe de qualquer
// jeito) e o arquivo final tem o mesmo tamanho, mas o segundo custa menos da
// metade da CPU. Numa VPS de 2 nucleos que ja roda o pipeline de cortes, essa
// diferenca e o que torna o recurso viavel.
'use strict';

const fs = require('fs');
const path = require('path');
const { runFfmpegWithProgress, runFfmpeg, probeDuration } = require('./videoEditingService');

const SAIDAS = {
  '16:9': { w: 1920, h: 1080 },
  '9:16': { w: 1080, h: 1920 },
};

const FPS = 30;
// Tempo de sobreposicao entre uma cena e a proxima. Abaixo de ~0,4s o corte
// parece seco num video narrado; acima de ~1s a imagem nova demora a "chegar".
const TRANSICAO_S = 0.7;

// Respiro depois de cada cena. Serve para duas coisas ao mesmo tempo: da a
// pausa natural que falta quando cada trecho e narrado separadamente, e - mais
// importante - torna a duracao de cada cena um numero EXATO e conhecido nosso,
// em vez de depender de quanto padding o codificador de MP3 acrescentou. Sem
// isso, a soma das duracoes individuais nao bate com a duracao do arquivo
// concatenado, e imagem e narracao vao se afastando ao longo do video.
const PAUSA_ENTRE_CENAS_S = 0.35;

// Desfoque feito neste tamanho e depois ampliado - ver o cabecalho.
const FUNDO_BORRADO = { w: 480, h: 270 };

// veryfast em vez de medium: medido, medium custa 3x mais CPU para um
// slideshow e gera arquivo do mesmo tamanho. Em video de imagem parada com
// movimento lento, o ganho de compressao dos presets lentos quase nao existe.
const RENDER = { preset: 'veryfast', crf: '21', maxrate: '5M', bufsize: '10M' };

function escapeParaFiltro(caminho) {
  return path.resolve(caminho).replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'");
}

function tempoAss(segundos) {
  const s = Math.max(0, segundos);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const seg = (s % 60).toFixed(2).padStart(5, '0');
  return `${h}:${String(m).padStart(2, '0')}:${seg}`;
}

// ---------------------------------------------------------------------------
// Audio
// ---------------------------------------------------------------------------

// Padroniza o audio de UMA cena e acrescenta a pausa. Padronizar importa: os
// arquivos vem do TTS em MP3 e vao ser concatenados com -c copy, o que so
// funciona quando todos tem o mesmo codec, taxa e numero de canais.
async function prepararAudioDaCena(origem, destino) {
  await runFfmpeg([
    '-i', origem,
    '-af', `apad=pad_dur=${PAUSA_ENTRE_CENAS_S}`,
    '-c:a', 'aac', '-b:a', '128k', '-ar', '44100', '-ac', '1',
    destino,
  ]);
  return probeDuration(destino);
}

// Junta as cenas num arquivo so. E ele que vai para o Whisper (para a legenda
// sair com o tempo certo) e para o video.
async function juntarAudio(arquivos, destino) {
  const lista = `${destino}.lista.txt`;
  fs.writeFileSync(lista, arquivos.map((a) => `file '${path.resolve(a).replace(/'/g, "'\\''")}'`).join('\n'));
  await runFfmpeg(['-f', 'concat', '-safe', '0', '-i', lista, '-c', 'copy', destino]);
  fs.rmSync(lista, { force: true });
  return probeDuration(destino);
}

// ---------------------------------------------------------------------------
// Legenda
// ---------------------------------------------------------------------------

// Legenda propria, e nao a buildAssSubtitles do pipeline de cortes: aquela
// existe para o formato vertical do TikTok (uma palavra por vez, presets de
// balao, numeracao "Parte N"). Num video narrado de 10 minutos em 16:9 o que
// funciona e o oposto - blocos curtos, discretos, no rodape.
function montarLegenda(palavras, { w, h }, destino) {
  const tamanho = Math.round(h * 0.042);
  const margem = Math.round(h * 0.06);
  const porBloco = 7;

  let ass = '[Script Info]\n'
    + 'ScriptType: v4.00+\n'
    + `PlayResX: ${w}\nPlayResY: ${h}\n`
    + 'WrapStyle: 2\nScaledBorderAndShadow: yes\n\n'
    + '[V4+ Styles]\n'
    + 'Format: Name,Fontname,Fontsize,PrimaryColour,OutlineColour,BackColour,Bold,Italic,'
    + 'BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding\n'
    + `Style: N,DejaVu Sans,${tamanho},&H00FFFFFF,&H00000000,&H80000000,-1,0,1,`
    + `${Math.max(2, Math.round(tamanho * 0.08))},1,2,${Math.round(w * 0.08)},${Math.round(w * 0.08)},${margem},1\n\n`
    + '[Events]\n'
    + 'Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text\n';

  for (let i = 0; i < palavras.length; i += porBloco) {
    const grupo = palavras.slice(i, i + porBloco);
    if (grupo.length === 0) continue;
    const texto = grupo.map((p) => String(p.word || '').trim()).join(' ').replace(/[{}]/g, '');
    if (!texto) continue;
    ass += `Dialogue: 0,${tempoAss(grupo[0].start)},${tempoAss(grupo[grupo.length - 1].end)},N,,0,0,0,,${texto}\n`;
  }

  fs.writeFileSync(destino, ass);
  return destino;
}

// ---------------------------------------------------------------------------
// Video
// ---------------------------------------------------------------------------

// Uma cena: fundo desfocado da propria imagem + a imagem inteira por cima +
// zoom lento. O fundo desfocado existe porque quase toda imagem de acervo
// historico e VERTICAL (gravura, pagina de livro: 1264x1600 e o formato
// tipico) enquanto o video e horizontal - conferido na amostra, onde as tres
// imagens escolhidas incluiam uma vertical. Sem o fundo, sobrariam duas
// tarjas pretas; com ele, a tela fica preenchida.
//
// O zoom alterna entre aproximar e afastar a cada cena: sempre no mesmo
// sentido, o video inteiro parece "cair para dentro" e cansa.
function filtroDaCena(indice, duracaoComTransicao, { w, h }) {
  const aproxima = indice % 2 === 0;
  const passo = 0.00055;
  const teto = 1.14;
  const z = aproxima
    ? `min(1+${passo}*on,${teto})`
    : `max(${teto}-${passo}*on,1.001)`;

  return `[${indice}:v]split=2[a${indice}][b${indice}];`
    + `[a${indice}]scale=${FUNDO_BORRADO.w}:${FUNDO_BORRADO.h}:force_original_aspect_ratio=increase,`
    + `crop=${FUNDO_BORRADO.w}:${FUNDO_BORRADO.h},boxblur=12:2,eq=brightness=-0.12,`
    + `scale=${w}:${h},setsar=1[bg${indice}];`
    + `[b${indice}]scale=${w}:${h}:force_original_aspect_ratio=decrease,setsar=1[fg${indice}];`
    + `[bg${indice}][fg${indice}]overlay=(W-w)/2:(H-h)/2,`
    + `zoompan=z='${z}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${w}x${h}:fps=${FPS},`
    + `setsar=1[v${indice}];`;
}

// Monta a cadeia de transicoes. O offset de cada xfade e a soma das duracoes
// das cenas ANTERIORES - com duracoes variaveis (cada cena tem o tamanho da
// fala dela), usar um passo fixo faria imagem e narracao se descolarem.
function cadeiaDeTransicoes(duracoes) {
  let filtro = '';
  let anterior = '[v0]';
  let acumulado = 0;

  for (let i = 1; i < duracoes.length; i += 1) {
    acumulado += duracoes[i - 1];
    filtro += `${anterior}[v${i}]xfade=transition=fade:duration=${TRANSICAO_S}:`
      + `offset=${acumulado.toFixed(3)}[x${i}];`;
    anterior = `[x${i}]`;
  }

  return { filtro, saida: anterior };
}

// cenas: [{ imagePath, duration }] - duration em segundos, ja com a pausa.
async function renderizar({
  cenas,
  audioPath,
  legendaPath = null,
  musicaPath = null,
  aspect = '16:9',
  destino,
  onProgress = null,
  checkCancelled = null,
}) {
  if (!Array.isArray(cenas) || cenas.length === 0) throw new Error('Não há cenas para montar o vídeo.');

  const { w, h } = SAIDAS[aspect] || SAIDAS['16:9'];
  const duracoes = cenas.map((c) => Number(c.duration) || 0);
  const total = duracoes.reduce((s, d) => s + d, 0);

  const entradas = [];
  let filtro = '';

  cenas.forEach((cena, i) => {
    // Cada imagem fica no ar o tempo da fala dela MAIS a transicao, senao a
    // ultima fracao de segundo nao teria quadro para dissolver.
    entradas.push('-loop', '1', '-t', (duracoes[i] + TRANSICAO_S).toFixed(3), '-i', cena.imagePath);
    filtro += filtroDaCena(i, duracoes[i] + TRANSICAO_S, { w, h });
  });

  const { filtro: transicoes, saida } = cadeiaDeTransicoes(duracoes);
  filtro += transicoes;

  let videoFinal = saida;
  if (legendaPath) {
    filtro += `${saida}subtitles='${escapeParaFiltro(legendaPath)}'[vleg];`;
    videoFinal = '[vleg]';
  }

  const indiceNarracao = cenas.length;
  entradas.push('-i', audioPath);

  let audioFinal = `${indiceNarracao}:a`;
  if (musicaPath) {
    const indiceMusica = indiceNarracao + 1;
    // A musica entra em loop (trilha curta cobre video longo), bem abaixo da
    // narracao, com fade no fim. Volume fixo em vez de ducking automatico: o
    // sidechain custa CPU e, a 8% de volume, a narracao ja domina sozinha.
    entradas.push('-stream_loop', '-1', '-i', musicaPath);
    filtro += `[${indiceMusica}:a]volume=0.08,afade=t=out:st=${Math.max(0, total - 3).toFixed(2)}:d=3[mus];`
      + `[${indiceNarracao}:a][mus]amix=inputs=2:duration=first:dropout_transition=0[aout];`;
    audioFinal = '[aout]';
  }

  filtro = filtro.replace(/;$/, '');

  const args = [
    ...entradas,
    '-filter_complex', filtro,
    '-map', videoFinal,
    '-map', audioFinal,
    '-c:v', 'libx264',
    '-preset', RENDER.preset,
    '-crf', RENDER.crf,
    '-maxrate', RENDER.maxrate,
    '-bufsize', RENDER.bufsize,
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', '128k',
    // Corta na duracao da narracao: a cadeia de xfade termina um pouco depois
    // (a ultima imagem ainda tem a sobra da transicao).
    '-t', total.toFixed(3),
    '-movflags', '+faststart',
    destino,
  ];

  // Reaproveita o executor do pipeline de cortes: ele ja mata o GRUPO de
  // processos (ffmpeg gera filhos), tem teto de tempo e detecta renderizacao
  // travada - tres coisas que ja custaram incidente neste projeto.
  await runFfmpegWithProgress(args, total, onProgress, checkCancelled);
  return destino;
}

module.exports = {
  renderizar,
  prepararAudioDaCena,
  juntarAudio,
  montarLegenda,
  filtroDaCena,
  cadeiaDeTransicoes,
  SAIDAS,
  TRANSICAO_S,
  PAUSA_ENTRE_CENAS_S,
  FPS,
};
