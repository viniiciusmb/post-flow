// Um vídeo nunca pode ser processado por dois jobs ao mesmo tempo.
//
// Aconteceu de verdade em 01/09/2026 com o vídeo #1965. A sequência:
//
//   20:30:19  "Retry automatico do video-fonte 1965 (tentativa 1/3)"
//   20:30:19  "Video-fonte 1965 estava preso em 'detected' ha mais de 30min"
//   20:30:21  "Processando video-fonte #1965..."   ← duas vezes
//   20:33:08  ENOENT: unlink '/tmp/post-flow-video/1965/audio.mp3'
//
// O retry automático devolvia o vídeo para "detected" e o enfileirava; três
// linhas depois, no MESMO run do job, a varredura de "preso em detected" pegava
// esse mesmo vídeo e enfileirava de novo. Os dois processaram juntos e um
// apagou o áudio que o outro estava usando.
//
// A causa era a varredura medir a idade por `created_at`: um vídeo cadastrado
// dias atrás que acabou de VOLTAR para "detected" contava como parado há dias.
//
// Duas trancas independentes, e este arquivo trava as duas.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const pool = require('../../src/db/pool');
const sourceVideosRepository = require('../../src/repositories/sourceVideosRepository');
const { createClient, createSourceVideo } = require('../helpers/db');

test.after(async () => {
  await pool.end();
});

// --- 1. A varredura de "preso em detected" ---

test('vídeo que acabou de voltar pra "detected" NÃO conta como preso', async () => {
  const cliente = await createClient();
  const video = await createSourceVideo(cliente.id, { status: 'detected' });

  // Cadastrado dias atrás (é o caso do #1965: ele era de 31/08), mas o estado
  // mudou agora mesmo — foi o retry automático que acabou de reenfileirá-lo.
  await pool.query(
    "UPDATE source_videos SET created_at = now() - interval '3 days', updated_at = now() WHERE id = $1",
    [video.id]
  );

  const presos = await sourceVideosRepository.findStuckDetected();
  assert.ok(
    !presos.some((v) => Number(v.id) === Number(video.id)),
    'a varredura pegou um vídeo que acabou de ser enfileirado — é o segundo job que apagou o áudio do primeiro'
  );
});

test('vídeo realmente esquecido em "detected" continua sendo resgatado', async () => {
  // A proteção precisa continuar existindo: ela cobre o caso raro do
  // enfileiramento falhar em silêncio entre a detecção e o processamento.
  const cliente = await createClient();
  const video = await createSourceVideo(cliente.id, { status: 'detected' });
  await pool.query(
    "UPDATE source_videos SET created_at = now() - interval '3 days', updated_at = now() - interval '2 hours' WHERE id = $1",
    [video.id]
  );

  const presos = await sourceVideosRepository.findStuckDetected();
  assert.ok(
    presos.some((v) => Number(v.id) === Number(video.id)),
    'vídeo parado de verdade tem que ser resgatado, senão ele nunca começa'
  );
});

// --- 2. A posse atômica ---

test('só UM job consegue tomar posse do vídeo', async () => {
  const cliente = await createClient();
  const video = await createSourceVideo(cliente.id, { status: 'detected' });

  // Dez jobs chegando ao mesmo tempo — como os dois de 01/09, mas pior.
  const tentativas = await Promise.all(
    Array.from({ length: 10 }, () => sourceVideosRepository.claimForProcessing(video.id))
  );

  const venceram = tentativas.filter(Boolean);
  assert.equal(
    venceram.length,
    1,
    `${venceram.length} jobs tomaram posse do mesmo vídeo — dois processando juntos apagam os arquivos um do outro`
  );
});

test('vídeo pausado pode ser retomado, e continua pausado até o job assumir', async () => {
  const cliente = await createClient();
  const video = await createSourceVideo(cliente.id, { status: 'paused' });

  const posse = await sourceVideosRepository.claimForProcessing(video.id);
  assert.ok(posse, 'retomar uma pausa é um começo legítimo');
  assert.equal(posse.status, 'paused', 'retomar não pode jogar fora o que já foi feito');
});

test('vídeo que já está rodando não é tomado por ninguém', async () => {
  for (const status of ['downloading', 'transcribing', 'cutting', 'ready', 'error', 'somente_membros']) {
    const cliente = await createClient();
    const video = await createSourceVideo(cliente.id, { status });
    const posse = await sourceVideosRepository.claimForProcessing(video.id);
    assert.equal(posse, null, `um job conseguiu assumir um vídeo em "${status}"`);
  }
});

test('vídeo com sinal de vida antigo pode ser retomado', async () => {
  // O worker morreu no meio (deploy, reinício): o coração parou de bater e o
  // vídeo voltou pra "detected". Ele PRECISA poder recomeçar, senão a trava
  // contra duplicação vira uma trava contra processar.
  const cliente = await createClient();
  const video = await createSourceVideo(cliente.id, { status: 'detected' });
  await pool.query(
    "UPDATE source_videos SET processing_heartbeat_at = now() - interval '1 hour' WHERE id = $1",
    [video.id]
  );

  const posse = await sourceVideosRepository.claimForProcessing(video.id);
  assert.ok(posse, 'sinal de vida velho não pode impedir o vídeo de recomeçar');
});
