// Painel de erros do admin.
//
// O valor desta tela depende de duas coisas darem certo: o agrupamento (senão
// vira um log e ninguém lê) e o isolamento (a lista junta falhas de TODOS os
// clientes, então não pode vazar pra nenhum deles). Os dois são testados aqui
// contra o banco de verdade, e o ataque é executado por HTTP.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const pool = require('../../src/db/pool');
const systemErrorsRepository = require('../../src/repositories/systemErrorsRepository');
const errorReportService = require('../../src/services/errorReportService');
const { startServer, stopServer, createLoginableClient, createAgent } = require('../helpers/http');

let baseUrl;

test.before(async () => {
  baseUrl = await startServer();
});

test.after(async () => {
  await stopServer();
  await pool.end();
});

async function limpar() {
  await pool.query('DELETE FROM system_errors');
}

test('o mesmo erro repetido vira UMA linha com contador', async () => {
  await limpar();
  const falha = new Error('yt-dlp saiu com codigo 1: bloqueado');

  for (let i = 0; i < 5; i += 1) {
    await errorReportService.report({
      operation: errorReportService.OPERACOES.VIDEO_PROCESSING,
      entityType: 'source_video',
      entityId: 42,
      error: falha,
    });
  }

  const abertos = await systemErrorsRepository.list({ status: 'abertos' });
  assert.equal(abertos.length, 1, 'cinco ocorrências não podem virar cinco linhas');
  assert.equal(abertos[0].occurrences, 5);
});

test('erros de coisas diferentes ficam separados', async () => {
  await limpar();
  const falha = new Error('mesma mensagem');

  await errorReportService.report({ operation: 'video_processing', entityType: 'source_video', entityId: 1, error: falha });
  await errorReportService.report({ operation: 'video_processing', entityType: 'source_video', entityId: 2, error: falha });
  await errorReportService.report({ operation: 'tiktok_posting', entityType: 'posting', entityId: 1, error: falha });

  const abertos = await systemErrorsRepository.list({ status: 'abertos' });
  assert.equal(abertos.length, 3);
});

test('erro resolvido não bloqueia o registro do mesmo problema voltando', async () => {
  await limpar();
  const dados = { operation: 'channel_check', entityType: 'youtube_channel', entityId: 7, error: new Error('caiu') };

  const primeiro = await errorReportService.report(dados);
  await systemErrorsRepository.resolve(primeiro.id);

  // Semanas depois o mesmo problema volta. Tem que virar uma linha NOVA: somar
  // no registro antigo esconderia que houve uma reincidência.
  const segundo = await errorReportService.report(dados);
  assert.notEqual(Number(segundo.id), Number(primeiro.id));
  assert.equal(segundo.occurrences, 1);

  const abertos = await systemErrorsRepository.list({ status: 'abertos' });
  assert.equal(abertos.length, 1);
});

test('quando a operação volta a funcionar, o erro fecha sozinho', async () => {
  await limpar();
  await errorReportService.report({
    operation: 'channel_check',
    entityType: 'youtube_channel',
    entityId: 99,
    error: new Error('falhou'),
  });
  assert.equal((await systemErrorsRepository.list({ status: 'abertos' })).length, 1);

  await errorReportService.clear('channel_check', 'youtube_channel', 99);
  assert.equal((await systemErrorsRepository.list({ status: 'abertos' })).length, 0);
});

test('mensagem conhecida vira frase em português, e o texto cru fica guardado', async () => {
  await limpar();
  const bruto = 'ERROR: [youtube] abc: Sign in to confirm you are not a bot. Use --cookies-from-browser';
  const registrado = await errorReportService.report({
    operation: 'video_processing',
    entityType: 'source_video',
    entityId: 5,
    error: new Error(bruto),
  });

  assert.match(registrado.message, /robô/);
  assert.ok(registrado.detail.includes('Sign in to confirm'), 'o texto original tem que continuar disponível');
});

test('o detalhe é cortado: stack de erro vem enorme', async () => {
  await limpar();
  const gigante = new Error('estouro');
  gigante.stack = 'x'.repeat(50000);
  const registrado = await errorReportService.report({
    operation: 'outro',
    entityId: 1,
    error: gigante,
  });
  assert.ok(registrado.detail.length <= 8000);
});

test('registrar erro nunca derruba quem chamou, mesmo com o banco fora', async () => {
  await limpar();
  const original = systemErrorsRepository.record;
  systemErrorsRepository.record = async () => {
    throw new Error('banco caiu');
  };
  try {
    // Se isto lançar, uma falha no painel de erros derrubaria a operação que
    // estava só tentando REGISTRAR uma falha - exatamente o pior momento.
    const r = await errorReportService.report({ operation: 'outro', error: new Error('qualquer') });
    assert.equal(r, null);
  } finally {
    systemErrorsRepository.record = original;
  }
});

test('cliente comum não enxerga o painel de erros', async () => {
  await limpar();
  await errorReportService.report({ operation: 'outro', entityId: 1, error: new Error('segredo de outro cliente') });

  const cliente = await createLoginableClient({ role: 'client' });
  const agente = createAgent(baseUrl);
  await agente.login(cliente.email, cliente.password);

  const lista = await agente.get('/api/admin/errors');
  assert.equal(lista.status, 403, 'a lista junta falhas de todos os clientes - não pode vazar');

  const retry = await agente.post('/api/admin/errors/1/retry');
  assert.equal(retry.status, 403);
});

test('sem login, o painel de erros recusa', async () => {
  const anonimo = createAgent(baseUrl);
  const r = await anonimo.get('/api/admin/errors');
  assert.equal(r.status, 401);
});

test('o admin vê a lista e os totais', async () => {
  await limpar();
  await errorReportService.report({ operation: 'video_processing', entityType: 'source_video', entityId: 11, error: new Error('a') });
  await errorReportService.report({ operation: 'video_processing', entityType: 'source_video', entityId: 11, error: new Error('a') });
  await errorReportService.report({ operation: 'backup', error: new Error('b') });

  const admin = await createLoginableClient({ role: 'admin' });
  const agente = createAgent(baseUrl);
  await agente.login(admin.email, admin.password);

  const r = await agente.get('/api/admin/errors');
  assert.equal(r.status, 200);
  assert.equal(r.body.errors.length, 2);
  assert.equal(r.body.counts.abertos, 2);
  assert.equal(r.body.counts.ocorrenciasAbertas, 3, 'o total conta as repetições, não as linhas');

  // O botão só aparece pra operação que dá pra refazer. Backup não dá.
  const backup = r.body.errors.find((e) => e.operation === 'backup');
  assert.equal(backup.canRetry, false);
  const video = r.body.errors.find((e) => e.operation === 'video_processing');
  assert.equal(video.canRetry, true);
});

test('tentar de novo algo que não existe mais não deixa a linha travada', async () => {
  await limpar();
  const erro = await errorReportService.report({
    operation: 'video_processing',
    entityType: 'source_video',
    entityId: 999999, // não existe
    error: new Error('sumiu'),
  });

  const admin = await createLoginableClient({ role: 'admin' });
  const agente = createAgent(baseUrl);
  await agente.login(admin.email, admin.password);

  const r = await agente.post(`/api/admin/errors/${erro.id}/retry`);
  assert.equal(r.status, 409);

  // Se ficasse em "retentando", a tela mostraria pra sempre que tem algo
  // rodando quando não tem nada.
  const depois = await systemErrorsRepository.findById(erro.id);
  assert.equal(depois.status, 'aberto');
});

test('"já resolvi" tira da lista de abertos', async () => {
  await limpar();
  const erro = await errorReportService.report({ operation: 'backup', error: new Error('falhou') });

  const admin = await createLoginableClient({ role: 'admin' });
  const agente = createAgent(baseUrl);
  await agente.login(admin.email, admin.password);

  const r = await agente.post(`/api/admin/errors/${erro.id}/resolve`);
  assert.equal(r.status, 200);
  assert.equal((await systemErrorsRepository.list({ status: 'abertos' })).length, 0);
  assert.equal((await systemErrorsRepository.list({ status: 'resolvidos' })).length, 1);
});
