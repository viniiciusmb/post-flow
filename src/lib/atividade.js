// Nomes e regras do registro de atividade (ver middleware/registroDeAtividade
// e migration 114).
//
// O registro guarda a ROTA, nunca o conteúdo. Esta lista transforma a rota em
// algo que se lê de relance no painel do admin ("Conectou o Instagram",
// "Mandou cortar o vídeo"). Rota nova sem nome continua sendo registrada - cai
// no nome genérico da área -, então esquecer de pôr um nome aqui nunca faz uma
// ação sumir do monitoramento.
'use strict';

// Rotas que NÃO entram: disparam sozinhas o tempo todo (o feed marca "visto"
// a cada corte que passa; a tela manda o próprio erro de JavaScript, que já
// vai pro painel de erros) ou não têm usuário (webhooks, programa do túnel).
const IGNORAR = [
  /^\/api\/client\/feed\/vistos$/,
  /^\/api\/client\/erros-de-tela/,
  /^\/api\/(asaas|stripe)\/webhook/,
  /^\/api\/tunnel\//,
];

// Rotas GET que são AÇÕES, não páginas: a volta da autorização do TikTok, do
// Google e das redes sociais. O resultado vem no endereço pra onde ela manda
// a pessoa de volta (erro=..., tiktok_error=...).
const VOLTAS_DE_CONEXAO = [/^\/auth\/tiktok\/callback$/, /^\/auth\/google\/callback$/, /^\/client\/social\/retorno\/[a-z]+$/];

// /api/client/source-videos/123/enqueue -> /api/client/source-videos/:id/enqueue
// Também troca segmento comprido de letras e números (token, código) por
// :token: nunca guardar algo que funcione como senha.
function normalizarRota(caminho) {
  return String(caminho || '/')
    .split('?')[0]
    .split('/')
    .map((s) => (/^\d+$/.test(s) ? ':id' : /^[A-Za-z0-9_-]{24,}$/.test(s) ? ':token' : s))
    .join('/')
    .replace(/\/$/, '') || '/';
}

function primeiroId(caminho) {
  const m = /\/(\d{1,15})(?=\/|$|\?)/.exec(String(caminho || ''));
  return m ? Number(m[1]) : null;
}

function ignorada(rota) {
  return IGNORAR.some((r) => r.test(rota));
}

function ehVoltaDeConexao(rota) {
  return VOLTAS_DE_CONEXAO.some((r) => r.test(rota));
}

// Área de cada rota, do prefixo mais específico pro mais geral.
const AREAS = [
  ['/api/client/youtube-channels', 'Canais do YouTube'],
  ['/api/client/source-videos', 'Vídeos e cortes'],
  ['/api/client/video-settings', 'Estilo do corte'],
  ['/api/client/postings', 'TikTok'],
  ['/api/client/tiktok-accounts', 'TikTok'],
  ['/api/client/social-accounts', 'Redes sociais'],
  ['/api/client/social-postings', 'Redes sociais'],
  ['/api/client/lives', 'Lives'],
  ['/api/client/feed', 'Feed de cortes'],
  ['/api/client/billing', 'Plano e pagamento'],
  ['/api/client/checkout', 'Plano e pagamento'],
  ['/api/client/commissions', 'Comissões'],
  ['/api/client/drive', 'Google Drive'],
  ['/api/client/support', 'Flora'],
  ['/api/client/tunnel', 'Túnel'],
  ['/api/client/notices', 'Avisos'],
  ['/api/client/conta', 'Conta'],
  ['/api/client', 'Conta'],
  ['/api/admin', 'Admin'],
  ['/api/auth', 'Acesso'],
  ['/auth/tiktok', 'TikTok'],
  ['/auth/google', 'Google'],
  ['/client/social/retorno', 'Redes sociais'],
  ['/login', 'Acesso'],
  ['/register', 'Acesso'],
  ['/logout', 'Acesso'],
  ['/client', 'Páginas'],
  ['/admin', 'Páginas'],
];

function areaDe(rota) {
  const a = AREAS.find(([p]) => rota === p || rota.startsWith(`${p}/`));
  return a ? a[1] : 'Outros';
}

// A rota chega já normalizada (números viram ':id'), então ':id' casa literal.
const R = (m, padrao, nome) => [m, new RegExp(`^${padrao.replace(/:x/g, '[^/]+')}$`), nome];

// [método, padrão da rota já normalizada, nome]. ':x' = qualquer segmento.
const ROTULOS = [
  // Acesso
  R('POST', '/login', 'Entrou no painel'),
  R('POST', '/api/auth/login', 'Entrou no painel'),
  R('POST', '/register', 'Criou a conta'),
  R('POST', '/logout', 'Saiu do painel'),
  R('POST', '/api/auth/logout', 'Saiu do painel'),
  R('POST', '/api/auth/forgot-password', 'Pediu pra recuperar a senha'),
  R('POST', '/api/auth/reset-password', 'Trocou a senha pelo link'),
  R('GET', '/auth/google/callback', 'Voltou do login com o Google'),
  // Canais do YouTube
  R('POST', '/api/client/youtube-channels', 'Adicionou canal do YouTube'),
  R('DELETE', '/api/client/youtube-channels/:id', 'Removeu canal do YouTube'),
  R('POST', '/api/client/youtube-channels/:id/active', 'Ligou/desligou o monitoramento do canal'),
  R('POST', '/api/client/youtube-channels/:id/process-latest-video', 'Mandou cortar o último vídeo do canal'),
  R('POST', '/api/client/youtube-channels/:id/tiktok-account', 'Ligou o canal a uma conta do TikTok'),
  R('POST', '/api/client/youtube-channels/:id/queue-gate', 'Mudou o freio de fila do canal'),
  R('POST', '/api/client/youtube-channels/:id/export-folder', 'Configurou a pasta do Drive do canal'),
  R('POST', '/api/client/youtube-channels/:id/drive-export-mode', 'Mudou o envio pro Drive do canal'),
  R('PUT', '/api/client/youtube-channels/:id/audio-language', 'Mudou o idioma do áudio do canal'),
  R('PUT', '/api/client/youtube-channels/:id/max-video-minutes', 'Mudou o limite de duração do canal'),
  // Vídeos e cortes
  R('POST', '/api/client/source-videos/manual/preview', 'Colou um link de vídeo'),
  R('POST', '/api/client/source-videos/manual', 'Enviou vídeo por link'),
  R('POST', '/api/client/source-videos/upload', 'Enviou vídeo do computador'),
  R('POST', '/api/client/source-videos/:id/enqueue', 'Mandou processar um vídeo'),
  R('POST', '/api/client/source-videos/:id/retry', 'Tentou processar de novo'),
  R('POST', '/api/client/source-videos/:id/pause', 'Pausou um vídeo'),
  R('POST', '/api/client/source-videos/:id/resume', 'Retomou um vídeo'),
  R('DELETE', '/api/client/source-videos/:id', 'Apagou um vídeo'),
  R('POST', '/api/client/source-videos/bulk-delete', 'Apagou vídeos em lote'),
  R('POST', '/api/client/source-videos/:id/enqueue-clips', 'Mandou os cortes pra fila'),
  R('POST', '/api/client/source-videos/clips/:id/enqueue', 'Mandou um corte pra fila'),
  R('POST', '/api/client/source-videos/:id/export-all-to-drive', 'Exportou os cortes pro Drive'),
  R('POST', '/api/client/source-videos/clips/:id/export-to-drive', 'Exportou um corte pro Drive'),
  // Estilo
  R('PUT', '/api/client/video-settings', 'Salvou o estilo do corte'),
  R('POST', '/api/client/video-settings/modelos', 'Salvou um modelo de estilo'),
  R('POST', '/api/client/video-settings/modelos/aplicar', 'Aplicou um modelo de estilo'),
  R('POST', '/api/client/video-settings/background-template', 'Enviou imagem de fundo'),
  // TikTok
  R('GET', '/auth/tiktok/callback', 'Conectou o TikTok'),
  R('POST', '/api/client/tiktok-accounts/:id/deactivate', 'Desconectou uma conta do TikTok'),
  R('PUT', '/api/client/tiktok-accounts/:id/schedule', 'Mudou os horários do TikTok'),
  R('PUT', '/api/client/tiktok-accounts/:id/auto-post', 'Ligou/desligou postar sozinho no TikTok'),
  R('PUT', '/api/client/tiktok-accounts/:id/queue-pause', 'Pausou/retomou a fila do TikTok'),
  R('PUT', '/api/client/tiktok-accounts/:id/publish-mode', 'Mudou o modo de publicação do TikTok'),
  R('PUT', '/api/client/tiktok-accounts/:id/publish-defaults', 'Escolheu as opções de publicação do TikTok'),
  R('PUT', '/api/client/tiktok-accounts/:id/queue-order', 'Reordenou a fila do TikTok'),
  R('POST', '/api/client/postings/:id/post-now', 'Postar agora no TikTok'),
  R('POST', '/api/client/postings/:id/skip', 'Cancelou uma postagem do TikTok'),
  R('POST', '/api/client/postings/:id/retry', 'Tentou postar de novo no TikTok'),
  R('PUT', '/api/client/postings/:id/caption', 'Editou a legenda do TikTok'),
  R('POST', '/api/client/postings/enfileirar-prontos', 'Pôs cortes prontos na fila do TikTok'),
  R('POST', '/api/client/postings/reenfileirar-cancelados', 'Devolveu cancelados pra fila do TikTok'),
  // Redes sociais
  R('POST', '/api/client/social-accounts/:x/conectar', 'Começou a conectar uma rede social'),
  R('GET', '/client/social/retorno/:x', 'Voltou da conexão da rede social'),
  R('POST', '/api/client/social-accounts/pendente', 'Escolheu as páginas da rede social'),
  R('DELETE', '/api/client/social-accounts/:id', 'Desconectou uma rede social'),
  R('POST', '/api/client/social-accounts/:id/testar', 'Testou a conexão da rede social'),
  R('PUT', '/api/client/social-accounts/:id/horarios', 'Mudou os horários da rede social'),
  R('PUT', '/api/client/social-accounts/:id/auto-post', 'Ligou/desligou publicar sozinho na rede'),
  R('PUT', '/api/client/social-accounts/:id/pausa', 'Pausou/retomou a fila da rede'),
  R('PUT', '/api/client/social-accounts/:id/opcoes', 'Mudou as opções da rede social'),
  R('PUT', '/api/client/social-accounts/:id/ordem', 'Reordenou a fila da rede'),
  R('PUT', '/api/client/social-accounts/canais/:id', 'Escolheu as redes de um canal'),
  R('POST', '/api/client/social-accounts/aplicar-em-todas', 'Usou os horários em todas as contas'),
  R('POST', '/api/client/social-postings/:id/postar-agora', 'Postar agora na rede social'),
  R('POST', '/api/client/social-postings/:id/cancelar', 'Cancelou uma postagem na rede'),
  R('POST', '/api/client/social-postings/:id/tentar-de-novo', 'Tentou postar de novo na rede'),
  R('PUT', '/api/client/social-postings/:id/legenda', 'Editou a legenda na rede'),
  // Lives
  R('POST', '/api/client/lives/canais', 'Adicionou canal de live'),
  R('DELETE', '/api/client/lives/canais/:id', 'Removeu canal de live'),
  R('PUT', '/api/client/lives/canais/:id/automatico', 'Ligou/desligou clipar sempre'),
  R('POST', '/api/client/lives/canais/:id/clipar-esta-live', 'Clipar esta live'),
  R('DELETE', '/api/client/lives/canais/:id/clipar-esta-live', 'Parou de clipar a live'),
  R('POST', '/api/client/lives/canais/:id/clipar-agora', 'Clipar este momento'),
  R('PUT', '/api/client/lives/opcoes', 'Mudou os ajustes dos cortes de live'),
  R('PUT', '/api/client/lives/estilo', 'Mudou o estilo dos cortes de live'),
  R('DELETE', '/api/client/lives/cortes/:id', 'Apagou um corte de live'),
  // Feed
  R('PUT', '/api/client/feed/cortes/:x/:id/gostei', 'Curtiu um corte'),
  R('POST', '/api/client/feed/cortes/:x/:id/enviar', 'Mandou um corte do feed pra postar'),
  // Pagamento
  R('POST', '/api/client/checkout/pagar', 'Pagou no checkout'),
  R('POST', '/api/client/checkout/cartao', 'Salvou o cartão'),
  R('DELETE', '/api/client/checkout/cartao', 'Apagou o cartão'),
  R('POST', '/api/client/billing/subscribe', 'Assinou ou trocou de plano'),
  R('POST', '/api/client/billing/subscribe-pix', 'Gerou PIX Automático'),
  R('POST', '/api/client/billing/buy-package', 'Comprou crédito avulso'),
  R('POST', '/api/client/billing/cancel', 'Cancelou o plano'),
  R('POST', '/api/client/billing/overage-card/enable', 'Ligou a cobrança de excedente'),
  R('POST', '/api/client/billing/overage-card/disable', 'Desligou a cobrança de excedente'),
  // Conta, comissões, Drive, Flora
  R('PUT', '/api/client/profile', 'Mudou o perfil'),
  R('PUT', '/api/client/password', 'Trocou a senha'),
  R('DELETE', '/api/client/conta', 'Excluiu a conta'),
  R('POST', '/api/client/drive/folder', 'Configurou o Google Drive'),
  R('POST', '/api/client/support/messages', 'Mandou mensagem pra Flora'),
  R('POST', '/api/client/commissions/withdraw', 'Pediu saque da comissão'),
  R('POST', '/api/client/commissions/links', 'Criou link de afiliado'),
  R('PUT', '/api/client/commissions/pix-key', 'Salvou a chave Pix'),
];

// Páginas: o caminho já é legível; só as principais ganham nome.
const PAGINAS = {
  '/client': 'Início',
  '/client/youtube': 'Vídeos do YouTube',
  '/client/lives': 'Lives',
  '/client/feed': 'Feed de cortes',
  '/client/social': 'Redes sociais',
  '/client/billing': 'Plano e uso',
  '/client/checkout': 'Checkout',
  '/client/commissions': 'Comissões',
  '/client/settings': 'Configurações',
  '/client/tutorial': 'Tutorial',
  '/client/support': 'Flora',
  '/client/videos-clips': 'Vídeos e cortes (antiga)',
  '/client/youtube-channels': 'Canais (antiga)',
  '/client/tiktok-account': 'TikTok (antiga)',
};

const NOMES_DAS_REDES = {
  instagram: 'Instagram',
  facebook: 'Facebook',
  threads: 'Threads',
  linkedin: 'LinkedIn',
  pinterest: 'Pinterest',
  bluesky: 'Bluesky',
  youtube: 'YouTube',
};

function rotuloDe(tipo, metodo, rota) {
  if (tipo === 'pagina') return `Abriu ${PAGINAS[rota] || rota}`;
  // Conexão de rede: o nome da rede está na própria rota e vale aparecer.
  const rede = /^\/(?:api\/client\/social-accounts|client\/social\/retorno)\/([a-z]+)/.exec(rota);
  if (rede && NOMES_DAS_REDES[rede[1]]) {
    return rota.endsWith('/conectar') ? `Começou a conectar o ${NOMES_DAS_REDES[rede[1]]}` : `Voltou da conexão do ${NOMES_DAS_REDES[rede[1]]}`;
  }
  const achado = ROTULOS.find(([m, r]) => m === metodo && r.test(rota));
  if (achado) return achado[2];
  const ultimo = rota.split('/').filter((s) => s && !s.startsWith(':')).pop() || rota;
  return `${areaDe(rota)}: ${metodo} ${ultimo}`;
}

module.exports = { normalizarRota, primeiroId, ignorada, ehVoltaDeConexao, areaDe, rotuloDe, IGNORAR };
