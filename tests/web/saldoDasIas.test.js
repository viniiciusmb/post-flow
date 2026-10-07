// Saldo das contas de IA na tela de Custos (07/10/2026).
//
// Pedido do fundador: ver o saldo de cada IA e, abaixo de US$ 5, ficar em
// vermelho. O que estes testes travam:
//   - a conta da DeepInfra: credito MENOS o consumo do mes ainda nao faturado
//     (o credito so baixa quando o mes fecha - sem descontar, a tela diria
//     US$ 5,00 com a conta ja gasta);
//   - a estimativa da OpenAI/Anthropic: saldo informado menos o que o Post
//     Flow gastou DEPOIS de informar (gasto de antes nao conta);
//   - o alerta abaixo de US$ 5 e a conta suspensa;
//   - so o admin ve e mexe.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const pool = require('../../src/db/pool');
const config = require('../../src/config');
const saldoDasIas = require('../../src/services/saldoDasIasService');
const gastoDeIa = require('../../src/services/gastoDeIaService');
const { startServer, stopServer, createLoginableClient, createAgent } = require('../helpers/http');

const chavesOriginais = {
  d: config.deepinfra.apiKey,
  g: config.groq.apiKey,
  o: config.openai.apiKey,
  a: config.anthropic.apiKey,
};

let url;

test.before(async () => {
  url = await startServer();
});

test.after(async () => {
  config.deepinfra.apiKey = chavesOriginais.d;
  config.groq.apiKey = chavesOriginais.g;
  config.openai.apiKey = chavesOriginais.o;
  config.anthropic.apiKey = chavesOriginais.a;
  await stopServer();
  await pool.end();
});

test.beforeEach(async () => {
  saldoDasIas._limparCache();
  await pool.query('DELETE FROM ai_gastos');
  await pool.query("DELETE FROM settings WHERE key = 'saldo_ia_informado'");
});

test('DeepInfra: credito menos o consumo do mes que ainda nao foi faturado', () => {
  // O caso real de 07/10/2026: US$ 5 de credito, 5 centavos gastos nos testes.
  const real = saldoDasIas.calcularSaldoDeepinfra(
    { stripe_balance: -5.0, suspended: false },
    { months: [{ period: '2026.10', total_cost: 5, invoice_id: 'INVALID' }] }
  );
  assert.equal(real.saldoUsd, 4.95);
  assert.equal(real.suspenso, false);
  // Mes ja faturado ja saiu do credito: nao desconta de novo.
  const faturado = saldoDasIas.calcularSaldoDeepinfra(
    { stripe_balance: -3.0, suspended: false },
    { months: [{ period: '2026.09', total_cost: 200, invoice_id: 'in_123' }, { period: '2026.10', total_cost: 50, invoice_id: null }] }
  );
  assert.equal(faturado.saldoUsd, 2.5);
});

test('o pedido de consumo cobre o mes passado e o atual (a API devolve um mes so sem o "to")', () => {
  assert.equal(saldoDasIas.periodo(0, new Date('2026-10-07T12:00:00Z')), '2026.10');
  assert.equal(saldoDasIas.periodo(1, new Date('2026-10-07T12:00:00Z')), '2026.09');
  assert.equal(saldoDasIas.periodo(1, new Date('2026-01-15T12:00:00Z')), '2025.12');
});

test('abaixo de US$ 5 fica em alerta; OpenAI estimada desconta so o gasto DEPOIS de informar', async () => {
  config.deepinfra.apiKey = 'di-teste';
  config.groq.apiKey = 'gq-teste';
  config.openai.apiKey = 'oa-teste';
  config.anthropic.apiKey = 'an-teste';

  // Gasto anterior ao saldo informado: ja estava descontado no valor que o
  // admin viu no painel da OpenAI.
  await gastoDeIa.registrar('openai', 'lives', 7);
  await pool.query("UPDATE ai_gastos SET created_at = now() - interval '1 day'");
  await saldoDasIas.informarSaldo('openai', 20);
  await gastoDeIa.registrar('openai', 'lives', 3);
  await gastoDeIa.registrar('anthropic', 'cortes', 1);

  const fetchOriginal = global.fetch;
  global.fetch = async (u) => {
    const s = String(u);
    if (s.includes('/payment/checklist')) return { ok: true, status: 200, json: async () => ({ stripe_balance: -5, suspended: false }) };
    if (s.includes('/payment/usage')) {
      assert.match(s, /from=\d{4}\.\d{2}&to=\d{4}\.\d{2}/);
      return { ok: true, status: 200, json: async () => ({ months: [{ total_cost: 5, invoice_id: 'INVALID' }] }) };
    }
    if (s.includes('groq')) return { ok: true, status: 200, json: async () => ({ data: [] }) };
    throw new Error(`url inesperada ${s}`);
  };
  let r;
  try {
    r = await saldoDasIas.listar();
  } finally {
    global.fetch = fetchOriginal;
  }
  const por = Object.fromEntries(r.provedores.map((p) => [p.provedor, p]));

  assert.equal(por.deepinfra.tipo, 'real');
  assert.equal(por.deepinfra.saldoUsd, 4.95);
  assert.equal(por.deepinfra.abaixoDoLimite, true, 'US$ 4,95 < US$ 5');

  assert.equal(por.groq.tipo, 'gratuito');
  assert.equal(por.groq.chaveOk, true);
  assert.equal(por.groq.abaixoDoLimite, false, 'gratuito nao tem saldo pra acabar');

  assert.equal(por.openai.tipo, 'estimado');
  assert.equal(por.openai.saldoUsd, 17, '20 informados - 3 gastos depois (os 7 de antes nao contam)');
  assert.equal(por.openai.abaixoDoLimite, false);

  assert.equal(por.anthropic.semInformacao, true, 'sem saldo informado, nao inventa numero');
  assert.equal(por.anthropic.saldoUsd, null);
  assert.equal(por.anthropic.abaixoDoLimite, false);

  assert.equal(por.elevenlabs, undefined, 'ElevenLabs sem chave nao aparece');
  assert.equal(r.algumAbaixo, true);
  assert.equal(r.limiteAlertaUsd, 5);
});

test('conta suspensa fica em alerta mesmo com saldo zerado "certinho"', async () => {
  config.deepinfra.apiKey = 'di-teste';
  config.groq.apiKey = '';
  const fetchOriginal = global.fetch;
  global.fetch = async (u) =>
    String(u).includes('checklist')
      ? { ok: true, status: 200, json: async () => ({ stripe_balance: 0, suspended: true }) }
      : { ok: true, status: 200, json: async () => ({ months: [] }) };
  try {
    const r = await saldoDasIas.listar();
    const di = r.provedores.find((p) => p.provedor === 'deepinfra');
    assert.equal(di.suspenso, true);
    assert.equal(di.abaixoDoLimite, true);
  } finally {
    global.fetch = fetchOriginal;
  }
});

test('informar saldo: so para quem nao informa sozinho, e so valor valido', async () => {
  await assert.rejects(() => saldoDasIas.informarSaldo('deepinfra', 10), /informa o saldo sozinho/);
  await assert.rejects(() => saldoDasIas.informarSaldo('openai', -1), /valor em dólar/);
  await assert.rejects(() => saldoDasIas.informarSaldo('openai', 'abc'), /valor em dólar/);
  await saldoDasIas.informarSaldo('anthropic', 12.5);
  const { rows } = await pool.query("SELECT value FROM settings WHERE key = 'saldo_ia_informado'");
  assert.equal(rows[0].value.anthropic.usd, 12.5);
});

test('so o admin ve e informa saldo', async () => {
  // Sem chave de DeepInfra/Groq: a rota nao sai pra internet no teste.
  config.deepinfra.apiKey = '';
  config.groq.apiKey = '';
  config.openai.apiKey = 'oa-teste';

  const cliente = await createLoginableClient();
  const agenteCliente = createAgent(url);
  await agenteCliente.login(cliente.email, cliente.password);
  const negado = await agenteCliente.get('/api/admin/costs/ai-balances');
  assert.equal(negado.status, 403);
  const negadoPost = await agenteCliente.post('/api/admin/costs/ai-balances/openai', { saldoUsd: 999 });
  assert.equal(negadoPost.status, 403);

  const admin = await createLoginableClient({ role: 'admin' });
  const agente = createAgent(url);
  await agente.login(admin.email, admin.password);
  const salvo = await agente.post('/api/admin/costs/ai-balances/openai', { saldoUsd: 3 });
  assert.equal(salvo.status, 200);
  const openai = salvo.body.provedores.find((p) => p.provedor === 'openai');
  assert.equal(openai.saldoUsd, 3);
  assert.equal(openai.abaixoDoLimite, true, 'US$ 3 informados ja nascem em alerta');
  const invalido = await agente.post('/api/admin/costs/ai-balances/openai', { saldoUsd: -5 });
  assert.equal(invalido.status, 400);
});
