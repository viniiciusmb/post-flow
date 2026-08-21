// Clicar num plano na landing e criar a conta tem que terminar no checkout.
//
// É o caminho de venda inteiro: a pessoa escolhe o plano ANTES de ter conta,
// e o checkout só pode abrir depois que a conta existe. Se ela cair no início
// do painel, precisa caçar a tela de planos e escolher tudo de novo — e boa
// parte não caça.
//
// Isso quebrou de verdade: ao ensinar o sistema a lembrar a última página
// visitada, o destino lembrado passou a ter prioridade sobre o plano. Como a
// sessão dura dias, uma página que a pessoa tentou abrir antes sequestrava o
// cadastro inteiro.
//
// O que estes testes travam:
//   - plano escolhido na landing vence o destino lembrado, sempre;
//   - o destino lembrado ainda funciona quando não há plano;
//   - destino lembrado vence o prazo e é descartado.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const pool = require('../../src/db/pool');
const { startServer, stopServer, createLoginableClient, createAgent } = require('../helpers/http');
const servico = require('../../src/services/subscriptionCheckoutService');

let baseUrl;

test.before(async () => {
  baseUrl = await startServer();
});

test.after(async () => {
  await stopServer();
  await pool.end();
});

// Sessão de mentira, só com o que estas decisões leem.
function sessaoCom({ returnTo }) {
  return { session: { returnTo } };
}

test('o plano escolhido vence o destino lembrado', async () => {
  const cliente = await createLoginableClient();

  // Cenário exato do relato: existia um destino guardado de uma visita
  // anterior, e a pessoa clicou em "Assinar" na landing.
  const destino = await servico.destinoDepoisDeEntrar({
    user: { id: cliente.id, role: 'client', email: cliente.email },
    planKey: 'pro',
    origin: 'https://postflowclips.com',
    returnTo: '/client',
  });

  assert.notEqual(destino, '/client', 'o destino lembrado não pode sequestrar o cadastro');
  // Sem provedor de pagamento configurado no teste, o checkout não abre e o
  // sistema cai na tela de planos - que ainda é a tela CERTA (a de escolher e
  // pagar), não o início do painel.
  assert.equal(destino, '/client/billing');
});

test('sem plano escolhido, o destino lembrado continua valendo', async () => {
  const cliente = await createLoginableClient();
  const destino = await servico.destinoDepoisDeEntrar({
    user: { id: cliente.id, role: 'client', email: cliente.email },
    planKey: null,
    origin: 'https://postflowclips.com',
    returnTo: '/client/billing?pacote=sucesso',
  });
  assert.equal(destino, '/client/billing?pacote=sucesso');
});

test('sem plano e sem destino lembrado, vai pro início', async () => {
  const cliente = await createLoginableClient();
  const destino = await servico.destinoDepoisDeEntrar({
    user: { id: cliente.id, role: 'client', email: cliente.email },
    planKey: null,
    origin: 'https://postflowclips.com',
    returnTo: null,
  });
  assert.equal(destino, '/client');
});

test('destino lembrado tem prazo de validade', () => {
  const agora = Date.now();

  const recente = sessaoCom({ returnTo: { url: '/client/billing', em: agora - 60_000 } });
  assert.equal(servico.consumirReturnTo(recente), '/client/billing', 'um minuto atrás ainda vale');

  const velho = sessaoCom({ returnTo: { url: '/client/billing', em: agora - servico.VALIDADE_DO_RETORNO_MS - 1000 } });
  assert.equal(servico.consumirReturnTo(velho), null, 'vencido tem que ser descartado');
});

test('destino é consumido de uma vez só', () => {
  const req = sessaoCom({ returnTo: { url: '/client/billing', em: Date.now() } });
  assert.equal(servico.consumirReturnTo(req), '/client/billing');
  assert.equal(servico.consumirReturnTo(req), null, 'a segunda leitura não pode devolver nada');
});

test('formato antigo (sem carimbo de hora) é descartado', () => {
  // Sessões criadas antes do carimbo existir: não dá pra saber se venceram,
  // e o palpite errado manda a pessoa pra uma página que ela não pediu.
  const req = sessaoCom({ returnTo: '/client/billing' });
  assert.equal(servico.consumirReturnTo(req), null);
});

test('o caminho completo: clicar no plano na landing e cadastrar leva ao checkout', async () => {
  const agente = createAgent(baseUrl);

  // 1) É assim que a landing manda pro cadastro (ver landing.ejs). O plano
  //    entra na sessão aqui, pelo middleware de atribuição.
  const tela = await agente.get('/register?plano=pro');
  assert.equal(tela.status, 200);

  // 2) Cadastro de verdade, pelo mesmo formulário da tela.
  const email = `landing${Date.now()}@teste.local`;
  const cadastro = await agente.post('/register', {
    email,
    password: 'senha-de-teste-123',
    businessName: 'Empresa da Landing',
    acceptedTerms: 'on',
  });

  assert.equal(cadastro.status, 302, `esperava redirecionamento, veio ${cadastro.status}`);
  const destino = cadastro.headers.get('location');

  // O ponto do teste: NÃO pode terminar no início do painel. Ou abre o
  // checkout do provedor, ou cai na tela de planos (quando não há provedor
  // configurado, como neste ambiente de teste) - as duas são a tela de pagar.
  assert.notEqual(destino, '/client', 'terminar no início do painel é o bug que este teste existe pra impedir');
  assert.ok(
    destino === '/client/billing' || /asaas\.com|stripe\.com/.test(destino),
    `destino inesperado: ${destino}`
  );

  // E a conta foi mesmo criada.
  const { rows } = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
  assert.equal(rows.length, 1);
});
