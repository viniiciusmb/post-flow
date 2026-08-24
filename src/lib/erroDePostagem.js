// Decide se uma falha ao publicar no TikTok merece nova tentativa.
//
// A classificacao acontece NO MOMENTO DA FALHA, com o objeto de erro em maos -
// nunca lendo a mensagem de volta do banco. O retry automatico de VIDEO
// (sourceVideosRepository.findTransientErrorsForAutoRetry) faz o contrario:
// casa uma expressao regular contra source_videos.error_message. Isso parou de
// funcionar quando a mensagem tecnica saiu da tela do cliente e passou a ser
// gravada como NULL - o retry existe, mas quase nunca dispara. Nao repetir o
// erro aqui.
'use strict';

// Falhas que NAO adianta repetir: a proxima tentativa daria exatamente o mesmo
// resultado. Sao problemas do conteudo, da configuracao ou do nosso codigo -
// tem que aparecer pro admin em vez de ficar girando em silencio.
//
// Casadas por CODIGO da TikTok (que vem entre colchetes na mensagem que
// montamos em tiktokService), nao por texto livre: a TikTok manda quase todo
// erro com o mesmo texto generico, e so o codigo distingue um do outro.
const CODIGOS_PERMANENTES = [
  // Parametro que nos mandamos errado (tamanho de pedaco, duracao, privacidade).
  // Ja aconteceu de verdade: 8 postagens recusadas por conta de pedaco errada.
  'invalid_params',
  // App sem auditoria, escopo faltando, conta sem permissao.
  'unaudited_client_can_only_post_to_private_accounts',
  'scope_not_authorized',
  'access_token_invalid',
  'spam_risk_too_many_posts',
  'spam_risk_user_banned_from_posting',
  'reached_active_user_cap',
  // Conteudo recusado pela TikTok.
  'picture_size_check_failed',
  'video_pull_failed',
];

// Sinais de problema passageiro: rede, sobrecarga, limite momentaneo. Aqui
// tentar de novo e exatamente o certo.
const SINAIS_TRANSITORIOS = [
  'fetch failed',
  'econnreset',
  'econnrefused',
  'etimedout',
  'enotfound',
  'eai_again',
  'socket hang up',
  'network',
  'timeout',
  'aborted',
  'rate_limit',
  'internal_error',
  'http_429',
  'http_500',
  'http_502',
  'http_503',
  'http_504',
];

/**
 * @returns {'permanente'|'transitorio'}
 *
 * Erro DESCONHECIDO conta como transitorio de proposito. O numero de
 * tentativas e limitado, entao o pior caso de errar pra esse lado e o corte
 * demorar algumas horas a mais pra aparecer na aba de erros; errar pro outro
 * lado joga fora um corte que teria publicado na segunda tentativa - que foi
 * a reclamacao que originou isto.
 */
function classificar(erro) {
  const texto = String(erro?.message || erro || '').toLowerCase();

  // Arquivo do corte sumiu do disco: repetir nao traz o arquivo de volta.
  if (texto.includes('arquivo do corte')) return 'permanente';

  for (const codigo of CODIGOS_PERMANENTES) {
    if (texto.includes(`[${codigo}]`) || texto.includes(codigo)) return 'permanente';
  }
  for (const sinal of SINAIS_TRANSITORIOS) {
    if (texto.includes(sinal)) return 'transitorio';
  }
  return 'transitorio';
}

// Quantas vezes tentamos de novo antes de desistir e mostrar na aba de erros.
const MAX_TENTATIVAS = 5;

// Espera crescente entre tentativas, em minutos. Comeca curto (a maioria das
// falhas de rede passa em segundos) e cresce pra nao martelar a API da TikTok
// quando o problema e do lado dela.
const ESPERA_POR_TENTATIVA_MINUTOS = [5, 15, 45, 120, 240];

function esperaEmMinutos(tentativasJaFeitas) {
  const i = Math.min(tentativasJaFeitas, ESPERA_POR_TENTATIVA_MINUTOS.length - 1);
  return ESPERA_POR_TENTATIVA_MINUTOS[Math.max(0, i)];
}

// Ainda vale tentar de novo?
function deveTentarDeNovo(erro, tentativasJaFeitas) {
  if (classificar(erro) === 'permanente') return false;
  return Number(tentativasJaFeitas || 0) < MAX_TENTATIVAS;
}

module.exports = {
  classificar,
  deveTentarDeNovo,
  esperaEmMinutos,
  MAX_TENTATIVAS,
  ESPERA_POR_TENTATIVA_MINUTOS,
};
