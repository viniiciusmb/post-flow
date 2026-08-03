// SEO e AEO (o que faz uma IA entender e citar o site).
//
// Tudo aqui quebra em silêncio: uma tag some, o dado estruturado vira inválido,
// o sitemap aponta pra página que não existe — e ninguém percebe, porque a
// página continua abrindo normalmente. O prejuízo aparece semanas depois, em
// tráfego que não veio.
//
// Estes testes existem pra transformar esses erros silenciosos em falha de
// build. O mais importante deles é o último: dado estruturado prometendo uma
// resposta que a página não tem é pior que não ter dado estruturado nenhum.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const pool = require('../../src/db/pool');
const { startServer, stopServer, createAgent } = require('../helpers/http');

let baseUrl;
let agente;

test.before(async () => {
  baseUrl = await startServer();
  agente = createAgent(baseUrl);
});

test.after(async () => {
  await stopServer();
  await pool.end();
});

function jsonLd(html) {
  const blocos = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  return blocos.map((m) => JSON.parse(m[1]));
}

function tipos(html) {
  const encontrados = [];
  for (const bloco of jsonLd(html)) {
    for (const item of bloco['@graph'] || [bloco]) encontrados.push(item['@type']);
  }
  return encontrados;
}

test('a home tem título e descrição próprios, não genéricos', async () => {
  const r = await agente.get('/');
  const titulo = r.text.match(/<title>(.*?)<\/title>/)[1];
  const descricao = r.text.match(/name="description" content="([^"]+)"/)[1];

  assert.match(titulo, /Post Flow/);
  assert.ok(titulo.length > 25 && titulo.length < 70, `título fora do tamanho útil: ${titulo.length}`);
  assert.ok(descricao.length > 90 && descricao.length < 250, `descrição fora do tamanho útil: ${descricao.length}`);
});

test('cada página pública tem título e descrição DIFERENTES das outras', async () => {
  const paginas = ['/', '/contato', '/termos', '/privacidade'];
  const titulos = new Set();
  const descricoes = new Set();

  for (const p of paginas) {
    const r = await agente.get(p);
    titulos.add(r.text.match(/<title>(.*?)<\/title>/)[1]);
    descricoes.add(r.text.match(/name="description" content="([^"]+)"/)[1]);
  }

  // Páginas com o mesmo título competem entre si na busca em vez de somar.
  assert.equal(titulos.size, paginas.length, 'há páginas com o mesmo título');
  assert.equal(descricoes.size, paginas.length, 'há páginas com a mesma descrição');
});

test('cada página aponta pra si mesma no canonical', async () => {
  for (const [caminho, esperado] of [
    ['/', 'https://postflowtiktok.com/'],
    ['/contato', 'https://postflowtiktok.com/contato'],
    ['/termos', 'https://postflowtiktok.com/termos'],
    ['/privacidade', 'https://postflowtiktok.com/privacidade'],
  ]) {
    const r = await agente.get(caminho);
    const canonical = r.text.match(/rel="canonical" href="([^"]+)"/)[1];
    // Sem canonical certo, a mesma página com e sem barra final, ou com
    // parâmetro de campanha, conta como várias páginas duplicadas.
    assert.equal(canonical, esperado, `canonical errado em ${caminho}`);
  }
});

test('o link tem cara de coisa séria quando colado no WhatsApp', async () => {
  const r = await agente.get('/');
  for (const tag of ['og:title', 'og:description', 'og:image', 'og:url', 'og:type']) {
    assert.match(r.text, new RegExp(`property="${tag}"`), `faltou ${tag}`);
  }
  assert.match(r.text, /name="twitter:card" content="summary_large_image"/);
});

test('a imagem de compartilhamento existe de verdade', async () => {
  // A tag apontando pra arquivo inexistente é pior que não ter tag: o link vira
  // um retângulo cinza em toda rede social.
  const r = await agente.get('/img/og/post-flow-og.png');
  assert.equal(r.status, 200);
});

test('robots.txt libera o site e esconde a área logada', async () => {
  const r = await agente.get('/robots.txt');
  assert.equal(r.status, 200);
  assert.match(r.text, /^User-agent: \*/m);
  assert.match(r.text, /^Allow: \/$/m);
  // Indexar tela de painel gera resultado quebrado pra quem clica sem login.
  for (const area of ['/client', '/admin', '/api', '/auth']) {
    assert.match(r.text, new RegExp(`Disallow: ${area}`), `${area} deveria estar bloqueado`);
  }
  assert.match(r.text, /Sitemap: https:\/\/postflowtiktok\.com\/sitemap\.xml/);
});

test('o sitemap só lista páginas que realmente abrem', async () => {
  const r = await agente.get('/sitemap.xml');
  assert.equal(r.status, 200);

  const urls = [...r.text.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  assert.ok(urls.length >= 4, 'sitemap vazio ou incompleto');

  // Sitemap apontando pra página que não existe é pior que não ter sitemap:
  // gasta o orçamento de rastreio do buscador com erro 404.
  for (const url of urls) {
    const caminho = url.replace('https://postflowtiktok.com', '') || '/';
    const pagina = await agente.get(caminho);
    assert.equal(pagina.status, 200, `${url} está no sitemap mas responde ${pagina.status}`);
  }
});

test('o sitemap não lista nada que o robots.txt bloqueia', async () => {
  const sitemap = await agente.get('/sitemap.xml');
  const urls = [...sitemap.text.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  // Dizer "indexe isto" e "não indexe isto" ao mesmo tempo é o tipo de sinal
  // contraditório que faz o buscador ignorar os dois.
  for (const url of urls) {
    for (const bloqueado of ['/client', '/admin', '/api', '/auth', '/login']) {
      assert.ok(!url.includes(bloqueado), `${url} está no sitemap e bloqueado no robots`);
    }
  }
});

test('llms.txt descreve o produto pra quem lê texto puro', async () => {
  const r = await agente.get('/llms.txt');
  assert.equal(r.status, 200);
  assert.match(r.text, /^# Post Flow/m);
  // O que uma IA precisa pra responder "o que é isso" sem inventar.
  for (const secao of ['## O que é', '## Como funciona', '## Para quem é', '## Planos e preço']) {
    assert.ok(r.text.includes(secao), `faltou a seção "${secao}"`);
  }
  assert.match(r.text, /Kleos Digital/);
});

test('os dados estruturados são JSON válido e dizem quem somos', async () => {
  const r = await agente.get('/');
  const encontrados = tipos(r.text);
  for (const tipo of ['Organization', 'WebSite', 'SoftwareApplication', 'FAQPage', 'HowTo']) {
    assert.ok(encontrados.includes(tipo), `faltou o schema ${tipo}`);
  }
});

test('o preço no dado estruturado é o preço real do banco', async () => {
  const r = await agente.get('/');
  const produto = jsonLd(r.text)
    .flatMap((b) => b['@graph'] || [b])
    .find((x) => x['@type'] === 'SoftwareApplication');

  const { rows } = await pool.query('SELECT name, price_cents FROM subscription_plans WHERE is_active = true');
  assert.equal(produto.offers.length, rows.length, 'a quantidade de planos não bate com o banco');

  for (const plano of rows) {
    const oferta = produto.offers.find((o) => o.name === plano.name);
    assert.ok(oferta, `plano "${plano.name}" não apareceu nos dados estruturados`);
    // Preço divergente do sistema é o pior tipo de erro aqui: o Google mostra
    // um valor no resultado e o cliente encontra outro na hora de pagar.
    assert.equal(oferta.price, (plano.price_cents / 100).toFixed(2));
    assert.equal(oferta.priceCurrency, 'BRL');
  }
});

test('toda pergunta do FAQPage está VISÍVEL na página', async () => {
  const r = await agente.get('/');
  const faq = jsonLd(r.text)
    .flatMap((b) => b['@graph'] || [b])
    .find((x) => x['@type'] === 'FAQPage');

  assert.ok(faq.mainEntity.length >= 8, 'poucas perguntas pra alimentar resposta de IA');

  for (const q of faq.mainEntity) {
    assert.equal(q['@type'], 'Question');
    assert.ok(q.acceptedAnswer.text.length > 40, `resposta curta demais: "${q.name}"`);

    // A regra que sustenta o resto: o Google penaliza dado estruturado que
    // promete uma resposta que a página não mostra. Como pergunta e resposta
    // vêm do mesmo array no controller, isto tem que bater sempre.
    const escapada = q.name.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/'/g, '&#39;');
    assert.ok(
      r.text.includes(escapada),
      `a pergunta "${q.name}" está no dado estruturado mas não aparece na página`
    );
  }
});

test('a página continua sem depender de servidor de terceiro', async () => {
  // Já foi corrigido uma vez (PicoCSS via CDN) e é fácil voltar sem querer:
  // além de mandar o IP de quem visita pra um terceiro, deixa a página
  // dependendo de um servidor que não é nosso pra renderizar.
  for (const caminho of ['/', '/contato', '/termos', '/privacidade']) {
    const r = await agente.get(caminho);
    const externos = [...r.text.matchAll(/(?:src|href)="(https?:\/\/[^"]+)"/g)]
      .map((m) => m[1])
      .filter((url) => !url.startsWith('https://postflowtiktok.com'))
      // Links de navegação pra fora (política do TikTok, etc.) são conteúdo,
      // não dependência de renderização.
      .filter((url) => /\.(css|js|woff2?|png|jpe?g|svg)(\?|$)/.test(url));
    assert.deepEqual(externos, [], `${caminho} carrega recurso de fora: ${externos.join(', ')}`);
  }
});

test('a home tem um H1 só', async () => {
  const r = await agente.get('/');
  const h1 = [...r.text.matchAll(/<h1[\s>]/g)];
  // Vários H1 diluem qual é o assunto da página; nenhum deixa o buscador
  // adivinhando pelo título da aba.
  assert.equal(h1.length, 1, `a página tem ${h1.length} H1`);
});
