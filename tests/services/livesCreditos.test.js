// Cortes de live no mesmo credito do YouTube (06/10/2026): 3 minutos de live
// clipada = 1 credito, cobrado adiantado de quem recebe cortes; "Clipar este
// momento" = 1 credito. Credito acabou = para de receber (e de manter a
// gravacao ligada).
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const pool = require('../../src/db/pool');
const livesRepository = require('../../src/repositories/livesRepository');
const clientCreditsRepository = require('../../src/repositories/clientCreditsRepository');
const liveCreditosService = require('../../src/services/lives/liveCreditosService');
const { startServer, stopServer, createLoginableClient, createAgent } = require('../helpers/http');

let url;
test.before(async () => {
  url = await startServer();
});
test.after(async () => {
  await stopServer();
  await pool.end();
});

let n = 0;
async function cenario({ role = 'client', cota = 0, avulso = 0, pausado = false } = {}) {
  const u = await createLoginableClient({ role });
  await clientCreditsRepository.getOrCreate(u.id);
  await pool.query('UPDATE client_credits SET quota_normal = $2, used_normal = 0, extra_normal = $3 WHERE client_user_id = $1', [u.id, cota, avulso]);
  const canal = await livesRepository.upsertChannel({ login: `cred_${Date.now().toString(36)}_${n++}`, displayName: 'C', platformUserId: '1', profileImageUrl: null });
  await pool.query("UPDATE live_channels SET is_live = true, last_checked_at = now() + interval '1 hour' WHERE id = $1", [canal.id]);
  await livesRepository.follow(u.id, canal.id);
  if (pausado) await livesRepository.setPaused(u.id, canal.id, true);
  const sessao = await livesRepository.createSession({ channelId: canal.id, dirPath: '/tmp' });
  return { u, canalId: Number(canal.id), sessaoId: Number(sessao.id) };
}

const gravado = (sessaoId, s) => pool.query('UPDATE live_sessions SET recorded_seconds = $2 WHERE id = $1', [sessaoId, s]);
const credito = async (userId) => {
  const c = await clientCreditsRepository.getOrCreate(userId);
  return { usado: Number(c.used_normal), avulso: Number(c.extra_normal) };
};
const uso = (sessaoId, userId) => livesRepository.getCreditUsage(sessaoId, userId);

test('cobra adiantado: 1 credito ao comecar e mais 1 a cada 3 minutos; cota primeiro, depois avulso', async () => {
  const { u, sessaoId } = await cenario({ cota: 2, avulso: 5 });
  await gravado(sessaoId, 10);
  await liveCreditosService.cobrarSessoes();
  assert.deepEqual(await credito(u.id), { usado: 1, avulso: 5 }, 'o primeiro bloco ja sai ao comecar');
  // Mesma volta de novo, mesmo segundo: nao cobra outra vez.
  await liveCreditosService.cobrarSessoes();
  assert.equal((await uso(sessaoId, u.id)).credits_charged, 1);
  // A cobranca conta a partir de quando a pessoa passou a receber (segundo 10):
  // ate o segundo 560 sao 4 blocos de 3 min ([10,190) [190,370) [370,550) [550,730)).
  await gravado(sessaoId, 10 + 120); // 2 min: ainda dentro do bloco pago
  await liveCreditosService.cobrarSessoes();
  for (const s of [250, 370, 560]) {
    await gravado(sessaoId, s);
    await liveCreditosService.cobrarSessoes();
  }
  assert.equal((await uso(sessaoId, u.id)).credits_charged, 4);
  assert.deepEqual(await credito(u.id), { usado: 2, avulso: 3 }, 'esgota a cota (2) e o resto sai do avulso');
});

test('quem so acompanha (automatico desligado, sem "clipar esta live") nao paga nada', async () => {
  const { u, sessaoId } = await cenario({ cota: 10, pausado: true });
  await gravado(sessaoId, 600);
  await liveCreditosService.cobrarSessoes();
  assert.equal(await uso(sessaoId, u.id), null);
  assert.deepEqual(await credito(u.id), { usado: 0, avulso: 0 });
});

test('o tempo em que a pessoa pausou nao e cobrado quando ela volta na mesma live', async () => {
  const { u, canalId, sessaoId } = await cenario({ cota: 20 });
  await gravado(sessaoId, 30);
  await liveCreditosService.cobrarSessoes(); // 1
  await livesRepository.setPaused(u.id, canalId, true);
  await gravado(sessaoId, 30 + 3600); // 1 hora pausado
  await liveCreditosService.cobrarSessoes();
  await livesRepository.setPaused(u.id, canalId, false);
  await liveCreditosService.cobrarSessoes(); // volta: so o bloco de agora
  assert.equal((await uso(sessaoId, u.id)).credits_charged, 2, 'uma hora pausada teria custado 20 creditos');
});

test('credito acabou: para de receber cortes e a gravacao deixa de ser mantida por essa pessoa; comprou, volta', async () => {
  const { u, canalId, sessaoId } = await cenario({ cota: 1 });
  await gravado(sessaoId, 10);
  await liveCreditosService.cobrarSessoes(); // usa o unico credito
  assert.ok((await livesRepository.activeFollowerIds(canalId)).includes(Number(u.id)));
  await gravado(sessaoId, 200);
  await liveCreditosService.cobrarSessoes(); // nao tem o segundo
  assert.ok((await uso(sessaoId, u.id)).out_of_credit_at, 'marca sem credito');
  assert.ok(!(await livesRepository.activeFollowerIds(canalId)).includes(Number(u.id)), 'para de receber cortes');
  assert.ok(!(await livesRepository.followersWithQuality(canalId)).some((f) => f.user_id === Number(u.id)));
  assert.ok(!(await livesRepository.listWatchedChannels()).some((c) => Number(c.id) === canalId), 'sem mais ninguem, o canal nao e mais gravado');

  // Comprou credito avulso no meio da live: volta a receber dali pra frente.
  await clientCreditsRepository.addExtra(u.id, 'normal', 10);
  await gravado(sessaoId, 1800);
  await liveCreditosService.cobrarSessoes(); // libera
  assert.equal((await uso(sessaoId, u.id)).out_of_credit_at, null);
  await liveCreditosService.cobrarSessoes(); // cobra so o bloco atual
  assert.equal((await credito(u.id)).avulso, 9, 'os 26 minutos sem credito nao sao cobrados depois');
});

test('admin e isento: o contador mostra quanto teria custado, sem debitar', async () => {
  const { u, sessaoId } = await cenario({ role: 'admin', cota: 0 });
  for (const seg of [10, 200, 400]) {
    await gravado(sessaoId, seg);
    await liveCreditosService.cobrarSessoes();
  }
  const r = await uso(sessaoId, u.id);
  assert.equal(r.isento, true);
  assert.equal(r.credits_charged, 3);
  assert.equal(r.out_of_credit_at, null, 'admin nunca fica sem credito');
  assert.deepEqual(await credito(u.id), { usado: 0, avulso: 0 });
});

test('clipar este momento: 1 credito no clique; sem credito, 402 e nenhum corte criado', async () => {
  const semSaldo = await cenario({ cota: 0 });
  const comSaldo = await cenario({ cota: 3 });
  for (const c of [semSaldo, comSaldo]) await gravado(c.sessaoId, 300);

  const r1 = await clientCreditsRepository.reserve(semSaldo.u.id, 'normal', 1);
  assert.equal(r1, null);
  const negado = await liveCreditosService.cobrarCliparAgora(semSaldo.u.id);
  assert.equal(negado.ok, false);

  const ok = await liveCreditosService.cobrarCliparAgora(comSaldo.u.id);
  assert.equal(ok.ok, true);
  assert.equal(ok.creditos, 1);
  assert.equal((await credito(comSaldo.u.id)).usado, 1);
  await ok.desfazer();
  assert.equal((await credito(comSaldo.u.id)).usado, 0, 'desfazer devolve o credito');
});

test('a tela mostra o saldo, o gasto da live e o "sem credito"', async () => {
  const { u, canalId, sessaoId } = await cenario({ role: 'admin' });
  const agent = createAgent(url);
  await agent.login(u.email, u.password);
  await gravado(sessaoId, 10);
  await liveCreditosService.cobrarSessoes();
  await gravado(sessaoId, 200);
  await liveCreditosService.cobrarSessoes();
  const r = await agent.get('/api/client/lives');
  assert.equal(r.status, 200);
  assert.equal(r.body.creditos.minutosDeLivePorCredito, 3);
  assert.equal(r.body.creditos.isento, true);
  const canal = r.body.canais.find((c) => c.id === canalId);
  assert.equal(canal.creditosNestaLive, 2);
  assert.equal(canal.semCredito, false);
});

test('a conta: 3 minutos por credito, sempre adiantado', () => {
  assert.equal(liveCreditosService.SEGUNDOS_POR_CREDITO, 180);
  assert.equal(liveCreditosService.creditosDevidos(0, 0), 1);
  assert.equal(liveCreditosService.creditosDevidos(0, 179), 1);
  assert.equal(liveCreditosService.creditosDevidos(0, 180), 2);
  assert.equal(liveCreditosService.creditosDevidos(180, 100), 0);
});
