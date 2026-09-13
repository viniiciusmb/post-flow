// Uma Utmify de mentira, levantada na própria máquina.
//
// O que precisa ser provado é o que SAI daqui: quais vendas são enviadas, em
// que ordem, e com que corpo. A API real não acrescentaria nada a isso e
// deixaria o teste refém de rede e de token — além de sujar o painel de vendas
// de verdade do fundador com pedidos inventados.
'use strict';

const http = require('node:http');
const config = require('../../src/config');
const utmifyService = require('../../src/services/utmifyService');

// `resposta` permite simular a Utmify recusando ou caindo: o teste passa uma
// função que devolve { status, body } (ou demora, para provar a ordem).
async function comUtmifyFalsa(fn, { resposta = () => ({ status: 200, body: { ok: true } }) } = {}) {
  const pedidos = [];

  const server = http.createServer((req, res) => {
    let bruto = '';
    req.on('data', (c) => {
      bruto += c;
    });
    req.on('end', async () => {
      const corpo = bruto ? JSON.parse(bruto) : null;
      pedidos.push({ corpo, token: req.headers['x-api-token'] });
      const r = (await resposta(corpo, pedidos)) || { status: 200, body: { ok: true } };
      res.writeHead(r.status || 200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(r.body || {}));
    });
  });

  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();

  const anterior = { ...config.utmify };
  config.utmify.apiToken = 'token-de-teste';
  config.utmify.baseUrlOverride = `http://127.0.0.1:${port}/api-credentials/orders`;

  try {
    return await fn(pedidos);
  } finally {
    // Os envios são soltos de propósito (nunca seguram o pagamento), então o
    // teste precisa esperá-los antes de desligar o servidor — senão o último
    // aviso chegaria num servidor já fechado e o teste ficaria intermitente.
    await utmifyService.aguardarEnvios();
    Object.assign(config.utmify, anterior);
    await new Promise((r) => server.close(r));
  }
}

// Sem token configurado a integração não existe: nenhum envio sai, e nada no
// sistema pode quebrar por causa disso.
async function semUtmify(fn) {
  const anterior = { ...config.utmify };
  config.utmify.apiToken = '';
  config.utmify.baseUrlOverride = '';
  try {
    return await fn();
  } finally {
    await utmifyService.aguardarEnvios();
    Object.assign(config.utmify, anterior);
  }
}

module.exports = { comUtmifyFalsa, semUtmify };
