// Tempo típico de processamento.
//
// Esse número vira a estimativa de "faltam ~X" que o cliente lê enquanto o
// vídeo processa. Ele era uma MÉDIA simples, e média quebra com um único caso
// extremo: quando o vídeo #1838 ficou 22h preso em "cutting" (o worker morreu
// no meio), a média subiu tanto que a tela passou a prometer "faltam ~16h"
// para todo mundo. Agora é mediana com descarte de travamento.
//
// pipelineHealthSince é uma métrica GLOBAL (do admin, sobre todos os
// clientes), então estes testes se isolam por janela de tempo: os vídeos são
// criados numa data antiga e a consulta pergunta só por aquele intervalo, sem
// alcançar o que os outros arquivos de teste criam com data de agora.
'use strict';

const test = require('node:test');
const assert = require('node:assert');

const metricsRepository = require('../../src/repositories/metricsRepository');
const { pool, createClient, closePool } = require('../helpers/db');

test.after(() => closePool());

let janelaOffsetDias = 0;

// Devolve uma janela de tempo exclusiva deste teste (dias diferentes a cada
// chamada), pra dois testes deste arquivo também não se atrapalharem.
function janelaExclusiva() {
  janelaOffsetDias += 1;
  const dias = 200 + janelaOffsetDias * 5;
  const inicio = new Date(Date.now() - dias * 24 * 3600 * 1000);
  const fim = new Date(inicio.getTime() + 24 * 3600 * 1000);
  return { dias, inicio, fim };
}

async function videoConcluido(clientUserId, dias, segundos, { status = 'ready' } = {}) {
  await pool.query(
    `INSERT INTO source_videos (title, status, input_type, client_user_id, owner_client_user_id,
                                created_at, processing_started_at, updated_at)
     VALUES ('video de teste', $2, 'manual', $1, $1,
             now() - ($3 || ' days')::interval + interval '1 hour',
             now() - ($3 || ' days')::interval + interval '1 hour',
             now() - ($3 || ' days')::interval + interval '1 hour' + ($4 || ' seconds')::interval)`,
    [clientUserId, status, String(dias), String(segundos)]
  );
}

test('um vídeo travado por horas não contamina o tempo típico', async () => {
  const cliente = await createClient();
  const { dias, inicio, fim } = janelaExclusiva();

  // Quatro vídeos normais de ~5 minutos...
  for (const s of [280, 300, 320, 300]) await videoConcluido(cliente.id, dias, s);
  // ...e um que ficou 22 horas preso antes de alguém destravar na mão.
  await videoConcluido(cliente.id, dias, 22 * 60 * 60);

  const saude = await metricsRepository.pipelineHealthSince(inicio, fim);

  assert.ok(
    saude.avgProcessingSeconds !== null && saude.avgProcessingSeconds < 600,
    `o tempo típico deveria ficar perto de 5 min, veio ${saude.avgProcessingSeconds}s. ` +
      'Se isso falhar, a tela do cliente volta a prometer "faltam ~16h".'
  );
});

test('sem nenhum vídeo concluído, o tempo típico é nulo (e não zero)', async () => {
  // Zero seria mentira: significaria "termina agora". Nulo faz o frontend cair
  // no valor padrão em vez de exibir uma promessa falsa.
  const { inicio, fim } = janelaExclusiva();
  const saude = await metricsRepository.pipelineHealthSince(inicio, fim);
  assert.strictEqual(saude.avgProcessingSeconds, null);
  assert.strictEqual(saude.totalFinished, 0);
});

test('a taxa de erro conta apenas vídeos que terminaram', async () => {
  const cliente = await createClient();
  const { dias, inicio, fim } = janelaExclusiva();

  await videoConcluido(cliente.id, dias, 300);
  await videoConcluido(cliente.id, dias, 300);
  await videoConcluido(cliente.id, dias, 300, { status: 'error' });
  // Um em andamento não pode entrar na conta: ainda não deu certo nem errado.
  await pool.query(
    `INSERT INTO source_videos (title, status, input_type, client_user_id, owner_client_user_id, created_at)
     VALUES ('ainda cortando', 'cutting', 'manual', $1, $1, now() - ($2 || ' days')::interval + interval '1 hour')`,
    [cliente.id, String(dias)]
  );

  const saude = await metricsRepository.pipelineHealthSince(inicio, fim);
  assert.strictEqual(saude.totalFinished, 3, 'o vídeo em andamento não pode entrar na conta');
  assert.ok(Math.abs(saude.errorRate - 1 / 3) < 0.001, `esperava 1/3, veio ${saude.errorRate}`);
});
