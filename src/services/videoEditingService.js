// Edicao de video via ffmpeg: extrair audio (pra mandar pro Whisper),
// cortar um trecho, reenquadrar (proporcao/enquadramento configuraveis por
// cliente), queimar legenda estilo TikTok e titulo opcional, tudo numa
// passada so, mais a capa (thumbnail) do corte pronto.
'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { PausedError } = require('../lib/errors');
const logger = require('../lib/logger');

const FFMPEG_PATH = process.env.FFMPEG_PATH || 'ffmpeg';
const FFPROBE_PATH = process.env.FFPROBE_PATH || 'ffprobe';

const ASPECT_RATIOS = {
  '9:16': { w: 1080, h: 1920 },
  '1:1': { w: 1080, h: 1080 },
  '16:9': { w: 1920, h: 1080 },
  '4:5': { w: 1080, h: 1350 },
};

const QUALITY_PRESETS = {
  high: { crf: 20, preset: 'medium' },
  medium: { crf: 26, preset: 'fast' },
};

// Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour,
//         Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle,
//         Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
// bubble_dark/bubble_purple usam BorderStyle=3 (caixa opaca atras do texto,
// em vez de so contorno+sombra) - o campo "Outline" nesse modo vira o
// espacamento da caixa, e BackColour vira a cor de preenchimento dela (era
// so usada como cor de sombra nos estilos com BorderStyle=1 acima).
const CAPTION_STYLES = {
  classic: 'Style: Default,Arial Black,96,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,1,0,0,0,100,100,0,0,1,7,0,2,80,80,260,1',
  bold: 'Style: Default,Arial Black,112,&H0000D7FF,&H000000FF,&H00000000,&H00000000,1,0,0,0,100,100,0,0,1,9,0,2,60,60,300,1',
  minimal: 'Style: Default,Arial,64,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,3,0,2,100,100,140,1',
  bubble_dark: 'Style: Default,Arial Black,90,&H00FFFFFF,&H000000FF,&H00000000,&H50000000,1,0,0,0,100,100,0,0,3,14,0,2,80,80,260,1',
  bubble_purple: 'Style: Default,Arial Black,90,&H00FFFFFF,&H000000FF,&H00000000,&H50B26EF2,1,0,0,0,100,100,0,0,3,14,0,2,80,80,260,1',
};

// Mesma ideia do CAPTION_STYLES, mas pro titulo queimado no comeco do video -
// Alignment=8 (topo-centro) em todos, fonte maior. O "Name" do Style
// continua "Title" nos 5 (e o mesmo nome referenciado no Dialogue).
const TITLE_STYLES = {
  classic: 'Style: Title,Arial Black,72,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,1,0,0,0,100,100,0,0,1,6,0,8,80,80,120,1',
  bold: 'Style: Title,Arial Black,80,&H0000D7FF,&H000000FF,&H00000000,&H00000000,1,0,0,0,100,100,0,0,1,7,0,8,60,60,120,1',
  minimal: 'Style: Title,Arial,56,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,3,0,8,100,100,100,1',
  bubble_dark: 'Style: Title,Arial Black,64,&H00FFFFFF,&H000000FF,&H00000000,&H50000000,1,0,0,0,100,100,0,0,3,12,0,8,80,80,120,1',
  bubble_purple: 'Style: Title,Arial Black,64,&H00FFFFFF,&H000000FF,&H00000000,&H50B26EF2,1,0,0,0,100,100,0,0,3,12,0,8,80,80,120,1',
};

// Mapeia a posicao escolhida (numeracao "Parte N") pro campo Alignment do
// ASS - que ja usa a mesma convencao de teclado numerico (7/8/9 = topo
// esquerda/centro/direita, 1/2/3 = baixo esquerda/centro/direita).
const PART_LABEL_ALIGNMENT = {
  top_left: 7,
  top_center: 8,
  top_right: 9,
  bottom_left: 1,
  bottom_center: 2,
  bottom_right: 3,
};

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(FFMPEG_PATH, ['-y', '-hide_banner', '-loglevel', 'error', ...args]);
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(`ffmpeg saiu com codigo ${code}: ${stderr.slice(-800)}`));
      }
      resolve();
    });
  });
}

// Igual runFfmpeg, mas acompanha o progresso (via -progress) e chama
// onProgress(percent) periodicamente enquanto roda - usado pra mostrar a
// barra de "% concluido" de cada corte na tela. Se checkCancelled for
// passado, confere a cada tick (mesmo timer do progresso) e mata o ffmpeg na
// hora se o cliente pediu pausa - sem isso, pausar so tinha efeito depois
// que o corte inteiro terminasse de renderizar (podia levar minutos).
function runFfmpegWithProgress(args, totalDurationSeconds, onProgress, checkCancelled) {
  return new Promise((resolve, reject) => {
    const progressFile = path.join(os.tmpdir(), `ffmpeg-progress-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);
    fs.writeFileSync(progressFile, '');

    const child = spawn(FFMPEG_PATH, ['-y', '-hide_banner', '-loglevel', 'error', ...args, '-progress', progressFile, '-nostats'], {
      detached: true,
    });
    function killGroup() {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        // grupo ja morreu - ignora
      }
    }
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk; });

    let closed = false;
    let cancelling = false;
    const poll = setInterval(async () => {
      if (closed) return;
      if (checkCancelled && !cancelling) {
        cancelling = true;
        try {
          if (await checkCancelled()) {
            killGroup();
            return;
          }
        } finally {
          cancelling = false;
        }
      }
      if (!totalDurationSeconds) return;
      try {
        const content = fs.readFileSync(progressFile, 'utf8');
        const match = [...content.matchAll(/out_time_ms=(\d+)/g)].at(-1);
        if (match) {
          const outSeconds = Number(match[1]) / 1_000_000;
          const percent = Math.min(99, Math.max(0, Math.round((outSeconds / totalDurationSeconds) * 100)));
          onProgress(percent);
        }
      } catch {
        // arquivo pode nao existir ainda no primeiro instante - ignora
      }
    }, 1500);

    // 'error' e 'close' podem os dois disparar pro mesmo processo que falhou
    // ao dar spawn (ex: binario do ffmpeg sumiu/ficou corrompido) - sem a
    // guarda de "closed" aqui, o segundo handler tentava apagar um arquivo
    // que o primeiro ja tinha apagado (unlinkSync lancava ENOENT sem try/
    // catch) e derrubava o processo inteiro do video-worker, nao so esse
    // corte. fs.rm com force:true tambem nao lanca se o arquivo ja sumiu.
    child.on('error', (err) => {
      if (closed) return;
      closed = true;
      clearInterval(poll);
      fs.rm(progressFile, { force: true }, () => {});
      reject(err);
    });
    child.on('close', (code, signal) => {
      if (closed) return;
      closed = true;
      clearInterval(poll);
      fs.rm(progressFile, { force: true }, () => {});
      if (signal === 'SIGKILL') {
        return reject(new PausedError('Renderizacao interrompida pelo cliente.'));
      }
      if (code !== 0) {
        return reject(new Error(`ffmpeg saiu com codigo ${code}: ${stderr.slice(-800)}`));
      }
      resolve();
    });
  });
}

// Extrai so o audio, comprimido e mono - fica bem abaixo do limite de 25MB
// da API de transcricao mesmo em videos longos (~40-50min nesse bitrate).
async function extractAudio(videoPath, audioPath) {
  await runFfmpeg(['-i', videoPath, '-vn', '-ac', '1', '-ar', '16000', '-b:a', '64k', audioPath]);
  return audioPath;
}

// Duracao (em segundos) de um arquivo de video - usado pro upload direto
// (sem metadado do YouTube pra saber a duracao) e pro calculo de progresso.
function probeDuration(videoPath) {
  return new Promise((resolve, reject) => {
    const child = spawn(FFPROBE_PATH, [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      videoPath,
    ]);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => { stdout += c; });
    child.stderr.on('data', (c) => { stderr += c; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`ffprobe saiu com codigo ${code}: ${stderr.slice(-500)}`));
      const seconds = Number(stdout.trim());
      if (!Number.isFinite(seconds)) return reject(new Error('Nao foi possivel ler a duracao do video.'));
      resolve(seconds);
    });
  });
}

// Captura um frame do proprio corte pronto - usado como capa no preview (sem
// isso o player fica com tela em branco ate a pessoa dar play).
async function extractThumbnail(videoPath, outputPath, atSeconds = 0.5) {
  await runFfmpeg(['-ss', String(atSeconds), '-i', videoPath, '-frames:v', '1', '-q:v', '3', outputPath]);
  return outputPath;
}

function formatAssTimestamp(seconds) {
  const clamped = Math.max(0, seconds);
  const h = Math.floor(clamped / 3600);
  const m = Math.floor((clamped % 3600) / 60);
  const s = Math.floor(clamped % 60);
  const cs = Math.round((clamped - Math.floor(clamped)) * 100);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

// Gera um .ass com uma linha por palavra, ja com o tempo relativo ao inicio
// do corte (0 = comeco do clipe) - e isso que da o efeito "uma palavra de
// cada vez" na tela. Se tituloAteSegundos > 0, insere tambem uma linha fixa
// com o titulo do corte, visivel do inicio ate esse instante. partLabel
// (ex: "Parte 2"), quando informado, fica visivel o corte inteiro na
// posicao escolhida (ver PART_LABEL_ALIGNMENT).
function buildAssSubtitles(words, captionStyle, titleStyle, title, titleSeconds, partLabel, partLabelPosition, clipDuration) {
  const partAlignment = PART_LABEL_ALIGNMENT[partLabelPosition] || PART_LABEL_ALIGNMENT.top_right;
  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
${CAPTION_STYLES[captionStyle] || CAPTION_STYLES.classic}
${TITLE_STYLES[titleStyle] || TITLE_STYLES.classic}
Style: Part,Arial Black,56,&H00FFFFFF,&H000000FF,&H00000000,&H50000000,1,0,0,0,100,100,0,0,3,10,0,${partAlignment},50,50,50,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  const lines = words.map((w) => {
    const start = formatAssTimestamp(w.start);
    const end = formatAssTimestamp(w.end);
    const text = w.word.trim().replace(/[{}]/g, '');
    return `Dialogue: 0,${start},${end},Default,,0,0,0,,${text}`;
  });

  if (title && titleSeconds > 0) {
    const titleText = title.trim().replace(/[{}]/g, '');
    lines.unshift(`Dialogue: 1,0:00:00.00,${formatAssTimestamp(titleSeconds)},Title,,0,0,0,,${titleText}`);
  }

  if (partLabel) {
    lines.unshift(`Dialogue: 1,0:00:00.00,${formatAssTimestamp(clipDuration)},Part,,0,0,0,,${partLabel}`);
  }

  return header + lines.join('\n') + '\n';
}

// O filtro "subtitles" do ffmpeg trata ":" e "\" no caminho do arquivo como
// parte da sintaxe do filtro - precisa escapar.
function escapeForFilter(filePath) {
  return path.resolve(filePath).replace(/\\/g, '\\\\').replace(/:/g, '\\:');
}

// framing 'crop': corte central pra preencher o quadro (comportamento
// original, sem faixas). framing 'blur_pad': mostra o video inteiro (sem
// cortar nada) com fundo desfocado preenchendo o resto do quadro.
// cropZoomPercent (0-100), quando informado, ativa o enquadramento continuo
// do modo manual e ignora "framing" por completo: 100 = recorte apertado
// (identico ao framing='crop'), 0 = video original inteiro visivel
// (identico ao framing='blur_pad'), valores no meio interpolam a largura do
// recorte entre os dois extremos - sempre com o fundo desfocado preenchendo
// a sobra (que e zero quando zoom=100).
// Composicao sobre um template de fundo enviado pelo cliente (uma imagem 9:16
// com a arte dele: moldura, publicidade, marca). O video entra POR CIMA da
// imagem, com a altura e a posicao vertical que o cliente escolheu no editor.
//
// Duas entradas no ffmpeg: [0:v] e o video do corte, [1:v] e a imagem. A
// imagem e esticada pro tamanho final e o video e reduzido pra ocupar
// `heightPercent` da altura, centralizado horizontalmente e posicionado em
// `offsetPercent` da vertical (0 = colado no topo, 100 = colado na base).
function buildTemplateFilter({ w, h, subtitlesFilter, cropZoomPercent, heightPercent, offsetPercent }) {
  const alturaVideo = Math.round((h * Math.max(10, Math.min(100, heightPercent))) / 100);
  // O offset e medido sobre o espaco que sobra, entao 50% sempre centraliza,
  // independente da altura escolhida.
  const sobra = h - alturaVideo;
  const topo = Math.round((sobra * Math.max(0, Math.min(100, offsetPercent))) / 100);

  // O recorte lateral do video segue o mesmo zoom continuo do modo manual.
  const zoom = Math.max(0, Math.min(100, cropZoomPercent ?? 100)) / 100;
  const larguraCorte = `iw-(iw-ih*${w}/${alturaVideo})*${zoom}`;

  const chain = [
    `[1:v]scale=${w}:${h},setsar=1[fundo]`,
    `[0:v]crop=${larguraCorte}:ih,scale=${w}:${alturaVideo}:force_original_aspect_ratio=decrease,setsar=1[video]`,
    // A legenda entra DEPOIS da composicao, pra poder ser posicionada em
    // relacao ao quadro final e nao ao retangulo do video.
    `[fundo][video]overlay=(W-w)/2:${topo}${subtitlesFilter ? `,${subtitlesFilter}` : ''}[outv]`,
  ];
  return { filterComplex: chain.join(';'), outputLabel: '[outv]' };
}

function buildFilter({ framing, w, h, subtitlesFilter, cropZoomPercent, template }) {
  if (template && template.path) {
    return buildTemplateFilter({
      w,
      h,
      subtitlesFilter,
      cropZoomPercent,
      heightPercent: template.heightPercent,
      offsetPercent: template.offsetPercent,
    });
  }

  if (cropZoomPercent !== null && cropZoomPercent !== undefined) {
    const zoom = Math.max(0, Math.min(100, cropZoomPercent)) / 100;
    const cropWidthExpr = `iw-(iw-ih*${w}/${h})*${zoom}`;
    const chain = [
      `[0:v]split=2[bg][fg]`,
      `[bg]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},boxblur=18:4[bgblur]`,
      `[fg]crop=${cropWidthExpr}:ih,scale=${w}:${h}:force_original_aspect_ratio=decrease[fgscaled]`,
      `[bgblur][fgscaled]overlay=(W-w)/2:(H-h)/2,setsar=1${subtitlesFilter ? `,${subtitlesFilter}` : ''}[outv]`,
    ];
    return { filterComplex: chain.join(';'), outputLabel: '[outv]' };
  }

  if (framing === 'blur_pad') {
    const chain = [
      `[0:v]split=2[bg][fg]`,
      `[bg]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},boxblur=18:4[bgblur]`,
      `[fg]scale=${w}:${h}:force_original_aspect_ratio=decrease[fgscaled]`,
      `[bgblur][fgscaled]overlay=(W-w)/2:(H-h)/2,setsar=1${subtitlesFilter ? `,${subtitlesFilter}` : ''}[outv]`,
    ];
    return { filterComplex: chain.join(';'), outputLabel: '[outv]' };
  }

  const simple = `crop=ih*${w}/${h}:ih,scale=${w}:${h},setsar=1${subtitlesFilter ? `,${subtitlesFilter}` : ''}`;
  return { simpleFilter: simple };
}

// Corta [startSeconds, endSeconds] do video original, reenquadra, queima a
// legenda e (opcional) o titulo conforme as preferencias do cliente
// (settings) - as "words" ja devem vir filtradas pro intervalo do corte, com
// tempos ainda no eixo do video original. onProgress(percent) e chamado
// periodicamente durante a renderizacao.
async function renderClip({
  videoPath,
  startSeconds,
  endSeconds,
  words,
  title,
  outputPath,
  settings = {},
  onProgress,
  checkCancelled,
  partIndex,
  partTotal,
}) {
  const aspectRatio = settings.aspect_ratio || '9:16';
  const framing = settings.framing || 'crop';
  const quality = settings.quality || 'high';
  const captionStyle = settings.caption_style || 'classic';
  const titleStyle = settings.title_style || 'classic';
  const showTitle = settings.show_title !== false;
  const titleSeconds = showTitle ? Number(settings.title_seconds || 3) : 0;
  // So no modo manual o zoom continuo entra em jogo - no automatico o
  // comportamento continua exatamente o de sempre (framing crop/blur_pad).
  const cropZoomPercent = settings.crop_style_mode === 'manual' ? Number(settings.crop_zoom_percent ?? 100) : null;
  const partLabel = settings.show_part_label && partTotal > 1 ? `Parte ${partIndex}` : null;
  // Template de fundo: so vale se o arquivo ainda existir em disco. Se o
  // cliente apagou (ou a retencao limpou), renderiza sem template em vez de
  // derrubar o corte inteiro por causa de uma imagem faltando.
  const templatePath = settings.background_template_path;
  const template =
    templatePath && fs.existsSync(templatePath)
      ? {
          path: templatePath,
          heightPercent: Number(settings.background_video_height_percent ?? 100),
          offsetPercent: Number(settings.background_video_offset_percent ?? 50),
        }
      : null;
  if (templatePath && !template) {
    logger.warn(`Template de fundo nao encontrado em ${templatePath} - renderizando sem ele.`);
  }

  const { w, h } = ASPECT_RATIOS[aspectRatio] || ASPECT_RATIOS['9:16'];
  const { crf, preset } = QUALITY_PRESETS[quality] || QUALITY_PRESETS.high;

  const duration = endSeconds - startSeconds;
  const relativeWords = words
    .filter((word) => word.start >= startSeconds && word.end <= endSeconds)
    .map((word) => ({ word: word.word, start: word.start - startSeconds, end: word.end - startSeconds }));

  let assPath = null;
  let subtitlesFilter = null;
  if (captionStyle !== 'none' || titleSeconds > 0 || partLabel) {
    assPath = outputPath.replace(/\.mp4$/, '.ass');
    fs.writeFileSync(
      assPath,
      buildAssSubtitles(
        relativeWords,
        captionStyle,
        titleStyle,
        titleSeconds > 0 ? title : null,
        titleSeconds,
        partLabel,
        settings.part_label_position,
        duration
      )
    );
    subtitlesFilter = `subtitles=${escapeForFilter(assPath)}`;
  }

  const { simpleFilter, filterComplex, outputLabel } = buildFilter({ framing, w, h, subtitlesFilter, cropZoomPercent, template });

  try {
    const args = [
      '-ss', String(startSeconds),
      '-i', videoPath,
      '-t', String(duration),
      // Segunda entrada: a imagem do template (-loop 1 faz a imagem parada
      // durar o corte inteiro). Precisa vir depois do -i do video pra ser
      // [1:v] no filtro.
      ...(template ? ['-loop', '1', '-i', template.path] : []),
      ...(filterComplex
        ? ['-filter_complex', filterComplex, '-map', outputLabel, '-map', '0:a']
        : ['-vf', simpleFilter]),
      '-c:v', 'libx264',
      '-preset', preset,
      '-crf', String(crf),
      '-c:a', 'aac',
      '-b:a', '128k',
      outputPath,
    ];

    if (onProgress || checkCancelled) {
      await runFfmpegWithProgress(args, duration, onProgress || (() => {}), checkCancelled);
    } else {
      await runFfmpeg(args);
    }
  } finally {
    if (assPath) fs.unlinkSync(assPath);
  }

  return outputPath;
}

module.exports = {
  extractAudio,
  renderClip,
  extractThumbnail,
  probeDuration,
  ASPECT_RATIOS,
  QUALITY_PRESETS,
  CAPTION_STYLES,
  TITLE_STYLES,
};
