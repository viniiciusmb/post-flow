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
    // reserva quando o tunel SSH (abaixo) nao esta disponivel.
    proxyUrl: process.env.YTDLP_PROXY_URL || '',
    // Espera aleatoria antes de cada download de verdade (ver
    // waitBeforeDownload). Configuravel porque e um numero de comportamento,
    // nao uma constante da natureza - e porque teste automatizado nao pode
    // ficar 40s parado esperando um disfarce anti-bloqueio.
    downloadWaitMinMs: Number(process.env.YTDLP_WAIT_MIN_MS ?? 10_000),
    downloadWaitMaxMs: Number(process.env.YTDLP_WAIT_MAX_MS ?? 40_000),
    // Rele SOCKS5 generico opcional (ex: um proxy externo qualquer) - so
    // entra como candidato se essa variavel for configurada; hoje nao esta
    // configurada em producao, o tunel SSH por cliente/founder (abaixo) e
    // usado no lugar.
    tailscaleProxyUrl: process.env.YTDLP_TAILSCALE_PROXY_URL || '',
  },

  ytdlpPath: process.env.YTDLP_PATH || '/usr/local/bin/yt-dlp',

  // Tunel SSH reverso por cliente (docker/ssh-relay/) - substitui a ideia
  // (nunca implantada) de usar Tailscale por cliente. relayControlUrl e
  // interno (backend fala com o control-server
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

  // Sistema de creditos/assinatura. Vazio ate o usuario mandar as chaves de
  // verdade - stripeService checa isso e recusa com mensagem clara em vez de
  // deixar o SDK explodir. Sem required() de proposito: a ausencia dessas
  // variaveis nao pode travar o boot do servidor, so deixa a integracao com
  // a Stripe indisponivel ate configurar.
  // Codigo de verificacao de propriedade do dominio no Google Search Console.
  // Fica em variavel de ambiente (nao no codigo) porque e um valor de conta, e
  // porque assim da pra trocar sem esperar um deploy de codigo.
  googleSiteVerification: process.env.GOOGLE_SITE_VERIFICATION || '',

  // Envio de e-mail transacional (recuperacao de senha). Sem a chave, o
  // sistema continua funcionando normalmente e so a recuperacao de senha fica
  // indisponivel - emailService recusa com mensagem clara em vez de explodir.
  resend: {
    apiKey: process.env.RESEND_API_KEY || '',
  },

  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY || '',
    publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || '',
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
  },

  // Asaas: assinatura mensal e compra de credito avulso (PIX e cartao).
  // A cobranca automatica de excedente continua na Stripe por enquanto -
  // depende da tokenizacao de cartao, que so o gerente da conta Asaas libera.
  asaas: {
    apiKey: process.env.ASAAS_API_KEY || '',

    // O ambiente NAO e adivinhado a partir do prefixo da chave. Chave de
    // sandbox comeca com "$aact_hmlg_" e a de producao com "$aact_prod_",
    // mas deduzir isso significaria que uma chave colada errada faria o
    // sistema apontar sozinho pro ambiente errado - no pior caso, cobrando
    // dinheiro de verdade achando que era teste. Aqui o ambiente e uma
    // escolha explicita, e validateAsaasConfig() recusa a combinacao errada.
    environment: process.env.ASAAS_ENVIRONMENT || 'sandbox',

    // Token que o Asaas manda de volta no cabecalho asaas-access-token de
    // cada webhook. E o unico jeito de saber que a chamada veio mesmo deles:
    // o endereco do webhook e publico, entao sem isso qualquer um poderia
    // avisar "pagamento recebido" e ganhar credito de graca.
    webhookToken: process.env.ASAAS_WEBHOOK_TOKEN || '',

    // Redireciona as chamadas pra outro endereco. Existe pros testes
    // apontarem pra um Asaas de mentira levantado na propria maquina.
    //
    // So vale pra localhost, de proposito: sem essa trava, uma variavel de
    // ambiente errada (ou mexida por alguem) mandaria pagamento de verdade
    // pro servidor de outra pessoa, e tudo pareceria funcionar. Ver baseUrl()
    // em asaasService.js.
    baseUrlOverride: process.env.ASAAS_BASE_URL || '',
  },
};

// Chave de sandbox apontando pra producao (ou o contrario) e o erro que faz
// "nada funciona" parecer bug de codigo: o Asaas simplesmente responde 401 e
// os dois mundos sao completamente separados (cliente criado num nao existe
// no outro). Conferir no boot custa nada e evita horas de investigacao.
const PREFIXO_POR_AMBIENTE = { sandbox: '$aact_hmlg_', production: '$aact_prod_' };

function validateAsaasConfig() {
  const { apiKey, environment } = config.asaas;
  if (!apiKey) return { ok: true, motivo: 'Asaas nao configurado (sem ASAAS_API_KEY).' };

  if (!PREFIXO_POR_AMBIENTE[environment]) {
    return { ok: false, motivo: `ASAAS_ENVIRONMENT invalido: "${environment}". Use "sandbox" ou "production".` };
  }
  const esperado = PREFIXO_POR_AMBIENTE[environment];
  if (!apiKey.startsWith(esperado)) {
    const outro = environment === 'sandbox' ? 'production' : 'sandbox';
    return {
      ok: false,
      motivo:
        `A chave do Asaas nao combina com ASAAS_ENVIRONMENT="${environment}" ` +
        `(esperava uma chave comecando com "${esperado}"). Parece uma chave de ${outro}.`,
    };
  }
  return { ok: true };
}

config.validateAsaasConfig = validateAsaasConfig;

module.exports = config;
