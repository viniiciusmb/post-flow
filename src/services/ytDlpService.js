// Listagem e download de videos via yt-dlp.
//
// O YouTube bloqueia IP de servidor por padrao ("Sign in to confirm you're
// not a bot"). Testado manualmente (ver commits) contra videos reais:
//   - So o provedor de PO token (bgutil-ytdlp-pot-provider) sem proxy: passa
//     pra videos "de alta confianca" (muito populares), mas continua
//     bloqueando video comum de canal pequeno/medio.
//   - Um proxy residencial pago (YTDLP_PROXY_URL) resolve pra qualquer video.
//   - O rele Tailscale (YTDLP_TAILSCALE_PROXY_URL) resolve igual, de graca,
//     saindo pela internet de um aparelho autorizado (do admin ou de um
//     cliente) em vez de pagar por banda - so funciona quando esse aparelho
//     esta ligado/conectado, por isso e tentado primeiro e cai pro proxy
//     pago se estiver indisponivel.
// Cookie (YOUTUBE_COOKIES_BASE64) e contraproducente com qualquer proxy: ele
// forca o yt-dlp a tentar os clientes "web", que o YouTube trava via
// streaming SABR (so devolve storyboard, nenhum formato de video real). So
// usamos cookie como ultimo recurso quando nenhum proxy/POT esta configurado.
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

// Rele Tailscale primeiro (de graca, quando o aparelho autorizado esta
// online), proxy pago como reserva. Se nenhum dos dois estiver configurado,
// tenta so o POT provider; sem nada disso, cai pro cookie.
function getProxyCandidates() {
  return [config.youtube.tailscaleProxyUrl, config.youtube.proxyUrl].filter(Boolean);
}

function runOnce(args, { timeoutMs = 5 * 60 * 1000, proxyUrl = null } = {}) {
  return new Promise((resolve, reject) => {
    const hasProxyOrPot = Boolean(proxyUrl || config.youtube.potProviderUrl);
    const authArgs = [];

    if (proxyUrl) {
      authArgs.push('--proxy', proxyUrl);
    }
    if (config.youtube.potProviderUrl) {
      authArgs.push('--extractor-args', `youtubepot-bgutilhttp:base_url=${config.youtube.potProviderUrl}`);
    }

    if (!hasProxyOrPot) {
      const cookies = getCookiesFilePath();
      if (!cookies) {
        return reject(
          new Error(
            'Nenhum proxy (Tailscale/pago), POT provider nem cookie configurados - sem isso o YouTube bloqueia a VPS.'
          )
        );
      }
      authArgs.push('--cookies', cookies);
    }

    const child = spawn(config.ytdlpPath, [...authArgs, ...args]);
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

// Tenta cada proxy candidato em ordem (Tailscale de graca antes do pago); se
// todos falharem (ex: link expirado, 403 pontual), tenta a rodada inteira
// de novo uma vez antes de desistir.
async function run(args, opts) {
  const candidates = getProxyCandidates();
  const proxiesToTry = candidates.length ? candidates : [null];

  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    for (const proxyUrl of proxiesToTry) {
      try {
        return await runOnce(args, { ...opts, proxyUrl });
      } catch (err) {
        lastErr = err;
      }
    }
  }
  throw lastErr;
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

// Baixa video+audio pro disco (mp4, ate 720p) e devolve o caminho do arquivo.
// 720p (nao 1080p) de proposito: o corte final e um recorte vertical bem
// mais estreito que a largura do video original, entao 1080p de origem nao
// da nitidez extra perceptivel no resultado - so custa ~2.5x mais banda
// (importa de verdade com proxy residencial, que e cobrado por GB).
async function downloadVideo(videoId, outputDir) {
  fs.mkdirSync(outputDir, { recursive: true });
  const outputTemplate = path.join(outputDir, '%(id)s.%(ext)s');

  await run(
    [
      '-f', 'bestvideo[height<=720]+bestaudio/best[height<=720]',
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
