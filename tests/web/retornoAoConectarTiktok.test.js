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

after(() => stopServer());

async function agenteLogado(url) {
  const cliente = await createLoginableClient();
  const agente = createAgent(url);
  await agente.login(cliente.email, cliente.password);
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
