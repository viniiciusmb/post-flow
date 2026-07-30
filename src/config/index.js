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
    // que autorizou ser usado como saida. Feature pausada (2026-07-30,
    // aguardando decisao de custo do plano pago do Tailscale por cliente
    // convidado) - variavel existe mas nao esta configurada em producao.
    tailscaleProxyUrl: process.env.YTDLP_TAILSCALE_PROXY_URL || '',
  },

  ytdlpPath: process.env.YTDLP_PATH || '/usr/local/bin/yt-dlp',

  // Reservado pro rele Tailscale por cliente (docker/tailscale-relay/) -
  // construido mas nao ligado a nada ainda, feature pausada (ver comentario
  // acima) ate decisao de custo do plano pago do Tailscale.
  tailscale: {
    relayUrl: process.env.TAILSCALE_RELAY_URL || '',
  },

  // Tunel SSH reverso por cliente (docker/ssh-relay/) - substitui a ideia do
  // Tailscale. relayControlUrl e interno (backend fala com o control-server
  // do sidecar pra autorizar/revogar chaves); relaySocksHost e o hostname
  // Docker que o video-worker usa pra montar a URL do proxy SOCKS5
  // (socks5://<relaySocksHost>:<porta-do-tunel>); relayPublicHost/Port sao o
  // que o programa do cliente/founder usa no comando `ssh -R` de fora,
  // batendo na porta TCP publicada desse servico no EasyPanel (nao a porta
  // 22 real da VPS, que continua so pro SSH de administracao).
  tunnel: {
    relayControlUrl: process.env.TUNNEL_RELAY_CONTROL_URL || '',
    relaySocksHost: process.env.TUNNEL_RELAY_SOCKS_HOST || '',
    relayPublicHost: process.env.TUNNEL_RELAY_PUBLIC_HOST || '',
    relayPublicPort: process.env.TUNNEL_RELAY_PUBLIC_PORT || '2222',
  },

  videoProcessing: {
    // Onde os videos baixados e os cortes ficam em disco antes de postar.
    workDir: process.env.VIDEO_WORK_DIR || '/tmp/post-flow-video',
  },
};

module.exports = config;
