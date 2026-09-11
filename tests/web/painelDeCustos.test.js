// Painel de custo do admin: total, custo por minuto e margem por plano,
// funcionando em CADA filtro de período (pedido explícito do fundador).
//
// O filtro é onde um painel de custo engana com mais facilidade: um período
// que pega o lançamento errado faz o número parecer plausível e estar errado.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const pool = require('../../src/db/pool');
const custoService = require('../../src/services/custoService');
const { createSourceVideo } = require('../helpers/db');
const { startServer, stopServer, createLoginableClient, createAgent } = require('../helpers/http');

let url;

test.before(async () => {
  url = await startServer();
});
test.after(async () => {
  await stopServer();
  await pool.end();
});

async function adminLogado() {
  const admin = await createLoginableClient({ role: 'admin' });
  const agent = createAgent(url);
  await agent.login(admin.email, admin.password);
  return { admin, agent };
}

// Lançamento com data escolhida, pra poder cair em "ontem" ou "hoje" de
// propósito. O carimbo é montado no fuso de Brasília (o mesmo que o filtro
// usa) - calcular em UTC faria o teste falhar só entre 21h e meia-noite.
async function lancamento(clientUserId, { diasAtras = 0, whisperUsd = 0.1, segundos = 600 } = {}) {
  const video = await createSourceVideo(clientUserId, { durationSeconds: segundos });
  await custoService.registrarTranscricao({ ...video, owner_client_user_id: clientUserId }, { custoUsd: whisperUsd });
  if (diasAtras > 0) {
    await pool.query(
      `UPDATE video_costs SET occurred_at = (now() AT TIME ZONE 'America/Sao_Paulo' - ($2 || ' days')::interval - interval '3 hours')
         AT TIME ZONE 'America/Sao_Paulo'
       WHERE source_video_id = $1`,
      [video.id, diasAtras]
    );
  }
  return video;
}

test('o painel responde com total, custo por minuto e margem por plano', async () => {
  const { admin, agent } = await adminLogado();
  await lancamento(admin.id, { whisperUsd: 0.24, segundos: 2400 });

  const r = await agent.get('/api/admin/costs?range=today');

  assert.equal(r.status, 200, r.text);
  assert.ok(r.body.resumo.totalUsd >= 0.24, `total veio ${r.body.resumo.totalUsd}`);
  assert.ok(r.body.resumo.usdPorMinutoNovo > 0, 'sem custo por minuto o painel nao responde a pergunta principal');
  assert.ok(Array.isArray(r.body.margens) && r.body.margens.length > 0, 'faltou a margem por plano');
  for (const m of r.body.margens) {
    assert.ok(m.minutosMes > 0, `plano ${m.key} sem cota mensal`);
    assert.ok(m.custoBrl !== null, `plano ${m.key} sem custo calculado`);
  }
});

test('cada filtro de periodo mostra o custo daquele periodo', async () => {
  const { admin, agent } = await adminLogado();
  await lancamento(admin.id, { diasAtras: 0, whisperUsd: 0.11 });
  await lancamento(admin.id, { diasAtras: 1, whisperUsd: 0.22 });
  await lancamento(admin.id, { diasAtras: 20, whisperUsd: 0.44 });

  const meu = (body) => body.porCliente.find((c) => c.clientUserId === Number(admin.id));

  const hoje = meu((await agent.get('/api/admin/costs?range=today')).body);
  const ontem = meu((await agent.get('/api/admin/costs?range=yesterday')).body);
  const sete = meu((await agent.get('/api/admin/costs?range=last7days')).body);
  const tudo = meu((await agent.get('/api/admin/costs?range=all')).body);

  assert.ok(Math.abs(hoje.totalUsd - 0.11) < 0.0001, `hoje: ${hoje.totalUsd}`);
  assert.ok(Math.abs(ontem.totalUsd - 0.22) < 0.0001, `ontem: ${ontem.totalUsd}`);
  // 7 dias inclui hoje e ontem, mas não o de 20 dias atrás.
  assert.ok(Math.abs(sete.totalUsd - 0.33) < 0.0001, `7 dias: ${sete.totalUsd}`);
  assert.ok(Math.abs(tudo.totalUsd - 0.77) < 0.0001, `tudo: ${tudo.totalUsd}`);
});

test('intervalo escolhido a mao tambem filtra', async () => {
  const { admin, agent } = await adminLogado();
  await lancamento(admin.id, { diasAtras: 0, whisperUsd: 0.13 });
  await lancamento(admin.id, { diasAtras: 10, whisperUsd: 0.31 });

  const hoje = new Date().toISOString().slice(0, 10);
  const r = await agent.get(`/api/admin/costs?range=custom&since=${hoje}&until=${hoje}`);
  const meu = r.body.porCliente.find((c) => c.clientUserId === Number(admin.id));

  assert.equal(r.status, 200, r.text);
  assert.ok(Math.abs(meu.totalUsd - 0.13) < 0.0001, `custom de hoje: ${meu.totalUsd}`);
});

test('cliente comum nao ve o painel de custo', async () => {
  const cliente = await createLoginableClient();
  const agent = createAgent(url);
  await agent.login(cliente.email, cliente.password);

  const r = await agent.get('/api/admin/costs?range=today');

  assert.ok(r.status === 403 || r.status === 401, `status inesperado: ${r.status}`);
});
