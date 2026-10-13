// A landing reescrita em 12/10/2026: o que ela promete tem que bater com o que
// o produto e o banco dizem.
//
// O defeito provável aqui não é a página quebrar (isso os testes de idioma
// pegam): é ela voltar a vender o produto antigo - só TikTok, sem lives, com o
// grupo de WhatsApp que saiu - ou anunciar um limite de plano diferente do que
// o sistema cobra.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { startServer, stopServer, createAgent } = require('../helpers/http');
const pool = require('../../src/db/pool');

let url;

test.before(async () => {
  url = await startServer();
});

test.after(async () => {
  await stopServer();
  await pool.end();
});

async function landing(lang = 'pt') {
  const r = await fetch(`${url}/`, { headers: { cookie: `lang=${lang}` } });
  assert.equal(r.status, 200);
  return r.text();
}

test('as 8 redes e as 3 fontes aparecem na página', async () => {
  const html = await landing();
  for (const rede of ['TikTok', 'Instagram', 'YouTube Shorts', 'Facebook', 'Threads', 'LinkedIn', 'Pinterest', 'Bluesky']) {
    assert.ok(html.includes(rede), `${rede} sumiu da landing`);
  }
  for (const fonte of ['Twitch', 'Kick']) {
    assert.ok(html.includes(fonte), `${fonte} sumiu da landing`);
  }
});

test('o grupo do WhatsApp saiu da página', async () => {
  const html = await landing();
  assert.ok(!/whatsapp/i.test(html), 'a landing ainda fala do grupo do WhatsApp');
});

test('os limites de rede e de live de cada plano saem do banco', async () => {
  const html = await landing();
  const { rows } = await pool.query(
    'SELECT name, max_contas_por_rede, max_canais_de_live FROM subscription_plans WHERE is_active = true'
  );
  assert.ok(rows.length > 0);
  for (const plano of rows) {
    if (plano.max_contas_por_rede) {
      const texto = plano.max_contas_por_rede > 1
        ? `${plano.max_contas_por_rede} contas em cada uma das outras 7 redes`
        : `${plano.max_contas_por_rede} conta em cada uma das outras 7 redes`;
      assert.ok(html.includes(texto), `${plano.name}: faltou "${texto}"`);
    }
    if (plano.max_canais_de_live) {
      const texto = plano.max_canais_de_live > 1
        ? `${plano.max_canais_de_live} canais de live`
        : `${plano.max_canais_de_live} canal de live`;
      assert.ok(html.includes(texto), `${plano.name}: faltou "${texto}"`);
    }
  }
});

test('a regra de crédito das lives é a mesma do sistema', async () => {
  // 3 minutos de live = 1 crédito é o que liveCreditosService cobra. Se um dia
  // a taxa mudar lá, a landing não pode continuar prometendo a antiga.
  const { SEGUNDOS_POR_CREDITO } = require('../../src/services/lives/liveCreditosService');
  const minutos = SEGUNDOS_POR_CREDITO / 60;
  const html = await landing();
  assert.ok(html.includes(`${minutos} minutos de live = 1 crédito`), 'a regra de crédito das lives na landing não bate com o sistema');
});

test('o título tem a frase inteira pra leitor de tela, não só a palavra que troca', async () => {
  const html = await landing();
  assert.match(html, /class="sr-only">Do vídeo longo ao corte publicado no TikTok, Instagram, YouTube Shorts/);
  assert.match(html, /data-rotativo="TikTok\|Instagram\|YouTube Shorts\|/);
});

test('os dados estruturados listam os recursos novos', async () => {
  const html = await landing();
  const bloco = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
    .map((m) => JSON.parse(m[1]))
    .find((j) => JSON.stringify(j).includes('SoftwareApplication'));
  assert.ok(bloco, 'sumiu o SoftwareApplication');
  const produto = bloco['@graph'].find((n) => n['@type'] === 'SoftwareApplication');
  assert.ok(produto.featureList.some((f) => /live/i.test(f)), 'a lista de recursos não cita as lives');
  assert.ok(produto.featureList.some((f) => /8 redes/.test(f)), 'a lista de recursos não cita as 8 redes');
});

test('a seção do Feed de cortes substituiu a de números, nos três idiomas', async () => {
  // Os números de uso eram escritos à mão (não vinham do banco). A faixa
  // passou a vender o Feed de cortes, que é o produto de verdade.
  for (const [lang, titulo] of [['pt', 'Rolou, curtiu, postou.'], ['en', 'Scroll, like, post.'], ['es', 'Desliza, dale like, publica.']]) {
    const html = await landing(lang);
    assert.ok(html.includes('id="feed"'), `sumiu a seção do feed em ${lang}`);
    assert.ok(html.includes(titulo), `título do feed errado em ${lang}`);
    assert.ok(!/340 milh|85 mil|85K/.test(html), `os números de uso voltaram em ${lang}`);
  }
});
