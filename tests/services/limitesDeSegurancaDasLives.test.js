// Limites de segurança do "Clipar sempre que estiver ao vivo" (14/10/2026).
//
// Um cliente deixou o automático ligado numa live de 9 horas e ela gastou os
// 180 créditos da semana numa noite. Agora o cliente escolhe quando cada live
// para de ser clipada: depois de N horas, de N cortes ou de N% da cota. A live
// seguinte começa do zero, e "Continuar clipando esta live" passa por cima.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const pool = require('../../src/db/pool');
const livesRepository = require('../../src/repositories/livesRepository');
const clientCreditsRepository = require('../../src/repositories/clientCreditsRepository');
const liveCreditosService = require('../../src/services/lives/liveCreditosService');
const liveAnalysisService = require('../../src/services/lives/liveAnalysisService');
const livesUserSettings = require('../../src/services/lives/livesUserSettings');
const { startServer, stopServer, createLoginableClient, createAgent } = require('../helpers/http');
const { darPlano } = require('../helpers/plano');

let url;
test.before(async () => {
  url = await startServer();
});
test.after(async () => {
  await stopServer();
  await pool.end();
});

let n = 0;
async function cenario({ cota = 1000, limites = {} } = {}) {
  const u = await createLoginableClient();
  await clientCreditsRepository.getOrCreate(u.id);
  await pool.query('UPDATE client_credits SET quota_normal = $2, used_normal = 0, extra_normal = 0 WHERE client_user_id = $1', [u.id, cota]);
  const canal = await livesRepository.upsertChannel({ login: `lim_${Date.now().toString(36)}_${n++}`, displayName: 'C', platformUserId: '1', profileImageUrl: null });
  await pool.query("UPDATE live_channels SET is_live = true, last_checked_at = now() + interval '1 hour' WHERE id = $1", [canal.id]);
  await livesRepository.follow(u.id, canal.id);
  await livesRepository.setFollowLimits(u.id, canal.id, { horas: null, cortes: null, pctCota: null, ...limites });
  const sessao = await livesRepository.createSession({ channelId: canal.id, dirPath: '/tmp' });
  return { u, canalId: Number(canal.id), sessaoId: Number(sessao.id), sessao };
}

const gravado = (sessaoId, s) => pool.query('UPDATE live_sessions SET recorded_seconds = $2 WHERE id = $1', [sessaoId, s]);
const uso = (sessaoId, userId) => livesRepository.getCreditUsage(sessaoId, userId);

// Avança a live de 4 em 4 minutos (a cobrança trata salto de mais de 5 min
// como "não estava recebendo").
async function gravarAte(sessaoId, segundos) {
  for (let s = 10; s <= segundos; s += 240) {
    await gravado(sessaoId, s);
    await liveCreditosService.cobrarSessoes();
  }
}

test('limite de horas: a live para de ser clipada (e de cobrar) quando passa de 1 hora', async () => {
  const { u, canalId, sessaoId } = await cenario({ limites: { horas: 1 } });
  await gravarAte(sessaoId, 2 * 3600);
  const linha = await uso(sessaoId, u.id);
  assert.equal(linha.credits_charged, 20, '1 hora = 20 créditos, nem um a mais');
  assert.equal(linha.motivo_limite, 'horas');
  assert.ok(!(await livesRepository.activeFollowerIds(canalId)).includes(Number(u.id)), 'parou de receber cortes desta live');
});

test('limite da cota: metade de uma cota de 90 = 45 créditos nesta live', async () => {
  const { u, sessaoId } = await cenario({ cota: 90, limites: { pctCota: 50 } });
  await gravarAte(sessaoId, 4 * 3600);
  const linha = await uso(sessaoId, u.id);
  assert.equal(linha.credits_charged, 45);
  assert.equal(linha.motivo_limite, 'cota');
});

test('limite de cortes: a distribuição não passa do número escolhido, e a cobrança para', async () => {
  const { u, sessaoId, sessao } = await cenario({ limites: { cortes: 3 } });
  await livesRepository.upsertClipSettings(u.id, { ...livesUserSettings.PADRAO, qualidade: 1 });
  await gravado(sessaoId, 3000);
  for (let i = 0; i < 10; i += 1) {
    const c = await livesRepository.insertCandidate({ sessionId: sessaoId, source: 'triagem', inicio: i * 200, fim: i * 200 + 40 });
    await livesRepository.judgeCandidate(c.id, { status: 'escolhido', nota: 8, inicio: i * 200, fim: i * 200 + 40, titulo: 'x', gancho: '', porque: '' });
  }
  await liveAnalysisService.distribuirSessao({ ...sessao, recorded_seconds: 3000 });
  const { rows } = await pool.query('SELECT count(*)::int AS n FROM live_clips WHERE session_id = $1 AND user_id = $2', [sessaoId, u.id]);
  assert.equal(rows[0].n, 3);
  await liveCreditosService.cobrarSessoes();
  assert.equal((await uso(sessaoId, u.id)).motivo_limite, 'cortes');
});

test('sem limite escolhido, nada para', async () => {
  const { u, sessaoId } = await cenario();
  await gravarAte(sessaoId, 2 * 3600);
  const linha = await uso(sessaoId, u.id);
  assert.equal(linha.parado_por_limite_at, null);
  assert.ok(linha.credits_charged > 20);
});

test('"Continuar clipando esta live": volta a receber e o limite não vale mais nesta live', async () => {
  const { u, canalId, sessaoId } = await cenario({ limites: { horas: 0.5 } });
  await gravarAte(sessaoId, 3600);
  assert.equal((await uso(sessaoId, u.id)).credits_charged, 10);
  assert.ok(await livesRepository.continueDespiteLimits(u.id, canalId));
  assert.ok((await livesRepository.activeFollowerIds(canalId)).includes(Number(u.id)));
  for (let s = 3600 + 240; s <= 2 * 3600; s += 240) {
    await gravado(sessaoId, s);
    await liveCreditosService.cobrarSessoes();
  }
  const linha = await uso(sessaoId, u.id);
  assert.ok(linha.credits_charged > 10, 'seguiu clipando depois do limite');
  assert.equal(linha.parado_por_limite_at, null);
});

// Caso real de 15/10/2026: o limite de 50% da cota parou a live em 45
// créditos; como o cliente era o único recebendo, a gravação foi encerrada, e
// um minuto depois nasceu outra gravação da MESMA live com o contador zerado -
// mais 40 créditos cobrados até alguém perceber.
async function liveComInicio(canalId) {
  await pool.query("UPDATE live_channels SET live_started_at = now() - interval '1 hour' WHERE id = $1", [canalId]);
}
const encerrar = (sessaoId) => livesRepository.endSession(sessaoId, { status: 'encerrada', motivo: 'canal pausado ou removido' });

test('limite vale pela live inteira: encerrar a gravação e começar outra não zera o contador', async () => {
  const { u, canalId, sessaoId } = await cenario({ cota: 90, limites: { pctCota: 50 } });
  await liveComInicio(canalId);
  await gravarAte(sessaoId, 4 * 3600);
  assert.equal((await uso(sessaoId, u.id)).credits_charged, 45);
  await encerrar(sessaoId);

  // Ninguém mais recebe: o canal não pode voltar a ser gravado por causa dele.
  assert.ok(!(await livesRepository.activeFollowerIds(canalId)).includes(Number(u.id)));
  assert.ok(!(await livesRepository.listWatchedChannels()).some((c) => Number(c.id) === canalId));

  // Mesmo que outra gravação da mesma live comece (alguém mais pediu), ela não cobra dele.
  const nova = await livesRepository.createSession({ channelId: canalId, dirPath: '/tmp' });
  await gravarAte(Number(nova.id), 3600);
  assert.equal(await uso(Number(nova.id), u.id), null, 'nenhuma cobrança na gravação nova');
  const { rows } = await pool.query('SELECT used_normal FROM client_credits WHERE client_user_id = $1', [u.id]);
  assert.equal(rows[0].used_normal, 45, 'continua nos 45 do limite');

  // A tela segue mostrando por que parou.
  const tela = (await livesRepository.creditUsageForUser(u.id)).find((x) => Number(x.live_channel_id) === canalId);
  assert.equal(tela.motivo_limite, 'cota');
  assert.equal(tela.credits_charged, 45);
});

test('"Continuar clipando" funciona mesmo com a gravação já encerrada, e a live seguinte começa do zero', async () => {
  const { u, canalId, sessaoId } = await cenario({ cota: 90, limites: { pctCota: 50 } });
  await liveComInicio(canalId);
  await gravarAte(sessaoId, 4 * 3600);
  await encerrar(sessaoId);
  assert.ok(await livesRepository.continueDespiteLimits(u.id, canalId));
  assert.ok((await livesRepository.activeFollowerIds(canalId)).includes(Number(u.id)));
  const nova = await livesRepository.createSession({ channelId: canalId, dirPath: '/tmp' });
  await gravarAte(Number(nova.id), 1800);
  assert.ok((await uso(Number(nova.id), u.id)).credits_charged > 0, 'segue clipando depois de pedir pra continuar');

  // A live acabou (a plataforma apaga o início) e outra começou: limites valem de novo, do zero.
  await encerrar(Number(nova.id));
  // (5 min à frente: as gravações do teste nasceram há segundos, e a folga de
  // 2 min do DA_LIVE_ATUAL as contaria como desta live.)
  await pool.query("UPDATE live_channels SET live_started_at = now() + interval '5 minutes' WHERE id = $1", [canalId]);
  assert.ok((await livesRepository.activeFollowerIds(canalId)).includes(Number(u.id)));
  const totais = await livesRepository.liveUsageTotals(u.id, canalId);
  assert.equal(totais.creditos, 0);
  assert.equal(totais.ignorados, false);
});

test('sem crédito numa gravação encerrada: não recebe até comprar, e volta a receber quando compra', async () => {
  const { u, canalId, sessaoId } = await cenario({ cota: 5 });
  await liveComInicio(canalId);
  await gravarAte(sessaoId, 3600);
  assert.ok((await uso(sessaoId, u.id)).out_of_credit_at);
  await encerrar(sessaoId);
  assert.ok(!(await livesRepository.activeFollowerIds(canalId)).includes(Number(u.id)), 'sem saldo, não reabre a gravação');
  await pool.query('UPDATE client_credits SET extra_normal = 10 WHERE client_user_id = $1', [u.id]);
  assert.ok((await livesRepository.activeFollowerIds(canalId)).includes(Number(u.id)), 'comprou: volta a receber');
});

test('API: ligar o automático com limites grava os limites; valores fora da faixa são recusados', async () => {
  const u = await createLoginableClient();
  await darPlano(u.id, 'max');
  const agent = createAgent(url);
  await agent.login(u.email, u.password);
  const canal = await livesRepository.upsertChannel({ login: `api_${Date.now().toString(36)}`, displayName: 'C', platformUserId: '1', profileImageUrl: null });
  await livesRepository.follow(u.id, canal.id);
  await livesRepository.setPaused(u.id, canal.id, true);

  const ruim = await agent.put(`/api/client/lives/canais/${canal.id}/automatico`, { ligado: true, limites: { horas: 40 } });
  assert.equal(ruim.status, 400);
  assert.ok((await livesRepository.followLimits(u.id, canal.id)).horas === null, 'pedido recusado não grava nada');

  const ok = await agent.put(`/api/client/lives/canais/${canal.id}/automatico`, { ligado: true, limites: { horas: 4, cortes: null, pctCota: 50 } });
  assert.equal(ok.status, 200, ok.text);
  const c = ok.body.canais.find((x) => x.id === Number(canal.id));
  assert.deepEqual(c.limites, { horas: 4, cortes: null, pctCota: 50 });
  assert.equal(c.autoClipar, true);

  // Canal de outra pessoa: não mexe.
  const outro = await createLoginableClient();
  const canalDoOutro = await livesRepository.upsertChannel({ login: `outro_${Date.now().toString(36)}`, displayName: 'O', platformUserId: '2', profileImageUrl: null });
  await livesRepository.follow(outro.id, canalDoOutro.id);
  const invasao = await agent.put(`/api/client/lives/canais/${canalDoOutro.id}/limites`, { horas: 1 });
  assert.equal(invasao.status, 404);
  assert.equal((await livesRepository.followLimits(outro.id, canalDoOutro.id)).horas, null);
});
