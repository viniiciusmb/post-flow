// Edicao de video via ffmpeg: extrair audio (pra mandar pro Whisper),
// cortar um trecho, reenquadrar (proporcao/enquadramento configuraveis por
// cliente) e queimar legenda estilo TikTok (palavra por palavra), tudo numa
// passada so.
'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const FFMPEG_PATH = process.env.FFMPEG_PATH || 'ffmpeg';

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
const CAPTION_STYLES = {
  classic: 'Style: Default,Arial Black,96,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,1,0,0,0,100,100,0,0,1,7,0,2,80,80,260,1',
  bold: 'Style: Default,Arial Black,112,&H0000D7FF,&H000000FF,&H00000000,&H00000000,1,0,0,0,100,100,0,0,1,9,0,2,60,60,300,1',
  minimal: 'Style: Default,Arial,64,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,3,0,2,100,100,140,1',
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

// Extrai so o audio, comprimido e mono - fica bem abaixo do limite de 25MB
// da API de transcricao mesmo em videos longos (~40-50min nesse bitrate).
async function extractAudio(videoPath, audioPath) {
  await runFfmpeg(['-i', videoPath, '-vn', '-ac', '1', '-ar', '16000', '-b:a', '64k', audioPath]);
  return audioPath;
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
// cada vez" na tela.
function buildAssSubtitles(words, captionStyle) {
  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
${CAPTION_STYLES[captionStyle] || CAPTION_STYLES.classic}

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  const lines = words.map((w) => {
    const start = formatAssTimestamp(w.start);
    const end = formatAssTimestamp(w.end);
    const text = w.word.trim().replace(/[{}]/g, '');
    return `Dialogue: 0,${start},${end},Default,,0,0,0,,${text}`;
  });

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
function buildFilter({ framing, w, h, subtitlesFilter }) {
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

// Corta [startSeconds, endSeconds] do video original, reenquadra e queima a
// legenda conforme as preferencias do cliente (settings) - as "words" ja
// devem vir filtradas pro intervalo do corte, com tempos ainda no eixo do
// video original.
async function renderClip({ videoPath, startSeconds, endSeconds, words, outputPath, settings = {} }) {
  const aspectRatio = settings.aspect_ratio || '9:16';
  const framing = settings.framing || 'crop';
  const quality = settings.quality || 'high';
  const captionStyle = settings.caption_style || 'classic';

  const { w, h } = ASPECT_RATIOS[aspectRatio] || ASPECT_RATIOS['9:16'];
  const { crf, preset } = QUALITY_PRESETS[quality] || QUALITY_PRESETS.high;

  const duration = endSeconds - startSeconds;
  const relativeWords = words
    .filter((word) => word.start >= startSeconds && word.end <= endSeconds)
    .map((word) => ({ word: word.word, start: word.start - startSeconds, end: word.end - startSeconds }));

  let assPath = null;
  let subtitlesFilter = null;
  if (captionStyle !== 'none') {
    assPath = outputPath.replace(/\.mp4$/, '.ass');
    fs.writeFileSync(assPath, buildAssSubtitles(relativeWords, captionStyle));
    subtitlesFilter = `subtitles=${escapeForFilter(assPath)}`;
  }

  const { simpleFilter, filterComplex, outputLabel } = buildFilter({ framing, w, h, subtitlesFilter });

  try {
    await runFfmpeg([
      '-ss', String(startSeconds),
      '-i', videoPath,
      '-t', String(duration),
      ...(filterComplex
        ? ['-filter_complex', filterComplex, '-map', outputLabel, '-map', '0:a']
        : ['-vf', simpleFilter]),
      '-c:v', 'libx264',
      '-preset', preset,
      '-crf', String(crf),
      '-c:a', 'aac',
      '-b:a', '128k',
      outputPath,
    ]);
  } finally {
    if (assPath) fs.unlinkSync(assPath);
  }

  return outputPath;
}

module.exports = { extractAudio, renderClip, ASPECT_RATIOS, QUALITY_PRESETS, CAPTION_STYLES };
