// O limitador de cobrança (20 a cada 10 min) segura ENVIO, não leitura.
//
// Antes ele contava tudo, inclusive a pergunta "já pagou?" que a tela do QR do
// PIX faz a cada 4s: depois de ~80s ela levava 429 calada, e quem pagou no app
// do banco ficava olhando "esperando pagamento" com o plano já ativo. Também
// barrava quem só trocava de aba em "Plano e uso".
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const pool = require('../../src/db/pool');
const { startServer, stopServer, createLoginableClient, createAgent } = require('../helpers/http');

let baseUrl;

test.before(async () => {
  baseUrl = await startServer();
});

test.after(async () => {
  await stopServer();
  await pool.end();
});

test('ler a cobrança não gasta o limite; enviar gasta', async () => {
  const cliente = await createLoginableClient();
  const agent = createAgent(baseUrl);
  await agent.login(cliente.email, cliente.password);

  // Mais que o teto (20), como a tela do QR faria em ~2 minutos.
  for (let i = 0; i < 30; i++) {
    const r = await agent.get('/api/client/billing/overview');
    assert.equal(r.status, 200, `leitura ${i + 1} foi barrada`);
  }

  // Envio continua limitado: um loop acidental aqui cobraria de verdade.
  const statuses = [];
  for (let i = 0; i < 21; i++) {
    statuses.push((await agent.post('/api/client/billing/overage-card/enable', {})).status);
  }
  assert.ok(!statuses.slice(0, 20).includes(429), 'os 20 primeiros envios passam');
  assert.equal(statuses[20], 429, 'o 21º envio é barrado');
});
