// Contagem de cliques exercitada pela pilha inteira: a visita chega na landing
// com ?ref=, o middleware decide se aquilo é uma pessoa, e o clique aparece no
// painel do afiliado.
//
// Feito por HTTP de verdade porque as duas regras que importam dependem de
// coisas que só existem numa requisição: o user-agent (prévia de link do
// WhatsApp não é gente) e o cookie de sessão (a mesma pessoa recarregando não
// são três pessoas).
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const affiliateLinksRepository = require('../../src/repositories/affiliateLinksRepository');
const pool = require('../../src/db/pool');
const { startServer, stopServer, createLoginableClient, createAgent } = require('../helpers/http');
const { closePool } = require('../helpers/db');

let baseUrl;

test.before(async () => {
  baseUrl = await startServer();
});
test.after(async () => {
  await stopServer();
  await closePool();
});

async function contarCliques(linkId) {
  const { rows } = await pool.query(
    'SELECT count(*)::int AS n FROM affiliate_link_clicks WHERE affiliate_link_id = $1',
    [linkId]
  );
  return rows[0].n;
}

// Visita a landing com um user-agent escolhido, guardando (ou não) cookies.
async function visitar(code, { userAgent = 'Mozilla/5.0 (Macintosh) Chrome/120', cookies = null } = {}) {
  const headers = { 'user-agent': userAgent };
  if (cookies) headers.cookie = cookies;
  const r = await fetch(`${baseUrl}/?ref=${code}`, { headers, redirect: 'manual' });
  const set = (r.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).join('; ');
  return { status: r.status, cookies: set || cookies };
}

// O clique é gravado solto (sem await) pra não segurar a página. Espera o
// banco alcançar em vez de dormir um tempo fixo.
async function esperarCliques(linkId, esperado, tentativas = 40) {
  for (let i = 0; i < tentativas; i++) {
    if ((await contarCliques(linkId)) >= esperado) return;
    await new Promise((r) => setTimeout(r, 25));
  }
}

test('visita com ?ref= vira um clique daquele link', async () => {
  const dono = await createLoginableClient();
  const link = await affiliateLinksRepository.getOrCreateDefault(dono.id);

  await visitar(link.code);
  await esperarCliques(link.id, 1);

  assert.equal(await contarCliques(link.id), 1);
});

test('a mesma pessoa recarregando a pagina nao vira varios cliques', async () => {
  const dono = await createLoginableClient();
  const link = await affiliateLinksRepository.getOrCreateDefault(dono.id);

  const primeira = await visitar(link.code);
  await esperarCliques(link.id, 1);
  await visitar(link.code, { cookies: primeira.cookies });
  await visitar(link.code, { cookies: primeira.cookies });
  await new Promise((r) => setTimeout(r, 150));

  assert.equal(await contarCliques(link.id), 1, 'F5 tres vezes continua sendo uma pessoa');
});

test('previa de link (WhatsApp, Facebook, robo de busca) nao conta como clique', async () => {
  // Colar o link num grupo faz o servidor do app abrir a página pra montar o
  // cartãozinho. Sem este filtro, o link nasceria com cliques que ninguém deu.
  const dono = await createLoginableClient();
  const link = await affiliateLinksRepository.getOrCreateDefault(dono.id);

  for (const ua of ['WhatsApp/2.23', 'facebookexternalhit/1.1', 'Googlebot/2.1', 'TelegramBot (like TwitterBot)']) {
    await visitar(link.code, { userAgent: ua });
  }
  await new Promise((r) => setTimeout(r, 200));

  assert.equal(await contarCliques(link.id), 0);
});

test('pessoas diferentes no mesmo link contam separado', async () => {
  const dono = await createLoginableClient();
  const link = await affiliateLinksRepository.getOrCreateDefault(dono.id);

  await visitar(link.code, { userAgent: 'Mozilla/5.0 (iPhone) Safari/17' });
  await visitar(link.code, { userAgent: 'Mozilla/5.0 (Windows) Firefox/121' });
  await esperarCliques(link.id, 2);

  assert.equal(await contarCliques(link.id), 2);
});

test('codigo inexistente nao quebra a landing nem grava nada', async () => {
  const antes = (await pool.query('SELECT count(*)::int AS n FROM affiliate_link_clicks')).rows[0].n;
  const r = await visitar('NAOEXISTE');
  await new Promise((r2) => setTimeout(r2, 150));
  const depois = (await pool.query('SELECT count(*)::int AS n FROM affiliate_link_clicks')).rows[0].n;

  assert.equal(r.status, 200, 'a landing continua abrindo normalmente');
  assert.equal(depois, antes);
});

test('o afiliado cria, renomeia e arquiva os proprios links pela API', async () => {
  const dono = await createLoginableClient();
  const agente = createAgent(baseUrl);
  await agente.login(dono.email, dono.password);

  const criado = await agente.post('/api/client/commissions/links', { label: 'Bio do TikTok' });
  assert.equal(criado.status, 200);
  assert.equal(criado.body.link.label, 'Bio do TikTok');
  assert.ok(criado.body.link.url.includes(criado.body.link.code));

  const renomeado = await agente.put(`/api/client/commissions/links/${criado.body.link.id}`, { label: 'Bio do Insta' });
  assert.equal(renomeado.body.link.label, 'Bio do Insta');

  const arquivado = await agente.post(`/api/client/commissions/links/${criado.body.link.id}/archive`, { archived: true });
  assert.ok(arquivado.body.link.archivedAt);

  const painel = await agente.get('/api/client/commissions/overview?range=all');
  const naTela = painel.body.links.find((l) => l.id === criado.body.link.id);
  assert.equal(naTela.label, 'Bio do Insta');
  assert.ok(naTela.archivedAt);
});

test('link sem nome e recusado - link sem nome nao responde de onde veio a venda', async () => {
  const dono = await createLoginableClient();
  const agente = createAgent(baseUrl);
  await agente.login(dono.email, dono.password);

  const r = await agente.post('/api/client/commissions/links', { label: '   ' });
  assert.equal(r.status, 400);
});

test('um cliente nao mexe no link de outro pela API (mesmo sabendo o id)', async () => {
  const dono = await createLoginableClient();
  const outro = await createLoginableClient();
  const link = await affiliateLinksRepository.createForOwner(dono.id, { label: 'Do dono' });

  const agente = createAgent(baseUrl);
  await agente.login(outro.email, outro.password);

  assert.equal((await agente.put(`/api/client/commissions/links/${link.id}`, { label: 'Invadido' })).status, 404);
  assert.equal((await agente.post(`/api/client/commissions/links/${link.id}/archive`, { archived: true })).status, 400);

  const { rows } = await pool.query('SELECT label, archived_at FROM affiliate_links WHERE id = $1', [link.id]);
  assert.equal(rows[0].label, 'Do dono');
  assert.equal(rows[0].archived_at, null);
});
