// Edicao de video via ffmpeg: extrair audio (pra mandar pro Whisper),
// cortar um trecho, reenquadrar de horizontal pra vertical (9:16, corte
// central por enquanto) e queimar legenda estilo TikTok (palavra por
// palavra), tudo numa passada so.
'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const FFMPEG_PATH = process.env.FFMPEG_PATH || 'ffmpeg';

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
function buildAssSubtitles(words) {
  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial Black,96,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,1,0,0,0,100,100,0,0,1,7,0,2,80,80,260,1

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

// Corta [startSeconds, endSeconds] do video original, reenquadra pra 9:16
// (corte central) e queima a legenda - as "words" ja devem vir filtradas
// pro intervalo do corte, com tempos ainda no eixo do video original.
async function renderClip({ videoPath, startSeconds, endSeconds, words, outputPath }) {
  const duration = endSeconds - startSeconds;
  const relativeWords = words
    .filter((w) => w.start >= startSeconds && w.end <= endSeconds)
    .map((w) => ({ word: w.word, start: w.start - startSeconds, end: w.end - startSeconds }));

  const assPath = outputPath.replace(/\.mp4$/, '.ass');
  fs.writeFileSync(assPath, buildAssSubtitles(relativeWords));

  const filter = `crop=ih*9/16:ih,scale=1080:1920,setsar=1,subtitles=${escapeForFilter(assPath)}`;

  try {
    await runFfmpeg([
      '-ss', String(startSeconds),
      '-i', videoPath,
      '-t', String(duration),
      '-vf', filter,
      '-c:v', 'libx264',
      '-preset', 'medium',
      '-crf', '23',
      '-c:a', 'aac',
      '-b:a', '128k',
      outputPath,
    ]);
  } finally {
    fs.unlinkSync(assPath);
  }

  return outputPath;
}

// O filtro "subtitles" do ffmpeg trata ":" e "\" no caminho do arquivo como
// parte da sintaxe do filtro - precisa escapar.
function escapeForFilter(filePath) {
  return path.resolve(filePath).replace(/\\/g, '\\\\').replace(/:/g, '\\:');
}

module.exports = { extractAudio, renderClip };
