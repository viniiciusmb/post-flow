// Custo real por vídeo no histórico do painel de processamento.
//
// O ponto delicado aqui é o REAPROVEITAMENTO: quando dois clientes seguem o
// mesmo canal, só o primeiro paga o download e o Whisper. Se o painel somasse
// esses custos também no segundo, o custo total do sistema apareceria inflado
// e a margem pareceria pior do que é — justamente o contrário do que a
// economia do reaproveitamento pretendia mostrar.
//
// O que estes testes travam:
//   - vídeo reaproveitado aparece com download e transcrição zerados;
//   - o total é a soma das partes, sem contar o que não foi pago;
//   - download por túnel não vira dinheiro (a banda já está paga);
//   - download por proxy pago vira dinheiro proporcional aos bytes;
//   - contagem de cortes e tempo de processamento vêm por vídeo.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const pool = require('../../src/db/pool');
const db = require('../helpers/db');
const settingsRepository = require('../../src/repositories/settingsRepository');
const clipsRepository = require('../../src/repositories/clipsRepository');
const controller = require('../../src/web/controllers/api/adminQueueApiController');

const PRECO_POR_GB = 2; // dólares — número redondo pra conta ficar conferível
const UM_GB = 1024 ** 3;

test.after(async () => {
  await pool.end();
});

async function finalizar(videoId, campos) {
  await pool.query(
    `UPDATE source_videos
     SET status = 'ready',
         processing_started_at = now() - interval '10 minutes',
         updated_at = now(),
         download_egress_type = $2,
         download_bytes = $3,
         whisper_cost_usd = $4,
         claude_cost_usd = $5,
         transcript_reused = $6
     WHERE id = $1`,
    [
      videoId,
      campos.egress,
      campos.bytes,
      campos.whisper,
      campos.claude,
      campos.transcriptReused || false,
    ]
  );
}

// Chama o controller de verdade (SQL incluso) e devolve o JSON.
async function pedirHistorico() {
  let corpo = null;
  await controller.overview(
    {},
    {
      json: (j) => {
        corpo = j;
      },
    }
  );
  return corpo;
}

test('vídeo reaproveitado não é cobrado de novo pelo download nem pela transcrição', async () => {
  await settingsRepository.setValue('custo_banda_por_gb_usd', PRECO_POR_GB);

  const primeiro = await db.createClient({ businessName: 'Quem baixou' });
  const segundo = await db.createClient({ businessName: 'Quem reaproveitou' });

  const videoPago = await db.createSourceVideo(primeiro.id, { title: 'Original' });
  await clipsRepository.createMany(videoPago.id, [
    { title: 'a', startSeconds: 0, endSeconds: 30 },
    { title: 'b', startSeconds: 60, endSeconds: 90 },
  ]);
  await finalizar(videoPago.id, { egress: 'proxy', bytes: UM_GB, whisper: 0.06, claude: 0.02 });

  const videoReaproveitado = await db.createSourceVideo(segundo.id, { title: 'Reaproveitado' });
  await clipsRepository.createMany(videoReaproveitado.id, [{ title: 'a', startSeconds: 0, endSeconds: 30 }]);
  await finalizar(videoReaproveitado.id, {
    egress: 'reuse',
    bytes: 0,
    whisper: 0,
    claude: 0.02,
    transcriptReused: true,
  });

  const corpo = await pedirHistorico();
  const pago = corpo.history.find((v) => v.id === videoPago.id);
  const gratis = corpo.history.find((v) => v.id === videoReaproveitado.id);
  assert.ok(pago && gratis, 'os dois vídeos têm que aparecer no histórico');

  // Quem realmente gastou
  assert.equal(pago.custos.downloadUsd, PRECO_POR_GB, '1 GB pelo proxy pago custa o preço de 1 GB');
  assert.equal(pago.custos.transcricaoUsd, 0.06);
  assert.equal(pago.custos.selecaoUsd, 0.02);
  assert.equal(pago.custos.totalUsd, PRECO_POR_GB + 0.08);
  assert.equal(pago.clipsCount, 2);

  // Quem só aproveitou: paga apenas a própria seleção de cortes
  assert.equal(gratis.custos.downloadUsd, 0, 'o arquivo já estava em disco — não saiu banda nenhuma');
  assert.equal(gratis.custos.transcricaoUsd, 0, 'o Whisper não foi chamado de novo');
  assert.equal(gratis.custos.selecaoUsd, 0.02, 'a seleção de cortes é individual: cada cliente paga a sua');
  assert.equal(gratis.custos.totalUsd, 0.02);
  assert.equal(gratis.clipsCount, 1);

  // A tela precisa saber POR QUE o zero é zero, senão parece dado faltando
  assert.equal(gratis.custos.downloadReaproveitado, true);
  assert.equal(gratis.custos.transcricaoReaproveitada, true);
  assert.equal(pago.custos.downloadReaproveitado, false);
  assert.equal(pago.custos.transcricaoReaproveitada, false);
});

test('banda do túnel não vira dinheiro — ela já está paga na conta de internet', async () => {
  await settingsRepository.setValue('custo_banda_por_gb_usd', PRECO_POR_GB);

  const cliente = await db.createClient();
  const video = await db.createSourceVideo(cliente.id, { title: 'Pelo túnel' });
  await finalizar(video.id, { egress: 'client_tunnel', bytes: 3 * UM_GB, whisper: 0.05, claude: 0.01 });

  const corpo = await pedirHistorico();
  const linha = corpo.history.find((v) => v.id === video.id);
  assert.equal(linha.custos.downloadUsd, 0, 'cobrar aqui inventaria um custo que não existe');
  assert.equal(linha.custos.downloadBytes, 3 * UM_GB, 'os bytes continuam visíveis, só não viram dólares');
  // Comparação com folga: somar centavos em ponto flutuante dá 0.060000000000000005.
  assert.ok(Math.abs(linha.custos.totalUsd - 0.06) < 1e-9);
});

test('sem preço de banda configurado, o download aparece zerado em vez de chutar um valor', async () => {
  await settingsRepository.setValue('custo_banda_por_gb_usd', 0);

  const cliente = await db.createClient();
  const video = await db.createSourceVideo(cliente.id, { title: 'Sem preço' });
  await finalizar(video.id, { egress: 'proxy', bytes: 5 * UM_GB, whisper: 0.04, claude: 0.01 });

  const corpo = await pedirHistorico();
  const linha = corpo.history.find((v) => v.id === video.id);
  assert.equal(linha.custos.downloadUsd, 0);
  assert.equal(linha.custos.totalUsd, 0.05);
});

test('tempo de processamento vem por vídeo, medido do início até o fim', async () => {
  const cliente = await db.createClient();
  const video = await db.createSourceVideo(cliente.id, { title: 'Com tempo' });
  await finalizar(video.id, { egress: 'reuse', bytes: 0, whisper: 0, claude: 0.01 });

  const corpo = await pedirHistorico();
  const linha = corpo.history.find((v) => v.id === video.id);
  assert.ok(linha.processingSeconds >= 590 && linha.processingSeconds <= 610, `esperava ~600s, veio ${linha.processingSeconds}`);
});

test('vídeo que nunca começou a processar mostra tempo vazio, não zero', async () => {
  // Zero seria mentira: "processou em 0 segundos" é diferente de "não tem
  // esse dado", e o painel precisa poder mostrar um traço.
  const cliente = await db.createClient();
  const video = await db.createSourceVideo(cliente.id, { title: 'Erro cedo' });
  await pool.query(`UPDATE source_videos SET status = 'error', error_message = 'falhou' WHERE id = $1`, [video.id]);

  const corpo = await pedirHistorico();
  const linha = corpo.history.find((v) => v.id === video.id);
  assert.equal(linha.processingSeconds, null);
});

test('o painel diz quantos vídeos estão processando agora e qual é o teto', async () => {
  const cliente = await db.createClient();
  const a = await db.createSourceVideo(cliente.id, { title: 'Cortando A' });
  const b = await db.createSourceVideo(cliente.id, { title: 'Cortando B' });
  await pool.query(`UPDATE source_videos SET status = 'cutting' WHERE id = ANY($1)`, [[a.id, b.id]]);

  const corpo = await pedirHistorico();
  const ids = corpo.processing.map((v) => v.id);
  assert.ok(ids.includes(a.id) && ids.includes(b.id), 'com 2 rodando, mostrar só 1 pareceria configuração quebrada');
  assert.equal(typeof corpo.maxSimultaneos, 'number');

  await pool.query(`UPDATE source_videos SET status = 'cancelled' WHERE id = ANY($1)`, [[a.id, b.id]]);
});
