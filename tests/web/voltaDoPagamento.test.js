// Voltar da tela de pagamento sem estar logado.
//
// Quem paga sai do site e volta por um link do Asaas. Se a sessão não estiver
// ativa naquele navegador (pagou no celular, sessão expirada), a pessoa cai no
// login — e antes ia parar no início, sem nunca chegar onde estava indo. Foi o
// "me levou pra lugar nenhum" relatado ao voltar de um pagamento de verdade.
//
// O que estes testes travam:
//   - a página pedida é lembrada e devolvida depois do login;
//   - o destino é de uso único (um login futuro não repete a página antiga);
//   - endereço externo NUNCA é aceito como destino: seria mandar a pessoa pra
//     fora do site no exato momento em que ela acabou de digitar a senha.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const pool = require('../../src/db/pool');
const { startServer, stopServer, createLoginableClient, createAgent } = require('../helpers/http');
const { destinoSeguro } = require('../../src/web/middleware/requireAuth');

let baseUrl;

test.before(async () => {
  baseUrl = await startServer();
});

test.after(async () => {
  await stopServer();
  await pool.end();
});

test('endereço de fora do site nunca vira destino de retorno', () => {
  assert.equal(destinoSeguro('/client/billing?pacote=sucesso'), '/client/billing?pacote=sucesso');
  assert.equal(destinoSeguro('/client'), '/client');

  // "//site.com" e "https://site.com" são lidos pelo navegador como OUTRO
  // domínio - aceitá-los mandaria a pessoa pra fora logo após o login.
  assert.equal(destinoSeguro('//evil.com/roubo'), null);
  assert.equal(destinoSeguro('https://evil.com'), null);
  assert.equal(destinoSeguro('http://evil.com'), null);
  assert.equal(destinoSeguro(''), null);
  assert.equal(destinoSeguro(null), null);
  assert.equal(destinoSeguro(undefined), null);
});

test('quem volta do pagamento sem sessão é devolvido à página certa após o login', async () => {
  const cliente = await createLoginableClient();
  const agente = createAgent(baseUrl);

  // Chega pela URL de retorno do Asaas, ainda sem sessão.
  const bloqueado = await agente.get('/client/billing?pacote=sucesso');
  assert.equal(bloqueado.status, 302);
  assert.equal(bloqueado.headers.get('location'), '/login');

  const entrada = await agente.post('/api/auth/login', { email: cliente.email, password: cliente.password });
  assert.equal(entrada.status, 200);
  assert.equal(
    entrada.body.redirectTo,
    '/client/billing?pacote=sucesso',
    'tem que voltar pra onde a pessoa estava indo, com o marcador de pagamento'
  );
});

test('o destino é de uso único', async () => {
  const cliente = await createLoginableClient();
  const agente = createAgent(baseUrl);

  await agente.get('/client/billing?pacote=sucesso');
  const primeiro = await agente.post('/api/auth/login', { email: cliente.email, password: cliente.password });
  assert.equal(primeiro.body.redirectTo, '/client/billing?pacote=sucesso');

  // Novo login, sem ter pedido página nenhuma: vai pro início.
  const outroAgente = createAgent(baseUrl);
  const segundo = await outroAgente.post('/api/auth/login', { email: cliente.email, password: cliente.password });
  assert.equal(segundo.body.redirectTo, '/client');
});
