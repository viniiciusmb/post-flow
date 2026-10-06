// A renovacao semanal da cota destrava o que estava esperando credito.
//
// Achado na auditoria de 06/10/2026: so compra, pagamento e ajuste do admin
// chamavam o destravamento. O video #2099 ficou em 'aguardando_creditos' de
// 29/09 a 06/10 com 38 min disponiveis na conta, atravessando duas
// renovacoes, porque ninguem mais olhava pra ele.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { pool, createClient, createSourceVideo } = require('../helpers/db');
const clientSubscriptionsRepository = require('../../src/repositories/clientSubscriptionsRepository');
const clientCreditsRepository = require('../../src/repositories/clientCreditsRepository');
const subscriptionPlansRepository = require('../../src/repositories/subscriptionPlansRepository');
const creditWeeklyResetJob = require('../../src/worker/jobs/creditWeeklyResetJob');
const queueService = require('../../src/services/queueService');

// Fila falsa: so anota o que foi enviado. O que se testa aqui e a decisao de
// destravar, nao o pg-boss.
const enviados = [];
queueService.getBoss = async () => ({
  send: async (fila, dados) => {
    enviados.push({ fila, dados });
    return 'job-falso';
  },
});

test.after(async () => {
  await pool.end();
});

async function clienteComCicloVencido() {
  const user = await createClient();
  const planos = await subscriptionPlansRepository.listActive();
  await clientSubscriptionsRepository.setPlan(user.id, planos[0].id);
  await clientCreditsRepository.getOrCreate(user.id);
  await pool.query(
    `UPDATE client_credits SET used_normal = quota_normal, cycle_start_at = now() - interval '8 days' WHERE client_user_id = $1`,
    [user.id]
  );
  return user;
}

async function statusDe(id) {
  const { rows } = await pool.query('SELECT status FROM source_videos WHERE id = $1', [id]);
  return rows[0].status;
}

test('video esperando credito volta pra fila quando a cota renova', async () => {
  const user = await clienteComCicloVencido();
  const video = await createSourceVideo(user.id, { status: 'aguardando_creditos', durationSeconds: 25 * 60 });

  await creditWeeklyResetJob.run();

  assert.equal(await statusDe(video.id), 'detected');
  const desteVideo = enviados.filter((e) => e.fila === 'video-processing' && Number(e.dados.sourceVideoId) === Number(video.id));
  assert.equal(desteVideo.length, 1, 'o video foi mandado pra fila de processamento');
});

test('cliente cujo ciclo ainda nao venceu continua esperando', async () => {
  const user = await clienteComCicloVencido();
  await pool.query(`UPDATE client_credits SET cycle_start_at = now() - interval '2 days' WHERE client_user_id = $1`, [user.id]);
  const video = await createSourceVideo(user.id, { status: 'aguardando_creditos' });

  await creditWeeklyResetJob.run();

  assert.equal(await statusDe(video.id), 'aguardando_creditos');
});
