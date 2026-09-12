// Procura uma imagem REAL para ilustrar uma cena, em acervos cuja licenca
// permite uso comercial.
//
// Cascata, do mais especifico para o mais generico:
//
//   1. Wikimedia Commons - imbativel em tema historico e factual. Devolve a
//      gravura ORIGINAL em altissima resolucao (testado: a Peste de Florenca
//      de Boccaccio em 7508x5631, dominio publico). Nao pede chave.
//   2. Openverse - agregador; pega o que o Wikimedia nao tem. Nao pede chave.
//   3. Pexels - foto moderna, onde os dois de cima sao fracos. So entra se a
//      chave estiver configurada.
//
// Quem nao acha nada devolve null, e o pipeline cai para a imagem gerada por
// IA. Isso NAO e excecao: medido contra a API real, uma busca sobre tema
// moderno e abstrato ("artificial intelligence replacing jobs") devolveu 4
// resultados inuteis, e 3 de 6 buscas da amostra vieram vazias. O plano B e o
// que faz o video nao ter buraco.
'use strict';

const config = require('../config');
const logger = require('../lib/logger');
const { permitida, credito } = require('../lib/licencaDeImagem');

// O Wikimedia exige User-Agent identificavel com forma de contato; requisicao
// anonima e bloqueada.
const { CONTACT } = require('../config/constants');
const UA = `PostFlow/1.0 (${CONTACT.supportEmail})`;

// Abaixo disso a imagem fica borrada ao ser ampliada para 1080p, ainda mais
// com o zoom lento por cima.
const LARGURA_MINIMA = 800;
const TIMEOUT_MS = 15_000;

async function buscarJson(url, headers = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, ...headers }, signal: controller.signal });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    // Acervo fora do ar nunca pode derrubar a geracao do video: a cascata
    // segue para a proxima fonte, e a IA e o fundo do poco.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Wikimedia Commons
// ---------------------------------------------------------------------------
async function noWikimedia(termo) {
  const u = new URL('https://commons.wikimedia.org/w/api.php');
  Object.entries({
    action: 'query',
    format: 'json',
    generator: 'search',
    gsrsearch: termo,
    gsrnamespace: '6',
    gsrlimit: '12',
    prop: 'imageinfo',
    iiprop: 'url|size|extmetadata',
    iiurlwidth: '1920',
  }).forEach(([k, v]) => u.searchParams.set(k, v));

  const data = await buscarJson(u);
  const paginas = Object.values(data?.query?.pages || {});

  return paginas
    // O filtro de extensao roda sobre o TITULO, nunca sobre a URL: a URL do
    // Wikimedia vem com query string ("...jpg?download&...") e um regex de fim
    // de string sobre ela rejeita TODAS as imagens. Foi exatamente esse o bug
    // que fez a primeira amostra sair sem nenhuma imagem.
    .filter((p) => /\.(jpe?g|png)$/i.test(p.title || ''))
    .map((p) => {
      const i = p.imageinfo?.[0];
      if (!i?.thumburl) return null;
      const meta = i.extmetadata || {};
      const licenca = meta.LicenseShortName?.value || '';
      return {
        url: i.thumburl,
        width: i.width,
        height: i.height,
        license: licenca,
        credit: credito({
          titulo: p.title,
          autor: meta.Artist?.value,
          licenca,
        }),
        source: 'wikimedia',
        titulo: p.title,
      };
    })
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// Openverse
// ---------------------------------------------------------------------------
async function noOpenverse(termo) {
  const u = new URL('https://api.openverse.org/v1/images/');
  u.searchParams.set('q', termo);
  u.searchParams.set('page_size', '12');
  // Pede so o que ja permite uso comercial E obra derivada - o proprio
  // agregador filtra, o que evita baixar o que seria recusado depois.
  u.searchParams.set('license_type', 'commercial,modification');

  const data = await buscarJson(u);
  return (data?.results || []).map((r) => ({
    url: r.url,
    width: r.width,
    height: r.height,
    license: r.license,
    credit: credito({ titulo: r.title, autor: r.creator, licenca: r.license }),
    source: r.source === 'wikimedia' ? 'wikimedia' : 'openverse',
    titulo: r.title,
  }));
}

// ---------------------------------------------------------------------------
// Pexels (opcional - so com chave)
// ---------------------------------------------------------------------------
async function noPexels(termo) {
  if (!config.pexels.apiKey) return [];

  const u = new URL('https://api.pexels.com/v1/search');
  u.searchParams.set('query', termo);
  u.searchParams.set('per_page', '10');

  const data = await buscarJson(u, { Authorization: config.pexels.apiKey });
  return (data?.photos || []).map((p) => ({
    url: p.src?.large2x || p.src?.large || p.src?.original,
    width: p.width,
    height: p.height,
    // O Pexels nao tem codigo de licenca: o termo de uso dele proprio ja
    // libera uso comercial. Por isso a fonte e que autoriza, nao a licenca.
    license: 'Pexels License',
    credit: credito({ titulo: p.alt || termo, autor: p.photographer, licenca: 'Pexels' }),
    source: 'pexels',
    titulo: p.alt || termo,
  }));
}

// Escolhe a melhor candidata: maior area, desde que a licenca permita, a
// largura sirva e ela ainda nao tenha sido usada em outra cena.
//
// A repeticao importa mais do que parece: sem esse controle, duas cenas
// vizinhas sobre o mesmo assunto trazem a MESMA gravura e o video parece
// travado na tela.
function melhorDaLista(candidatas, usadas) {
  return candidatas
    .filter((c) => c && c.url && !usadas.has(c.url))
    .filter((c) => (c.width || 0) >= LARGURA_MINIMA)
    .filter((c) => permitida(c.license, { fonte: c.source }))
    .sort((a, b) => (b.width * b.height) - (a.width * a.height))[0] || null;
}

// Devolve a imagem escolhida ou null. `usadas` e um Set de URLs ja gastas no
// mesmo video.
async function buscar(termo, { usadas = new Set() } = {}) {
  const busca = String(termo || '').trim();
  if (!busca) return null;

  const fontes = [noWikimedia, noOpenverse, noPexels];
  for (const fonte of fontes) {
    try {
      const escolhida = melhorDaLista(await fonte(busca), usadas);
      if (escolhida) {
        usadas.add(escolhida.url);
        return escolhida;
      }
    } catch (err) {
      logger.error(`Falha ao consultar acervo de imagens para "${busca}":`, err.message);
    }
  }
  return null;
}

module.exports = { buscar, melhorDaLista, LARGURA_MINIMA };
