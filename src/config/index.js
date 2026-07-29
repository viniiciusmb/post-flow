// Carrega e valida as variaveis de ambiente uma unica vez, em um lugar so.
// Qualquer outro arquivo do projeto deve importar config daqui em vez de
// ler process.env diretamente.
'use strict';

require('dotenv').config();

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Variavel de ambiente obrigatoria ausente: ${name}. Confira seu arquivo .env.`);
  }
  return value;
}

const config = {
  env: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 3000),
  isProduction: process.env.NODE_ENV === 'production',

  databaseUrl: required('DATABASE_URL'),
  sessionSecret: required('SESSION_SECRET'),
  encryptionKey: required('APP_ENCRYPTION_KEY'),

  tiktok: {
    clientKey: process.env.TIKTOK_CLIENT_KEY || '',
    clientSecret: process.env.TIKTOK_CLIENT_SECRET || '',
    redirectUri: process.env.TIKTOK_REDIRECT_URI || '',
  },

  google: {
    clientId: process.env.GOOGLE_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    redirectUri: process.env.GOOGLE_REDIRECT_URI || '',
  },

  openai: {
    apiKey: process.env.OPENAI_API_KEY || '',
  },

  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY || '',
  },

  youtube: {
    // Conteudo do cookies.txt (exportado de uma conta logada) em base64.
    // Sem isso o YouTube bloqueia listagem/download vindos da VPS.
    cookiesBase64: process.env.YOUTUBE_COOKIES_BASE64 || '',
    // URL do servico bgutil-ytdlp-pot-provider (gera o "PO token" que o
    // YouTube passou a exigir mesmo com cookie valido, pra IP de servidor).
    // Vazio = roda sem POT provider (cookie sozinho pode nao bastar mais).
    potProviderUrl: process.env.YTDLP_POT_PROVIDER_URL || '',
    // Proxy residencial pago (ex: http://usuario:senha@host:porta) - resolve
    // de vez o bloqueio "Sign in to confirm you're not a bot" que a VPS toma
    // por ser IP de datacenter, independente de cookie/token. Usado como
    // reserva quando o rele Tailscale (abaixo) nao esta disponivel.
    proxyUrl: process.env.YTDLP_PROXY_URL || '',
    // Rele Tailscale (SOCKS5, ex: socks5://postflow-tailscale:1080) - mesma
    // ideia do proxy pago, mas de graca: sai pela internet de um aparelho
    // (do admin ou de um cliente) que autorizou ser usado como saida. Tem
    // prioridade sobre o proxy pago quando configurado.
    tailscaleProxyUrl: process.env.YTDLP_TAILSCALE_PROXY_URL || '',
  },

  ytdlpPath: process.env.YTDLP_PATH || '/usr/local/bin/yt-dlp',

  videoProcessing: {
    // Onde os videos baixados e os cortes ficam em disco antes de postar.
    workDir: process.env.VIDEO_WORK_DIR || '/tmp/post-flow-video',
  },
};

module.exports = config;
