'use strict';

// Idiomas do produto.
//
// Fonte unica pros dois lados: o painel React le daqui via /api/config, e as
// paginas EJS publicas leem direto. Duplicar essa lista no front e no back
// garantiria que uma hora elas discordassem.
//
// O idioma escolhido vai num COOKIE (nao so no localStorage) porque as paginas
// publicas sao renderizadas no servidor: sem cookie, a landing sairia sempre em
// portugues e so trocaria depois que o JavaScript rodasse.

const IDIOMAS = [
  { code: 'pt', label: 'Português', htmlLang: 'pt-BR' },
  { code: 'en', label: 'English', htmlLang: 'en' },
  { code: 'es', label: 'Español', htmlLang: 'es' },
];

const CODIGOS = IDIOMAS.map((i) => i.code);
const PADRAO = 'pt';
const COOKIE = 'lang';

function normalizar(valor) {
  if (!valor) return null;
  // Aceita "pt", "pt-BR", "en-US" - so o prefixo importa.
  const prefixo = String(valor).trim().toLowerCase().split(/[-_]/)[0];
  return CODIGOS.includes(prefixo) ? prefixo : null;
}

// Le um cookie do cabecalho cru. O projeto nao usa cookie-parser (a sessao e o
// CSRF nao precisavam), e trazer uma dependencia pra ler um valor curto nao se
// justifica.
function lerCookie(req, nome) {
  const bruto = req.headers && req.headers.cookie;
  if (!bruto) return null;
  for (const parte of bruto.split(';')) {
    const igual = parte.indexOf('=');
    if (igual === -1) continue;
    if (parte.slice(0, igual).trim() === nome) {
      try {
        return decodeURIComponent(parte.slice(igual + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}

// O que o visitante quer, em ordem de prioridade: a escolha explicita dele
// primeiro, o idioma do navegador depois, e o padrao por ultimo.
function resolverDaRequisicao(req) {
  const doCookie = normalizar(lerCookie(req, COOKIE));
  if (doCookie) return doCookie;

  const header = req.headers['accept-language'];
  if (header) {
    for (const parte of header.split(',')) {
      const idioma = normalizar(parte.split(';')[0]);
      if (idioma) return idioma;
    }
  }
  return PADRAO;
}

function htmlLang(code) {
  const achado = IDIOMAS.find((i) => i.code === code);
  return achado ? achado.htmlLang : 'pt-BR';
}

module.exports = { IDIOMAS, CODIGOS, PADRAO, COOKIE, normalizar, lerCookie, resolverDaRequisicao, htmlLang };
