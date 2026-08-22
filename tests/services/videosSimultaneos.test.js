// Quantos vídeos o sistema processa ao mesmo tempo.
//
// O risco desta função não é ela não funcionar — é ela TRAVAR A FILA. Duas
// armadilhas concretas:
//
//   1. `batchSize` do pg-boss entrega N jobs ao mesmo handler e só busca os
//      próximos quando TODOS terminam: um vídeo de 5 minutos ficaria preso
//      esperando um de 60 da mesma leva. Por isso são N trabalhadores
//      independentes, cada um com o seu job.
//   2. Trocar o número sem desligar os trabalhadores antigos acumularia
//      trabalhadores a cada troca — pedir 2 depois de 3 deixaria 5 rodando.
//
// O que estes testes travam:
//   - N trabalhadores independentes, com batchSize 1;
//   - trocar o número desliga os antigos antes de ligar os novos;
//   - número inválido é recusado em vez de virar 0 (que pararia tudo);
//   - o valor sobrevive no banco e é lido de volta.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const pool = require('../../src/db/pool');
const servico = require('../../src/services/videoConcurrencyService');
const settingsRepository = require('../../src/repositories/settingsRepository');

test.after(async () => {
  await pool.end();
});

test('número inválido é recusado - nunca vira 0, que pararia o processamento', async () => {
  assert.equal(servico.normalizar(0), null);
  assert.equal(servico.normalizar(-1), null);
  assert.equal(servico.normalizar(1.5), null);
  assert.equal(servico.normalizar('abc'), null);
  assert.equal(servico.normalizar(999), null, 'acima do teto a disputa por CPU derruba a vazão');
  assert.equal(servico.normalizar(1), 1);
  assert.equal(servico.normalizar(8), 8);
});

test('o valor escolhido sobrevive no banco', async () => {
  assert.equal(await servico.definir(3), 3);
  assert.equal(await servico.obter(), 3);

  assert.equal(await servico.definir(1), 1);
  assert.equal(await servico.obter(), 1);
});

test('valor corrompido no banco não para o processamento', async () => {
  // Se alguém editar a configuração na mão e puser lixo, o pior resultado
  // possível seria o sistema parar de processar em silêncio.
  await settingsRepository.setValue(servico.CHAVE, 'nao-e-numero');
  assert.equal(await servico.obter(), servico.PADRAO);
  await settingsRepository.setValue(servico.CHAVE, 0);
  assert.equal(await servico.obter(), servico.PADRAO);
  await servico.definir(1);
});

// ---------- registro dos trabalhadores ----------

// pg-boss de mentira que anota o que foi pedido.
function bossFalso() {
  const registros = [];
  let desligamentos = 0;
  return {
    registros,
    get desligamentos() {
      return desligamentos;
    },
    createQueue: async () => {},
    schedule: async () => {},
    work: async (fila, opcoes) => {
      registros.push({ fila, opcoes });
    },
    offWork: async () => {
      desligamentos += 1;
      registros.length = 0;
    },
  };
}

test('pedir 3 registra 3 trabalhadores independentes, com batchSize 1', async () => {
  await servico.definir(3);
  const boss = bossFalso();
  const { aplicarConcorrenciaParaTeste } = require('../../src/worker/videoScheduler');

  await aplicarConcorrenciaParaTeste(boss, { reiniciar: true });

  const daFila = boss.registros.filter((r) => r.fila === 'video-processing');
  assert.equal(daFila.length, 3, 'tem que haver um trabalhador por vídeo simultâneo');
  for (const r of daFila) {
    assert.equal(r.opcoes.batchSize, 1, 'com lote, o vídeo rápido fica preso esperando o lento');
  }
});

test('trocar o número desliga os antigos antes de ligar os novos', async () => {
  const boss = bossFalso();
  const { aplicarConcorrenciaParaTeste } = require('../../src/worker/videoScheduler');

  await servico.definir(2);
  await aplicarConcorrenciaParaTeste(boss, { reiniciar: true });
  assert.equal(boss.registros.length, 2);

  await servico.definir(4);
  await aplicarConcorrenciaParaTeste(boss);
  assert.equal(boss.desligamentos, 1, 'sem desligar, os trabalhadores se acumulariam a cada troca');
  assert.equal(boss.registros.length, 4);

  await servico.definir(1);
});

test('aplicar sem mudança não mexe em nada', async () => {
  const boss = bossFalso();
  const { aplicarConcorrenciaParaTeste } = require('../../src/worker/videoScheduler');

  await servico.definir(2);
  await aplicarConcorrenciaParaTeste(boss, { reiniciar: true });
  const antes = boss.desligamentos;

  await aplicarConcorrenciaParaTeste(boss);
  assert.equal(boss.desligamentos, antes, 'reaplicar o mesmo número não pode derrubar quem está trabalhando');
  assert.equal(boss.registros.length, 2);

  await servico.definir(1);
});
