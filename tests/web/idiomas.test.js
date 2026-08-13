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

  assert.ok(pt.includes('Vídeo novo no canal monitorado'), 'português perdeu o título');
  assert.ok(en.includes('New video on the monitored channel'), 'inglês não chegou na página');
  assert.ok(es.includes('Vídeo nuevo en el canal monitoreado'), 'espanhol não chegou na página');

  // O caso que dói: sobrar português no meio do inglês.
  assert.ok(!en.includes('Vídeo novo no canal monitorado'), 'sobrou português na página em inglês');
  assert.ok(!es.includes('Vídeo novo no canal monitorado'), 'sobrou português na página em espanhol');
});

test('sem cookie, o idioma do navegador decide', async () => {
  const r = await fetch(baseUrl + '/', { headers: { 'accept-language': 'en-US,en;q=0.9' } });
  assert.ok((await r.text()).includes('New video on the monitored channel'));

  const semNada = await fetch(baseUrl + '/');
  assert.ok((await semNada.text()).includes('Vídeo novo no canal monitorado'), 'o padrão deixou de ser português');
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

// --- Dicionários completos ---
//
// A falha que dói aqui não é a tradução ruim: é a chave que existe num idioma e
// falta no outro, porque aí uma frase em português aparece no meio da tela em
// inglês, e ninguém percebe até um cliente reclamar.

const fs = require('fs');
const path = require('path');

const RAIZ_PROJETO = path.join(__dirname, '..', '..');

test('os dicionários do servidor têm exatamente as mesmas chaves', () => {
  const caminhos = (obj, prefixo = '') =>
    Object.entries(obj).flatMap(([k, v]) =>
      v && typeof v === 'object' && !Array.isArray(v)
        ? caminhos(v, `${prefixo}${k}.`)
        : [`${prefixo}${k}`]
    );

  const pt = new Set(caminhos(require('../../src/i18n/pt')));
  for (const lang of ['en', 'es']) {
    const outro = new Set(caminhos(require(`../../src/i18n/${lang}`)));
    const faltando = [...pt].filter((c) => !outro.has(c));
    const sobrando = [...outro].filter((c) => !pt.has(c));
    assert.deepEqual(faltando, [], `${lang} não tem: ${faltando.join(', ')}`);
    assert.deepEqual(sobrando, [], `${lang} tem chave que o pt não tem: ${sobrando.join(', ')}`);
  }
});

test('os dicionários do painel têm exatamente as mesmas chaves', () => {
  // Lidos como texto porque são TypeScript: o teste roda em Node puro, sem
  // compilar o front. Basta a lista de chaves, que está entre aspas no começo
  // de cada linha.
  const chavesDe = (arquivo) => {
    const bruto = fs.readFileSync(path.join(RAIZ_PROJETO, 'web-client/src/i18n', arquivo), 'utf8');
    return new Set([...bruto.matchAll(/^\s*"([\w.]+)":/gm)].map((m) => m[1]));
  };

  const pt = chavesDe('pt.ts');
  assert.ok(pt.size > 300, `esperava centenas de chaves, achei ${pt.size}`);

  for (const arquivo of ['en.ts', 'es.ts']) {
    const outro = chavesDe(arquivo);
    const faltando = [...pt].filter((c) => !outro.has(c));
    const sobrando = [...outro].filter((c) => !pt.has(c));
    assert.deepEqual(faltando, [], `${arquivo} não tem: ${faltando.slice(0, 10).join(', ')}`);
    assert.deepEqual(sobrando, [], `${arquivo} tem chave a mais: ${sobrando.slice(0, 10).join(', ')}`);
  }
});

test('nenhuma tradução ficou igual ao português por esquecimento', () => {
  // Palavras iguais nos três idiomas existem de verdade ("Post Flow", "TikTok",
  // "normal"). O que este teste procura é o caso em que um bloco inteiro foi
  // copiado sem traduzir: se MUITAS frases longas forem idênticas, foi engano.
  const ler = (arquivo) => {
    const bruto = fs.readFileSync(path.join(RAIZ_PROJETO, 'web-client/src/i18n', arquivo), 'utf8');
    const mapa = new Map();
    for (const m of bruto.matchAll(/^\s*"([\w.]+)":\s*"(.*)",?$/gm)) mapa.set(m[1], m[2]);
    return mapa;
  };

  const pt = ler('pt.ts');
  for (const arquivo of ['en.ts', 'es.ts']) {
    const outro = ler(arquivo);
    const iguaisLongas = [...pt.entries()].filter(
      ([chave, texto]) => texto.length > 25 && outro.get(chave) === texto
    );
    assert.ok(
      iguaisLongas.length === 0,
      `${arquivo} tem ${iguaisLongas.length} frases longas idênticas ao português: ${iguaisLongas
        .slice(0, 5)
        .map(([c]) => c)
        .join(', ')}`
    );
  }
});

test('o erro da API chega no idioma de quem pediu', async () => {
  // Este caminho passa por res.locals.t dentro de um controller - é o que
  // garante que a tradução do servidor não parou nas páginas públicas.
  const r = await fetch(baseUrl + '/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: 'lang=en' },
    body: JSON.stringify({ email: 'nao-existe@x.com', password: 'errada' }),
  });
  const corpo = await r.json();
  assert.match(corpo.error, /Invalid email or password|CSRF|Too many/i);
});

test('o vídeo da hero e o poster dele existem no disco', async () => {
  // A hero troca o print estático do painel por um vídeo (prints reais em
  // loop, gerado com Remotion - ver marketing-video/). Ele é o mesmo nos três
  // idiomas (só em português), mas o arquivo tem que existir de verdade: se
  // não existir, a página abre com um retângulo vazio no lugar do produto -
  // e é a primeira coisa que um visitante vê.
  for (const lang of IDIOMAS) {
    const html = await (await buscar('/', lang)).text();
    for (const [attr, ext] of [['src', 'mp4'], ['poster', 'jpg']]) {
      const achado = html.match(new RegExp(`${attr}="(/video/tutorial-passo-a-passo[\\w-]*\\.${ext})"`));
      assert.ok(achado, `${attr} do vídeo da hero não aparece na landing em ${lang}`);

      const arquivo = path.join(RAIZ_PROJETO, 'src/web/public', achado[1]);
      assert.ok(fs.existsSync(arquivo), `${achado[1]} está na página mas não existe no disco`);
    }
  }
});

test('a Política de Privacidade lista os 4 escopos exatos do TikTok', async () => {
  // O revisor da TikTok compara o que o app PEDE no Developer Console com o que
  // a política DECLARA. Escopo pedido e não declarado é motivo de recusa, e
  // escopo declarado com outro nome ("publicar vídeos" em vez de video.publish)
  // dá o mesmo problema: ele não consegue casar um com o outro.
  const ESCOPOS = ['user.info.basic', 'user.info.stats', 'video.publish', 'video.upload'];

  for (const lang of IDIOMAS) {
    const secao = criarT(lang)('privacidade.secoes').find((s) => /TikTok/.test(s.h));
    assert.ok(secao, `seção do TikTok sumiu em ${lang}`);

    const tabela = secao.blocos.find((b) => b.tipo === 'tabela');
    assert.ok(tabela, `a seção do TikTok em ${lang} voltou a ser texto corrido em vez de tabela`);

    const listados = tabela.linhas.map((l) => l[0].replace(/<[^>]+>/g, '').trim());
    assert.deepEqual(listados, ESCOPOS, `escopos errados ou fora de ordem em ${lang}`);

    // Cada um precisa de uma explicação de verdade, não uma linha vazia.
    for (const [escopo, motivo] of tabela.linhas) {
      assert.ok(
        motivo.replace(/<[^>]+>/g, '').trim().length > 40,
        `${escopo} em ${lang} está sem explicação`
      );
    }
  }
});

test('os valores do formulário da TikTok cabem nos limites e apontam pro ar', async () => {
  // O formulário de submissão da TikTok tem limite de caracteres, e passar do
  // limite só aparece na hora de colar - com o vídeo já gravado e o usuário
  // esperando. Já aconteceu: a explicação passou de 1000 quando ganhou uma
  // frase a mais.
  const doc = fs.readFileSync(path.join(RAIZ_PROJETO, 'docs/tiktok-formulario.md'), 'utf8');

  const blocos = [...doc.matchAll(/```\n([\s\S]*?)```/g)].map((m) => m[1].trim());
  const descricao = blocos.find((b) => b.startsWith('Turns'));
  const motivo = blocos.find((b) => b.startsWith('First submission'));
  const explicacao = blocos.find((b) => b.startsWith('Post Flow is'));

  assert.ok(descricao, 'a descrição curta sumiu do formulário');
  assert.ok(descricao.length <= 120, `descrição tem ${descricao.length} caracteres (limite 120)`);

  assert.ok(motivo, 'o motivo da submissão sumiu do formulário');
  assert.ok(motivo.length <= 120, `motivo tem ${motivo.length} caracteres (limite 120)`);

  assert.ok(explicacao, 'a explicação de produtos e escopos sumiu do formulário');
  assert.ok(explicacao.length <= 1000, `explicação tem ${explicacao.length} caracteres (limite 1000)`);

  // O revisor analisa em inglês. Um campo em português é atrito à toa: ele
  // teria que traduzir pra conferir se bate com o que o app faz.
  for (const [nome, texto] of [['descrição', descricao], ['motivo', motivo], ['explicação', explicacao]]) {
    assert.ok(
      !/[ãõçá]|\b(seu|sua|para|com|vídeos?|cortes?)\b/i.test(texto),
      `${nome} voltou a ter português`
    );
  }

  // Os 4 escopos que o app pede precisam estar explicados aqui também: é o
  // texto que o revisor lê ao lado da lista de permissões.
  for (const escopo of ['user.info.basic', 'user.info.stats', 'video.publish', 'video.upload']) {
    assert.ok(explicacao.includes(escopo), `${escopo} não aparece na explicação`);
  }

  // Domínio: o formulário não pode apontar pro domínio antigo depois da troca.
  assert.ok(!doc.includes('postflowtiktok.com'), 'o formulário ainda cita o domínio antigo');
});
