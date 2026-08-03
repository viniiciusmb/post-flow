// Motor de credito: decide bolso (normal/bonus), reserva antes do download,
// confirma depois de baixar com sucesso, libera se o download falhar antes
// de completar. A garantia de nunca vender mais credito do que existe vem
// do UPDATE atomico em clientCreditsRepository.reserve - este arquivo so
// orquestra em cima dele, nao faz nenhuma checagem de saldo por conta
// propria.
'use strict';

const clientCreditsRepository = require('../repositories/clientCreditsRepository');
const clientSubscriptionsRepository = require('../repositories/clientSubscriptionsRepository');
const creditTransactionsRepository = require('../repositories/creditTransactionsRepository');
const overageChargesRepository = require('../repositories/overageChargesRepository');
const downloadTunnelsRepository = require('../repositories/downloadTunnelsRepository');
const usersRepository = require('../repositories/usersRepository');
const logger = require('../lib/logger');
const { ROLES } = require('../config/constants');

// R$0,25/min (caminho VPS/proxy) ou R$0,15/min (caminho app do cliente) -
// valores do pedido original, snapshotados em cada cobranca (client_overage_charges.rate_cents_per_min)
// pra nao mudar retroativamente se um dia forem ajustados.
const OVERAGE_RATE_CENTS_PER_MIN = { normal: 25, bonus: 15 };

// O dono do sistema nao gasta credito. O motor de credito existe pra medir e
// cobrar CLIENTE; aplicar a mesma cota a quem e dono do servidor nao mede nada
// e ainda cria um jeito de o proprio sistema se travar - foi o que aconteceu:
// a conta de admin, com plano Pro, bateu a cota semanal testando e ficou sem
// conseguir processar nada.
async function isento(clientUserId) {
  if (!clientUserId) return false;
  const user = await usersRepository.findById(clientUserId);
  return Boolean(user && user.role === ROLES.ADMIN);
}

function minutesFor(durationSeconds) {
  return Math.max(1, Math.ceil((durationSeconds || 0) / 60));
}

function bucketForEgressType(egressType) {
  return egressType === 'client_tunnel' ? 'bonus' : 'normal';
}

// Caminho via app do cliente (tunel proprio conectado agora) -> bolso bonus;
// qualquer outro caminho (tunel do founder, proxy, direto) -> bolso normal.
async function resolveBucketForClient(clientUserId) {
  const hasTunnel = await downloadTunnelsRepository.hasConnectedClientTunnel(clientUserId);
  return hasTunnel ? 'bonus' : 'normal';
}

// Chamado antes de iniciar o download de verdade (video de canal ou link
// colado). Devolve o que o processVideoJob precisa decidir:
// - 'reserved'        credito ja tirado do saldo, pode baixar normalmente.
// - 'overage'         sem saldo mas cliente tem cartao de excedente ligado,
//                     pode baixar normalmente (cobranca entra na fatura de
//                     excedente na confirmacao, ver confirmAfterDownload).
// - 'blocked'         sem saldo e sem cartao - NAO deve baixar, o chamador
//                     marca o video como 'aguardando_creditos'.
// - 'already_charged' reprocessamento (arquivo baixado foi limpo depois de
//                     um erro em etapa posterior) - ja foi debitado antes,
//                     nao cobra de novo, so segue o download.
async function reserveBeforeDownload(sourceVideo, clientUserId) {
  if (await isento(clientUserId)) return { outcome: 'isento' };

  const existing = await creditTransactionsRepository.findBySourceVideoId(sourceVideo.id);
  if (existing) {
    if (existing.status === 'confirmado') return { outcome: 'already_charged' };
    // 'reservado' sobrando de uma pausa no meio do download em si (reserva
    // ja aconteceu antes da pausa, videoPath nunca chegou a ser salvo) -
    // reaproveita a mesma reserva, nao reserva de novo.
    if (existing.status === 'reservado') return { outcome: 'reserved', bucket: existing.bucket };
    // 'liberado': tentativa anterior falhou e devolveu o credito - cai pra
    // reserva nova abaixo.
  }

  await clientCreditsRepository.getOrCreate(clientUserId);
  const minutes = minutesFor(sourceVideo.duration_seconds);
  const bucket = await resolveBucketForClient(clientUserId);
  const reservation = await clientCreditsRepository.reserve(clientUserId, bucket, minutes);
  if (reservation) {
    await creditTransactionsRepository.createReserved({
      clientUserId,
      sourceVideoId: sourceVideo.id,
      bucket,
      minutesCharged: minutes,
      minutesFromQuota: reservation.minutesFromQuota,
      minutesFromExtra: reservation.minutesFromExtra,
    });
    return { outcome: 'reserved', bucket };
  }

  const subscription = await clientSubscriptionsRepository.getOrCreate(clientUserId);
  if (subscription.overage_card_enabled) {
    return { outcome: 'overage', bucket, minutes };
  }
  return { outcome: 'blocked' };
}

// Chamado depois que o download terminou com sucesso, quando
// downloadResult.egressType ja e conhecido de verdade. Reconcilia o bolso
// reservado com o caminho real (raro divergir - janela de milissegundos
// entre resolveBucketForClient e o egress escolhido de verdade pelo
// ytDlpService) e confirma a cobranca definitiva.
async function confirmAfterDownload(sourceVideo, clientUserId, reserveOutcome, downloadResult) {
  // Nada foi reservado, entao nao ha o que confirmar nem o que faturar.
  if (reserveOutcome.outcome === 'isento') return;
  if (reserveOutcome.outcome === 'already_charged') return;

  const realBucket = bucketForEgressType(downloadResult.egressType);

  if (reserveOutcome.outcome === 'overage') {
    await overageChargesRepository.create({
      clientUserId,
      sourceVideoId: sourceVideo.id,
      bucket: realBucket,
      minutes: reserveOutcome.minutes,
      rateCentsPerMin: OVERAGE_RATE_CENTS_PER_MIN[realBucket],
    });
    return;
  }

  // outcome === 'reserved'
  if (reserveOutcome.bucket === realBucket) {
    await creditTransactionsRepository.markConfirmed(sourceVideo.id, { downloadPath: downloadResult.egressType });
    return;
  }

  logger.error(
    `Video-fonte ${sourceVideo.id}: bolso reservado ("${reserveOutcome.bucket}") divergiu do caminho real de download ("${realBucket}") - reconciliando.`
  );
  const tx = await creditTransactionsRepository.findBySourceVideoId(sourceVideo.id);
  await clientCreditsRepository.release(clientUserId, tx.bucket, {
    minutesFromQuota: tx.minutes_from_quota,
    minutesFromExtra: tx.minutes_from_extra,
  });
  const newReservation = await clientCreditsRepository.reserve(clientUserId, realBucket, tx.minutes_charged);
  if (newReservation) {
    await creditTransactionsRepository.moveBucket(sourceVideo.id, {
      bucket: realBucket,
      minutesFromQuota: newReservation.minutesFromQuota,
      minutesFromExtra: newReservation.minutesFromExtra,
      downloadPath: downloadResult.egressType,
    });
  } else {
    // Nem o bolso certo tinha saldo nesse instante - o download ja
    // aconteceu (custo ja gasto, sem como desfazer), entao forca o debito
    // mesmo negativando o bolso, em vez de perder o registro.
    await clientCreditsRepository.forceDebitUsed(clientUserId, realBucket, tx.minutes_charged);
    await creditTransactionsRepository.moveBucket(sourceVideo.id, {
      bucket: realBucket,
      minutesFromQuota: tx.minutes_charged,
      minutesFromExtra: 0,
      downloadPath: downloadResult.egressType,
    });
  }
}

// Chamado no catch geral do processVideoJob (exceto PausedError - pausa
// preserva a reserva pra retomar depois sem cobrar de novo nem perder o
// credito). Sem-op se nao havia nada reservado (ja confirmado, ja liberado,
// ou o video nunca chegou a reservar - overage/blocked/upload).
async function releaseIfReserved(sourceVideoId) {
  const tx = await creditTransactionsRepository.findBySourceVideoId(sourceVideoId);
  if (!tx || tx.status !== 'reservado') return;
  await clientCreditsRepository.release(tx.client_user_id, tx.bucket, {
    minutesFromQuota: tx.minutes_from_quota,
    minutesFromExtra: tx.minutes_from_extra,
  });
  await creditTransactionsRepository.markReleased(sourceVideoId);
}

// Upload direto: o arquivo ja esta em disco, nao ha download separado pra
// justificar duas etapas (nao existe "download falhar" nesse caminho) -
// sempre bolso normal (Whisper/Claude/ffmpeg continuam custando mesmo sem
// egress de banda), reserva e confirma no mesmo instante.
async function chargeForUpload(sourceVideo, clientUserId) {
  const existing = await creditTransactionsRepository.findBySourceVideoId(sourceVideo.id);
  if (existing && existing.status === 'confirmado') return { outcome: 'already_charged' };

  await clientCreditsRepository.getOrCreate(clientUserId);
  const minutes = minutesFor(sourceVideo.duration_seconds);
  const reservation = await clientCreditsRepository.reserve(clientUserId, 'normal', minutes);
  if (reservation) {
    await creditTransactionsRepository.createReserved({
      clientUserId,
      sourceVideoId: sourceVideo.id,
      bucket: 'normal',
      minutesCharged: minutes,
      minutesFromQuota: reservation.minutesFromQuota,
      minutesFromExtra: reservation.minutesFromExtra,
    });
    await creditTransactionsRepository.markConfirmed(sourceVideo.id, { downloadPath: 'upload' });
    return { outcome: 'reserved' };
  }

  const subscription = await clientSubscriptionsRepository.getOrCreate(clientUserId);
  if (subscription.overage_card_enabled) {
    await overageChargesRepository.create({
      clientUserId,
      sourceVideoId: sourceVideo.id,
      bucket: 'normal',
      minutes,
      rateCentsPerMin: OVERAGE_RATE_CENTS_PER_MIN.normal,
    });
    return { outcome: 'overage' };
  }
  return { outcome: 'blocked' };
}

module.exports = {
  minutesFor,
  resolveBucketForClient,
  reserveBeforeDownload,
  confirmAfterDownload,
  releaseIfReserved,
  chargeForUpload,
  OVERAGE_RATE_CENTS_PER_MIN,
};
