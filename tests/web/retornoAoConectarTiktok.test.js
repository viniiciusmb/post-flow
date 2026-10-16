// Depois de conectar o TikTok, a pessoa volta pra tela de onde saiu.
//
// Antes caía sempre no Início, mesmo tendo iniciado a conexão na tela de
// Publicação: perdia o lugar e tinha que navegar de volta pra ver a conta que
// acabou de conectar.
//
// O endereço de volta vem da URL, e é por isso que existe lista fechada: aceitar
// o valor cru transformaria o link de conectar num redirecionamento aberto —
// um endereço que começa no nosso domínio e termina em outro site. É o tipo de
// coisa que vira phishing com a nossa cara.
'use strict';

const test = require('node:test');
const { after } = test;
const assert = require('node:assert/strict');
const { startServer, stopServer, createAgent, createLoginableClient } = require('../helpers/http');
const { darPlano } = require('../helpers/plano');
const pool = require('../../src/db/pool');

after(() => stopServer());

async function agenteLogado(url, { plano = 'starter' } = {}) {
  const cliente = await createLoginableClient();
  if (plano) await darPlano(cliente.id, plano);
  const agente = createAgent(url);
  await agente.login(cliente.email, cliente.password);
  agente.cliente = cliente;
  return agente;
}

// O que interessa é PRA ONDE a TikTok vai devolver a pessoa, e isso o servidor
// guarda na sessão no momento em que ela sai daqui. Como não dá pra completar
// o OAuth de verdade num teste, exercitamos o caminho de erro do callback —
// que usa exatamente o mesmo destino guardado.
async function destinoDepoisDeConectar(agente, from) {
  await agente.get(`/auth/tiktok/connect${from ? `?from=${encodeURIComponent(from)}` : ''}`);
  // state inválido: o callback rejeita e redireciona pro destino guardado.
  const r = await agente.get('/auth/tiktok/callback?state=invalido&code=x');
  return r.headers.get('location');
}

test('sai da tela de Publicação e volta pra ela', async () => {
  const url = await startServer();
  const agente = await agenteLogado(url);

  const destino = await destinoDepoisDeConectar(agente, '/client/tiktok-account');

  assert.ok(
    destino.startsWith('/client/tiktok-account'),
    `esperava voltar pra Publicação, foi pra "${destino}"`
  );
});

test('sem origem informada, continua caindo no Início', async () => {
  const url = await startServer();
  const agente = await agenteLogado(url);

  const destino = await destinoDepoisDeConectar(agente, null);

  assert.ok(destino.startsWith('/client?'), `esperava o Início, foi pra "${destino}"`);
});

test('endereço de fora NUNCA vira destino', async () => {
  const url = await startServer();
  const agente = await agenteLogado(url);

  for (const tentativa of [
    'https://site-malicioso.com',
    '//site-malicioso.com',
    '/client/../../etc/passwd',
    'javascript:alert(1)',
    '/client/tiktok-account/../../fora',
  ]) {
    const destino = await destinoDepoisDeConectar(agente, tentativa);
    assert.ok(
      destino.startsWith('/client'),
      `"${tentativa}" escapou e virou destino "${destino}"`
    );
    assert.ok(
      !destino.includes('site-malicioso') && !destino.includes('javascript:'),
      `"${tentativa}" vazou pro destino "${destino}"`
    );
  }
});

// 14-15/10/2026: 31 pessoas sem plano passaram pela tela inteira de
// autorização do TikTok e só na volta souberam que precisavam de um plano.
test('sem plano, nem sai pro TikTok: volta na hora com o aviso', async () => {
  const url = await startServer();
  const agente = await agenteLogado(url, { plano: null });
  const r = await agente.get('/auth/tiktok/connect?from=%2Fclient%2Fsocial');
  const destino = r.headers.get('location');
  assert.ok(destino.startsWith('/client/social?tiktok_error='), `foi pra "${destino}"`);
  assert.match(decodeURIComponent(destino), /plano/);
});

test('sem plano mas com conta já conectada: pode reconectar (vai pro TikTok)', async () => {
  const url = await startServer();
  const agente = await agenteLogado(url, { plano: null });
  await pool.query(
    `INSERT INTO tiktok_accounts (client_user_id, tiktok_open_id, access_token_encrypted, refresh_token_encrypted, token_expires_at)
     VALUES ($1, $2, 'x', 'x', now() + interval '1 day')`,
    [agente.cliente.id, `open_${Date.now()}`]
  );
  const r = await agente.get('/auth/tiktok/connect');
  assert.match(r.headers.get('location'), /tiktok\.com/);
});
