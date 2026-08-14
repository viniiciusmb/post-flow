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
const stripeService = require('./stripeService');
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

// Cobra um video avulso no cartao ja salvo. Isolada porque e o unico ponto do
// sistema que tira dinheiro sem ninguem clicar em nada - tudo que ela precisa
// conferir fica visivel aqui.
async function cobrarAgora({ subscription, clientUserId, sourceVideo, minutes, amountCents }) {
  if (!stripeService.isConfigured()) {
    return { ok: false, motivo: 'Cobranca por cartao ainda nao esta configurada no sistema.' };
  }
  if (!subscription.stripe_customer_id || !subscription.stripe_default_payment_method_id) {
    return { ok: false, motivo: 'Nao ha cartao salvo pra cobrar.' };
  }

  return stripeService.chargeNow({
    customerId: subscription.stripe_customer_id,
    paymentMethodId: subscription.stripe_default_payment_method_id,
    amountCents,
    description: `Post Flow - processamento de ${minutes} min de video`,
    // Amarra a cobranca ao video, pra conferir depois no painel da Stripe de
    // onde veio cada valor.
    metadata: { clientUserId: String(clientUserId), sourceVideoId: String(sourceVideo.id) },
  });
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

  // Consome o que houver e diz quanto faltou - o excedente e PROPORCIONAL.
  // Com 10 min de cota sobrando e um video de 30, usa os 10 que o cliente ja
  // pagou e cobra so os 20 restantes. Antes isso era tudo-ou-nada: nao
  // cabendo, o video inteiro ia pro cartao e os 10 minutos ficavam parados -
  // cobrava a mais e ainda deixava credito preso, que e o pior dos dois mundos
  // pra quem paga.
  const consumo = await clientCreditsRepository.consumeUpTo(clientUserId, bucket, minutes);
  const minutesFromCredit = consumo.minutesFromQuota + consumo.minutesFromExtra;
  const minutesUncovered = consumo.minutesUncovered;

  async function devolverCreditoConsumido() {
    if (minutesFromCredit === 0) return;
    await clientCreditsRepository.release(clientUserId, bucket, {
      minutesFromQuota: consumo.minutesFromQuota,
      minutesFromExtra: consumo.minutesFromExtra,
    });
  }

  // Coube inteiro no credito - caminho de sempre, nenhuma cobranca envolvida.
  if (minutesUncovered === 0) {
    await creditTransactionsRepository.createReserved({
      clientUserId,
      sourceVideoId: sourceVideo.id,
      bucket,
      minutesCharged: minutes,
      minutesFromQuota: consumo.minutesFromQuota,
      minutesFromExtra: consumo.minutesFromExtra,
    });
    return { outcome: 'reserved', bucket };
  }

  const subscription = await clientSubscriptionsRepository.getOrCreate(clientUserId);
  if (!subscription.overage_card_enabled) {
    // Sem cartao o video nao vai rodar, entao o que ja foi consumido tem que
    // voltar - senao o cliente perde credito sem receber nada em troca.
    await devolverCreditoConsumido();
    return { outcome: 'blocked' };
  }

  // Cobra AGORA, antes de processar, e SO os minutos que faltaram.
  //
  // Antes o excedente era acumulado e faturado depois, de hora em hora. Isso
  // significava processar primeiro e cobrar torcendo pra dar certo - se o
  // cartao fosse recusado, o custo (download, transcricao, IA, render) ja tinha
  // sido gasto e nao havia como desfazer. Cobrando antes, o pior caso e o video
  // esperar, nao o prejuizo.
  const rateCentsPerMin = OVERAGE_RATE_CENTS_PER_MIN[bucket];
  const amountCents = Math.round(minutesUncovered * rateCentsPerMin);
  const cobranca = await cobrarAgora({
    subscription,
    clientUserId,
    sourceVideo,
    minutes: minutesUncovered,
    amountCents,
  });

  if (!cobranca.ok) {
    logger.warn(`Cobranca do video ${sourceVideo.id} recusada: ${cobranca.motivo}`);
    await devolverCreditoConsumido();
    return { outcome: 'charge_failed', motivo: cobranca.motivo, amountCents };
  }

  await overageChargesRepository.createAlreadyPaid({
    clientUserId,
    sourceVideoId: sourceVideo.id,
    bucket,
    minutes: minutesUncovered,
    rateCentsPerMin,
    stripePaymentIntentId: cobranca.id,
  });

  // Parte saiu do credito: precisa do registro tambem, senao esses minutos
  // ficam debitados sem rastro - e releaseIfReserved nao teria como devolve-los
  // se o processamento falhar depois.
  if (minutesFromCredit > 0) {
    await creditTransactionsRepository.createReserved({
      clientUserId,
      sourceVideoId: sourceVideo.id,
      bucket,
      minutesCharged: minutesFromCredit,
      minutesFromQuota: consumo.minutesFromQuota,
      minutesFromExtra: consumo.minutesFromExtra,
    });
    return { outcome: 'reserved_and_charged', bucket, minutesFromCredit, minutesUncovered, amountCents };
  }

  return { outcome: 'charged', bucket, minutes: minutesUncovered, amountCents };
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

  // O excedente ja foi cobrado no cartao ANTES do download (ver
  // reserveBeforeDownload), entao nao ha nada a faturar aqui. So o caso
  // 'charged' puro sai aqui: em 'reserved_and_charged' parte saiu do credito e
  // essa parte tem transacao pra confirmar, igual a uma reserva comum.
  if (reserveOutcome.outcome === 'charged') return;

  // outcome === 'reserved' ou 'reserved_and_charged'
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
  if (await isento(clientUserId)) return { outcome: 'isento' };

  const existing = await creditTransactionsRepository.findBySourceVideoId(sourceVideo.id);
  if (existing && existing.status === 'confirmado') return { outcome: 'already_charged' };

  await clientCreditsRepository.getOrCreate(clientUserId);
  const minutes = minutesFor(sourceVideo.duration_seconds);

  // Excedente proporcional, igual ao video de canal (ver reserveBeforeDownload).
  const consumo = await clientCreditsRepository.consumeUpTo(clientUserId, 'normal', minutes);
  const minutesFromCredit = consumo.minutesFromQuota + consumo.minutesFromExtra;
  const minutesUncovered = consumo.minutesUncovered;

  async function devolverCreditoConsumido() {
    if (minutesFromCredit === 0) return;
    await clientCreditsRepository.release(clientUserId, 'normal', {
      minutesFromQuota: consumo.minutesFromQuota,
      minutesFromExtra: consumo.minutesFromExtra,
    });
  }

  async function registrarCreditoUsado(minutesCharged) {
    await creditTransactionsRepository.createReserved({
      clientUserId,
      sourceVideoId: sourceVideo.id,
      bucket: 'normal',
      minutesCharged,
      minutesFromQuota: consumo.minutesFromQuota,
      minutesFromExtra: consumo.minutesFromExtra,
    });
    // Upload nao tem etapa de download separada pra confirmar depois: o
    // arquivo ja esta em disco, entao reserva e confirmacao acontecem juntas.
    await creditTransactionsRepository.markConfirmed(sourceVideo.id, { downloadPath: 'upload' });
  }

  if (minutesUncovered === 0) {
    await registrarCreditoUsado(minutes);
    return { outcome: 'reserved' };
  }

  const subscription = await clientSubscriptionsRepository.getOrCreate(clientUserId);
  if (!subscription.overage_card_enabled) {
    await devolverCreditoConsumido();
    return { outcome: 'blocked' };
  }

  // Mesma regra do video de canal: cobra antes de processar (ver
  // reserveBeforeDownload). Aqui o arquivo ja esta em disco, mas o caro vem
  // depois - transcricao, IA e render.
  const amountCents = Math.round(minutesUncovered * OVERAGE_RATE_CENTS_PER_MIN.normal);
  const cobranca = await cobrarAgora({
    subscription,
    clientUserId,
    sourceVideo,
    minutes: minutesUncovered,
    amountCents,
  });
  if (!cobranca.ok) {
    logger.warn(`Cobranca do upload ${sourceVideo.id} recusada: ${cobranca.motivo}`);
    await devolverCreditoConsumido();
    return { outcome: 'charge_failed', motivo: cobranca.motivo, amountCents };
  }

  await overageChargesRepository.createAlreadyPaid({
    clientUserId,
    sourceVideoId: sourceVideo.id,
    bucket: 'normal',
    minutes: minutesUncovered,
    rateCentsPerMin: OVERAGE_RATE_CENTS_PER_MIN.normal,
    stripePaymentIntentId: cobranca.id,
  });

  if (minutesFromCredit > 0) {
    await registrarCreditoUsado(minutesFromCredit);
    return { outcome: 'reserved_and_charged', bucket: 'normal', minutesFromCredit, minutesUncovered, amountCents };
  }

  return { outcome: 'charged', bucket: 'normal', minutes: minutesUncovered, amountCents };
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
