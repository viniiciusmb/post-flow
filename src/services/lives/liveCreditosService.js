// Cortes de live consumindo o MESMO credito dos cortes do YouTube (decisao do
// fundador, 06/10/2026): 3 minutos de live clipada = 1 credito; "Clipar este
// momento" = 1 credito por clique. Plano e numeros: docs/PLANO_DE_CREDITOS_LIVES.md.
//
// Como cobra (cobrarSessoes, a cada minuto no liveSupervisor):
//  - so quem esta RECEBENDO cortes daquela gravacao (automatico ligado ou
//    "clipar esta live") - canal so acompanhado nao gasta nada;
//  - ADIANTADO, de 3 em 3 minutos: ao comecar a receber ja sai 1 credito, que
//    cobre os proximos 3 minutos;
//  - o tempo em que a pessoa NAO estava recebendo (pausou e voltou na mesma
//    live) nao e cobrado;
//  - acabou o credito: a pessoa para de receber cortes daquela live
//    (out_of_credit_at, ver RECEBE_CORTES no livesRepository). Se mais
//    ninguem recebe, a gravacao para na volta seguinte do supervisor. Comprou
//    credito, volta sozinha a receber dali pra frente.
//
// Usa o debito atomico que ja existia (clientCreditsRepository.consumeUpTo,
// testado contra concorrencia): primeiro a cota da semana, depois o avulso.
// Sempre o bolso "normal" - live nao passa pelo tunel do cliente.
'use strict';

const livesRepository = require('../../repositories/livesRepository');
const clientCreditsRepository = require('../../repositories/clientCreditsRepository');
const usersRepository = require('../../repositories/usersRepository');
const { ROLES } = require('../../config/constants');
const logger = require('../../lib/logger');
const errorReportService = require('../errorReportService');

const SEGUNDOS_POR_CREDITO = 180; // 3 minutos de live = 1 credito
const CREDITOS_CLIPAR_AGORA = 1;
// Mais que isso sem a volta passar por ela = a pessoa nao estava recebendo
// (pausou, desligou, ficou sem credito): o buraco nao e cobrado. Folga de
// sobra pra uma volta atrasada do supervisor nao virar "buraco".
const BURACO_S = 300;

async function isento(userId) {
  const u = await usersRepository.findById(userId);
  return Boolean(u && u.role === ROLES.ADMIN);
}

// Quantos creditos faltam pagar pra cobrir ate "segundo" (adiantado: cobre
// sempre o bloco em que a gravacao esta).
function creditosDevidos(pagoAte, segundo) {
  if (segundo < pagoAte) return 0;
  return Math.floor((segundo - pagoAte) / SEGUNDOS_POR_CREDITO) + 1;
}

// Saldo que pode ser gasto agora: o que sobra da cota da semana + avulso.
async function saldo(userId) {
  const c = await clientCreditsRepository.getOrCreate(userId);
  return Math.max(Number(c.quota_normal) - Number(c.used_normal), 0) + Number(c.extra_normal);
}

async function cobrarUm({ sessao, userId, segundo, ehIsento }) {
  let uso =
    (await livesRepository.getCreditUsage(sessao.id, userId)) ||
    (await livesRepository.startCreditUsage({ sessionId: sessao.id, userId, channelId: sessao.live_channel_id, segundo, isento: ehIsento }));
  const pagoAntes = Number(uso.paid_until_seconds);
  let pagoAte = pagoAntes;
  // Nao estava recebendo desde a ultima volta: recomeca a contar de agora.
  if (segundo - Number(uso.last_seen_seconds) > BURACO_S) pagoAte = Math.max(pagoAte, segundo);
  const devidos = creditosDevidos(pagoAte, segundo);
  let pagos = devidos;
  let semCredito = false;
  let consumo = null;
  if (devidos > 0 && !ehIsento) {
    consumo = await clientCreditsRepository.consumeUpTo(userId, 'normal', devidos);
    pagos = consumo.minutesFromQuota + consumo.minutesFromExtra;
    semCredito = consumo.minutesUncovered > 0;
  }
  const gravou = await livesRepository.advanceCreditUsage({
    sessionId: sessao.id,
    userId,
    paidUntilAntes: pagoAntes,
    paidUntil: pagoAte + pagos * SEGUNDOS_POR_CREDITO,
    lastSeen: segundo,
    creditos: pagos,
    semCredito,
  });
  if (!gravou && consumo && pagos > 0) {
    // Outra volta mexeu na linha no meio: devolve o que foi tirado agora.
    await clientCreditsRepository.release(userId, 'normal', consumo);
    return 0;
  }
  if (semCredito) logger.info(`Lives: usuario ${userId} ficou sem credito na sessao ${sessao.id} - para de receber cortes dela.`);
  return pagos;
}

// Uma volta: cobra quem esta recebendo e devolve a quem voltou a ter credito.
async function cobrarSessoes() {
  let total = 0;
  for (const sessao of await livesRepository.listRecordingSessions()) {
    const segundo = Number(sessao.recorded_seconds);
    for (const userId of await livesRepository.activeFollowerIds(sessao.live_channel_id)) {
      try {
        total += await cobrarUm({ sessao, userId, segundo, ehIsento: await isento(userId) });
      } catch (err) {
        logger.error(`Lives: cobranca de credito do usuario ${userId} na sessao ${sessao.id} falhou:`, err.message);
        await errorReportService.report({
          operation: errorReportService.OPERACOES.LIVES,
          entityType: 'live_sessao',
          entityId: sessao.id,
          clientUserId: userId,
          error: err,
          message: `Cobrança de crédito da live falhou: ${String(err.message).slice(0, 200)}`,
          contexto: { etapa: 'cobrar_credito', sessao: sessao.id, canal: sessao.live_channel_id, segundoDaGravacao: segundo },
        });
      }
    }
  }
  for (const uso of await livesRepository.outOfCreditInRecordingSessions()) {
    try {
      if ((await saldo(uso.user_id)) >= 1) {
        await livesRepository.clearOutOfCredit(uso.session_id, uso.user_id, Number(uso.recorded_seconds));
        logger.info(`Lives: usuario ${uso.user_id} voltou a ter credito - volta a receber cortes da sessao ${uso.session_id}.`);
      }
    } catch (err) {
      logger.error(`Lives: conferir credito do usuario ${uso.user_id} falhou:`, err.message);
      await errorReportService.report({
        operation: errorReportService.OPERACOES.LIVES,
        entityType: 'live_sessao',
        entityId: uso.session_id,
        clientUserId: uso.user_id,
        error: err,
        message: `Conferir se o cliente voltou a ter crédito falhou: ${String(err.message).slice(0, 200)}`,
        contexto: { etapa: 'conferir_credito', sessao: uso.session_id },
      });
    }
  }
  return total;
}

// "Clipar este momento": cobra no clique. Devolve { ok, creditos } ou
// { ok: false } sem ter debitado nada. desfazer() devolve se o corte nao
// chegar a ser criado.
async function cobrarCliparAgora(userId) {
  if (await isento(userId)) return { ok: true, creditos: 0, desfazer: async () => {} };
  const r = await clientCreditsRepository.reserve(userId, 'normal', CREDITOS_CLIPAR_AGORA);
  if (!r) return { ok: false };
  return { ok: true, creditos: CREDITOS_CLIPAR_AGORA, desfazer: () => clientCreditsRepository.release(userId, 'normal', r) };
}

module.exports = { cobrarSessoes, cobrarCliparAgora, saldo, isento, creditosDevidos, SEGUNDOS_POR_CREDITO, CREDITOS_CLIPAR_AGORA, BURACO_S };
