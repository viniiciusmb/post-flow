// Os vídeos de divulgação precisam rodar quando incorporados em OUTRO site.
//
// O fundador anuncia o Post Flow em interactivelivegames.com; colou o link do
// vídeo lá e ele não rodou. A causa não é o outro site: o Helmet marca todo
// arquivo servido aqui com Cross-Origin-Resource-Policy: same-origin, e o
// navegador do visitante recusa o arquivo em silêncio — a página não mostra
// erro nenhum, o vídeo só não aparece.
//
// O que estes testes travam:
//   - a pasta de vídeos é liberada para outros sites;
//   - o RESTO do site continua fechado (a liberação não pode vazar);
//   - o vídeo aceita download parcial, que é como o player busca o trecho
//     ao arrastar a barra.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const pool = require('../../src/db/pool');
const { startServer, stopServer } = require('../helpers/http');

let baseUrl;

test.before(async () => {
  baseUrl = await startServer();
});

test.after(async () => {
  await stopServer();
  await pool.end();
});

test('o vídeo da página inicial pode ser exibido a partir de outro site', async () => {
  const r = await fetch(`${baseUrl}/video/tutorial-passo-a-passo.mp4`, { method: 'HEAD' });
  assert.equal(r.status, 200);
  assert.equal(
    r.headers.get('cross-origin-resource-policy'),
    'cross-origin',
    'com same-origin o navegador recusa o arquivo em outro domínio e o vídeo não roda'
  );
  assert.equal(r.headers.get('content-type'), 'video/mp4');
});

test('a imagem de capa acompanha o vídeo', async () => {
  // Sem ela o player mostra um retângulo preto antes de dar play.
  const r = await fetch(`${baseUrl}/video/tutorial-passo-a-passo-poster.jpg`, { method: 'HEAD' });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('cross-origin-resource-policy'), 'cross-origin');
});

test('o player consegue pedir só um trecho do arquivo', async () => {
  // É assim que o navegador começa a tocar sem baixar os 5 MB inteiros, e é o
  // que faz arrastar a barra funcionar.
  const r = await fetch(`${baseUrl}/video/tutorial-passo-a-passo.mp4`, {
    headers: { Range: 'bytes=0-1023' },
  });
  assert.equal(r.status, 206, 'sem resposta parcial o player baixa tudo antes de tocar');
  assert.equal(r.headers.get('content-length'), '1024');
});

test('a liberação NÃO vaza para o resto do site', async () => {
  // Este é o teste que impede a correção de virar um buraco: só a pasta de
  // divulgação é pública para outros domínios.
  for (const caminho of ['/', '/login', '/css/public.css']) {
    const r = await fetch(`${baseUrl}${caminho}`, { redirect: 'manual' });
    assert.notEqual(
      r.headers.get('cross-origin-resource-policy'),
      'cross-origin',
      `${caminho} não deveria estar liberado pra outros domínios`
    );
    assert.notEqual(r.headers.get('access-control-allow-origin'), '*', `${caminho} não deveria liberar CORS`);
  }
});
