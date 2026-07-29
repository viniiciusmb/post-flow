// Listagem e download de videos via yt-dlp. O YouTube bloqueia esse tipo de
// acesso vindo de IP de VPS sem um cookie de conta logada - por isso o
// cookies.txt (settings YOUTUBE_COOKIES_BASE64) e obrigatorio pra esse
// modulo funcionar. Ver docs/setup-youtube-cookies.md.
'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const config = require('../config');

let cookiesFilePathCache = null;

function getCookiesFilePath() {
  if (cookiesFilePathCache) return cookiesFilePathCache;
  if (!config.youtube.cookiesBase64) return null;

  const filePath = path.join(os.tmpdir(), 'post-flow-youtube-cookies.txt');
  fs.writeFileSync(filePath, Buffer.from(config.youtube.cookiesBase64, 'base64'));
  cookiesFilePathCache = filePath;
  return filePath;
}

function run(args, { timeoutMs = 5 * 60 * 1000 } = {}) {
  return new Promise((resolve, reject) => {
    const cookies = getCookiesFilePath();
    if (!cookies) {
      return reject(new Error('YOUTUBE_COOKIES_BASE64 nao configurado - sem isso o YouTube bloqueia a VPS.'));
    }

    const child = spawn(config.ytdlpPath, ['--cookies', cookies, ...args]);
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`yt-dlp excedeu o tempo limite (${timeoutMs / 1000}s).`));
    }, timeoutMs);

    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (err) => { clearTimeout(timer); reject(err); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        return reject(new Error(`yt-dlp saiu com codigo ${code}: ${stderr.slice(-800)}`));
      }
      resolve(stdout);
    });
  });
}

function parseUploadDate(value) {
  if (!value || value.length !== 8) return null;
  return new Date(`${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`);
}

// Lista os videos recentes de um canal (modo "flat" - rapido, sem baixar nada).
async function listChannelVideos(channelUrl, { limit = 15 } = {}) {
  const stdout = await run([
    '--flat-playlist',
    '--dump-json',
    '--playlist-end', String(limit),
    '--no-warnings',
    `${channelUrl.replace(/\/$/, '')}/videos`,
  ]);

  return stdout
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .map((entry) => ({
      videoId: entry.id,
      title: entry.title,
      thumbnailUrl: entry.thumbnails?.at(-1)?.url || null,
      publishedAt: parseUploadDate(entry.upload_date),
      durationSeconds: entry.duration || null,
    }));
}

// Aceita watch?v=, youtu.be/, /shorts/ - o que o cliente for colar.
function extractVideoId(url) {
  const match = String(url || '').match(/(?:v=|youtu\.be\/|\/shorts\/)([a-zA-Z0-9_-]{11})/);
  return match ? match[1] : null;
}

// Busca so os metadados de um video avulso (sem baixar) - usado quando o
// cliente cola o link manualmente em vez de vir da checagem de um canal.
async function getVideoMetadata(url) {
  const stdout = await run(['--dump-json', '--no-warnings', '--no-playlist', '--skip-download', url]);
  const entry = JSON.parse(stdout.trim().split('\n')[0]);
  return {
    videoId: entry.id,
    title: entry.title,
    thumbnailUrl: entry.thumbnails?.at(-1)?.url || null,
    publishedAt: parseUploadDate(entry.upload_date),
    durationSeconds: entry.duration || null,
  };
}

// Baixa video+audio pro disco (mp4, ate 1080p) e devolve o caminho do arquivo.
async function downloadVideo(videoId, outputDir) {
  fs.mkdirSync(outputDir, { recursive: true });
  const outputTemplate = path.join(outputDir, '%(id)s.%(ext)s');

  await run(
    [
      '-f', 'bestvideo[height<=1080]+bestaudio/best[height<=1080]',
      '--merge-output-format', 'mp4',
      '--no-warnings',
      '-o', outputTemplate,
      `https://www.youtube.com/watch?v=${videoId}`,
    ],
    { timeoutMs: 20 * 60 * 1000 }
  );

  const filePath = path.join(outputDir, `${videoId}.mp4`);
  if (!fs.existsSync(filePath)) {
    throw new Error('Download concluido mas o arquivo esperado nao foi encontrado em disco.');
  }
  return filePath;
}

module.exports = { listChannelVideos, downloadVideo, extractVideoId, getVideoMetadata };
