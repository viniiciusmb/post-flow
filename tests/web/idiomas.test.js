// O site em português, inglês e espanhol.
//
// O que estes testes protegem não é a qualidade da tradução (isso é leitura
// humana), e sim as duas formas de quebrar que passam despercebidas:
//
//   1. uma página que responde 500 num idioma e 200 no outro, porque o
//      dicionário daquele idioma tem uma chave a menos ou uma lista mais curta;
//   2. o idioma escolhido não "pegar" - o cookie ser ignorado, ou uma página
//      continuar em português enquanto o resto do site já trocou.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const pool = require('../../src/db/pool');
const { startServer, stopServer } = require('../helpers/http');
const { criarT } = require('../../src/i18n');

const IDIOMAS = ['pt', 'en', 'es'];
const PAGINAS = ['/', '/termos', '/privacidade', '/contato'];

let baseUrl;

test.before(async () => {
  baseUrl = await startServer();
});

test.after(async () => {
  await stopServer();
  await pool.end();
});

function buscar(caminho, lang) {
  return fetch(`${baseUrl}${caminho}`, { headers: { cookie: `lang=${lang}` } });
}

test('todas as páginas públicas abrem nos três idiomas', async () => {
  for (const lang of IDIOMAS) {
    for (const caminho of PAGINAS) {
      const r = await buscar(caminho, lang);
      assert.equal(r.status, 200, `${caminho} quebrou em ${lang}`);
    }
  }
});

test('o cookie decide o idioma, e o <html lang> acompanha', async () => {
  const esperado = { pt: 'pt-BR', en: 'en', es: 'es' };
  for (const lang of IDIOMAS) {
    const html = await (await buscar('/', lang)).text();
    assert.match(html, new RegExp(`<html lang="${esperado[lang]}"`), `<html lang> errado em ${lang}`);
  }
});

test('a landing realmente troca de texto, não só de rótulo', async () => {
  const pt = await (await buscar('/', 'pt')).text();
  const en = await (await buscar('/', 'en')).text();
  const es = await (await buscar('/', 'es')).text();

  assert.ok(pt.includes('Você grava uma vez'), 'português perdeu o título');
  assert.ok(en.includes('You record once'), 'inglês não chegou na página');
  assert.ok(es.includes('Grabas una vez'), 'espanhol não chegou na página');

  // O caso que dói: sobrar português no meio do inglês.
  assert.ok(!en.includes('Você grava uma vez'), 'sobrou português na página em inglês');
  assert.ok(!es.includes('Você grava uma vez'), 'sobrou português na página em espanhol');
});

test('sem cookie, o idioma do navegador decide', async () => {
  const r = await fetch(baseUrl + '/', { headers: { 'accept-language': 'en-US,en;q=0.9' } });
  assert.ok((await r.text()).includes('You record once'));

  const semNada = await fetch(baseUrl + '/');
  assert.ok((await semNada.text()).includes('Você grava uma vez'), 'o padrão deixou de ser português');
});

test('os documentos legais têm as MESMAS seções nos três idiomas', () => {
  // Um documento com uma cláusula a menos num idioma é pior que um não
  // traduzido: quem lê não tem como saber que está vendo menos.
  for (const doc of ['termos', 'privacidade']) {
    const quantidades = IDIOMAS.map((lang) => criarT(lang)(`${doc}.secoes`).length);
    assert.equal(
      new Set(quantidades).size,
      1,
      `${doc} tem número diferente de seções por idioma: ${quantidades.join(', ')}`
    );

    // E os blocos de cada seção também: uma lista de 5 itens que virou 4.
    for (let i = 0; i < quantidades[0]; i++) {
      const blocos = IDIOMAS.map((lang) => criarT(lang)(`${doc}.secoes`)[i].blocos.length);
      assert.equal(new Set(blocos).size, 1, `${doc}, seção ${i + 1}: blocos diferentes por idioma`);
    }
  }
});

test('as perguntas frequentes batem entre idiomas e com o dado estruturado', async () => {
  const quantidades = IDIOMAS.map((lang) => criarT(lang)('perguntas').length);
  assert.equal(new Set(quantidades).size, 1, 'número de perguntas diferente por idioma');

  // O FAQPage tem que dizer o mesmo que a página que a pessoa está lendo -
  // resposta divergente é justamente o que faz o Google desconfiar do dado
  // estruturado.
  const html = await (await buscar('/', 'en')).text();
  const primeira = criarT('en')('perguntas')[0].p;
  assert.ok(html.includes(primeira), 'a pergunta não aparece na página em inglês');
  assert.ok(
    html.includes(JSON.stringify(primeira).slice(1, -1)),
    'a pergunta não entrou no dado estruturado em inglês'
  );
});

test('idioma desconhecido no cookie cai no padrão, não em erro', async () => {
  const r = await buscar('/', 'klingon');
  assert.equal(r.status, 200);
});

test('nenhum script inline nas páginas públicas', async () => {
  // A política de segurança do site é `script-src 'self'`: script escrito
  // dentro da página é bloqueado SEM erro visível - simplesmente não roda. Foi
  // assim que o efeito da barra do topo ficou morto sem ninguém notar, e o
  // seletor de idioma quase repetiu o mesmo erro.
  for (const lang of IDIOMAS) {
    for (const caminho of PAGINAS) {
      const html = await (await buscar(caminho, lang)).text();
      const inlines = html.match(/<script(?![^>]*\bsrc=)[^>]*>/g) || [];
      const semDados = inlines.filter((tag) => !tag.includes('application/ld+json'));
      assert.equal(
        semDados.length,
        0,
        `${caminho} (${lang}) tem script inline, que o CSP bloqueia: ${semDados.join(', ')}`
      );
    }
  }
});
