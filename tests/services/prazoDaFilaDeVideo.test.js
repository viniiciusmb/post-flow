// Prazo que o pg-boss dá pra um vídeo terminar de processar.
//
// Falha real de 23/09/2026: com o limite do painel em "2 vídeos ao mesmo
// tempo", havia TRÊS cortando juntos. O prazo padrão do pg-boss é 15 minutos,
// e ao estourar ele não interrompe o handler - só desiste de esperar e libera
// o trabalhador pra buscar o próximo vídeo, enquanto o antigo continua
// renderizando em segundo plano. Com a mediana de 40 minutos por vídeo, 21 dos
// 24 jobs daquela semana tinham sido reentregues aos 15 minutos.
//
// Este teste sobe o pg-boss DE VERDADE: o que importa é o prazo que fica
// gravado no job, e um pg-boss de mentira só confirmaria que chamamos uma
// função.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const pool = require('../../src/db/pool');
const queueService = require('../../src/services/queueService');
const videoScheduler = require('../../src/worker/videoScheduler');

test.after(async () => {
  await queueService.stopBoss();
  await pool.end();
});

// O pg-boss real, com o agendamento e os trabalhadores desligados: só
// queremos as filas configuradas, sem nenhum job rodando de verdade no teste.
async function bossSemTrabalhadores() {
  const real = await queueService.getBoss();
  return new Proxy(real, {
    get(alvo, nome) {
      if (['work', 'offWork', 'schedule'].includes(nome)) return async () => {};
      const valor = alvo[nome];
      return typeof valor === 'function' ? valor.bind(alvo) : valor;
    },
  });
}

async function prazoGravadoEmMinutos(jobId) {
  const { rows } = await pool.query(
    'SELECT extract(epoch FROM expire_in) / 60 AS minutos FROM pgboss.job WHERE id = $1',
    [jobId]
  );
  await pool.query('DELETE FROM pgboss.job WHERE id = $1', [jobId]);
  return Number(rows[0].minutos);
}

test('vídeo enfileirado ganha prazo bem acima do tempo real de processamento', async () => {
  const boss = await bossSemTrabalhadores();
  await videoScheduler.start(boss);

  // Enviado sem opção nenhuma de prazo, igual a todo boss.send do projeto.
  const jobId = await boss.send('video-processing', { sourceVideoId: 0 });
  const minutos = await prazoGravadoEmMinutos(jobId);

  assert.ok(
    minutos >= 180,
    `prazo de ${minutos} min: o vídeo mais longo já medido levou 139, e ao estourar o pg-boss libera ` +
      `a vaga com o vídeo ainda rodando - o limite de vídeos ao mesmo tempo deixa de valer`
  );
});

test('vídeo narrado também', async () => {
  const boss = await bossSemTrabalhadores();
  await videoScheduler.start(boss);

  const jobId = await boss.send('narrated-video', { narratedVideoId: 0 });
  assert.ok((await prazoGravadoEmMinutos(jobId)) >= 180, 'o narrado é "um de cada vez, sempre" só se o prazo segurar');
});
