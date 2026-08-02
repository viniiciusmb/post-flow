// Protecao contra CSRF (Cross-Site Request Forgery): um site malicioso fazer
// o navegador do cliente logado disparar uma acao no Post Flow sem ele saber
// (apagar canal, trocar plano, comprar credito avulso).
//
// Sao duas camadas, de proposito:
//
//   1. sameSite: 'lax' no cookie de sessao (ver app.js). Sozinho ja resolve o
//      ataque classico: o navegador nao manda o cookie de sessao num
//      POST/PUT/DELETE vindo de outro site. E a defesa mais forte.
//
//   2. Token de dupla submissao (este arquivo). Cobre o resto: navegador
//      antigo sem suporte a SameSite, e qualquer cenario "mesmo site, outra
//      origem". O token vive na sessao e e devolvido pro frontend num cookie
//      LEGIVEL por JavaScript (csrf_token) - a SPA le esse cookie e reenvia o
//      valor no cabecalho X-CSRF-Token. Um site de terceiro consegue ate
//      forcar a requisicao, mas NAO consegue ler o cookie de outro dominio pra
//      descobrir o valor, entao a comparacao falha.
'use strict';

const crypto = require('crypto');
const config = require('../../config');

const COOKIE_NAME = 'csrf_token';
const HEADER_NAME = 'x-csrf-token';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// Rotas que NAO podem exigir token, cada uma com o proprio motivo:
//
//  - /api/stripe/webhook: quem chama e a Stripe, sem navegador e sem sessao.
//    Ja e autenticada pela assinatura stripe-signature no corpo bruto.
//  - /api/tunnel/register-pending: quem chama e o programa de bandeja
//    instalado na maquina do cliente, sem sessao de login.
//  - /login, /register, /api/auth/login: acontecem ANTES de existir sessao,
//    entao nao ha onde guardar token. Continuam protegidas pelo sameSite e
//    pelo limite de tentativas (rate limit).
const EXEMPT_PATHS = [
  '/api/stripe/webhook',
  '/api/tunnel/register-pending',
  '/login',
  '/register',
  '/api/auth/login',
];

function isExempt(req) {
  return EXEMPT_PATHS.some((p) => req.path === p || req.path.startsWith(`${p}/`));
}

// Comparacao em tempo constante: comparar com === vazaria, pelo tempo de
// resposta, quantos caracteres do token o atacante ja acertou.
function tokensMatch(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

// Le um cookie do cabecalho sem depender do pacote cookie-parser (o projeto
// evita dependencia nova quando 3 linhas resolvem - mesmo criterio do logger).
function readCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const parte of header.split(';')) {
    const igual = parte.indexOf('=');
    if (igual === -1) continue;
    if (parte.slice(0, igual).trim() === name) return decodeURIComponent(parte.slice(igual + 1).trim());
  }
  return null;
}

// Garante que existe token na sessao e que o navegador tem a copia legivel.
// Roda em toda requisicao com sessao ativa (inclusive GET), pra que a pagina
// ja carregue com o cookie pronto antes da primeira acao do usuario.
function issueToken(req, res) {
  if (!req.session) return null;
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }
  const token = req.session.csrfToken;
  if (readCookie(req, COOKIE_NAME) !== token) {
    res.cookie(COOKIE_NAME, token, {
      // httpOnly: false de proposito - a SPA PRECISA ler esse valor pra
      // reenviar no cabecalho. Isso nao enfraquece nada: o token so vale
      // combinado com o cookie de sessao, que continua httpOnly.
      httpOnly: false,
      sameSite: 'lax',
      secure: config.isProduction,
      path: '/',
    });
  }
  res.locals.csrfToken = token;
  return token;
}

function middleware(req, res, next) {
  issueToken(req, res);

  if (SAFE_METHODS.has(req.method) || isExempt(req)) return next();

  // Sem sessao de usuario nao ha nada a proteger: a rota vai recusar por falta
  // de autenticacao logo em seguida.
  if (!req.session || !req.session.user) return next();

  const enviado = req.get(HEADER_NAME) || (req.body && req.body._csrf);
  if (!tokensMatch(enviado, req.session.csrfToken)) {
    const aceitaJson = req.path.startsWith('/api/') || req.accepts(['html', 'json']) === 'json';
    if (aceitaJson) {
      return res.status(403).json({
        error: 'Sessao expirada ou requisicao invalida. Atualize a pagina e tente de novo.',
      });
    }
    return res.status(403).render('errors/generic', {
      title: 'Requisicao invalida',
      message: 'Sua sessao expirou. Atualize a pagina e tente de novo.',
    });
  }

  return next();
}

module.exports = { middleware, COOKIE_NAME, HEADER_NAME };
