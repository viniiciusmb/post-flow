// Descobrir que uma assinatura foi cancelada - e agir certo quando isso
// acontece.
//
// Até 15/09/2026 o sistema só percebia calote (mensalidade vencida) e estorno.
// Uma assinatura cancelada no painel do Asaas, removida ou inativada passava
// em silêncio: o cliente continuava 'ativo' para sempre, com a cota semanal
// renovando de graça.
//
// DOIS CAMINHOS, de propósito:
//   1. O aviso do Asaas (SUBSCRIPTION_DELETED / SUBSCRIPTION_INACTIVATED), que
//      chega na hora.
//   2. Uma conferência de hora em hora que pergunta ao Asaas o estado de cada
//      assinatura. Aviso de webhook se perde (a fila da conta pode ser pausada,
//      o evento pode não estar assinado - que foi exatamente o caso dos avisos
//      de estorno até esta data), e sem a conferência um aviso perdido seria um
//      cancelamento que nunca aconteceu.
//
// QUANDO o cancelamento vale: os termos de uso prometem que "o acesso continua
// até o fim do período já pago". Então quem cancela no meio do mês continua
// ativo até lá, e só então vira 'cancelado'. Quem já estava inadimplente não
// tem período pago a respeitar e é cancelado na hora.
'use strict';

const pool = require('../db/pool');
const asaasService = require('./asaasService');
const clientSubscriptionsRepository = require('../repositories/clientSubscriptionsRepository');
const logger = require('../lib/logger');

const MENSALIDADE = ['primeira_mensalidade', 'recorrencia'];

// Fim do período pago = última mensalidade paga (e não estornada) + 1 mês.
//
// Calculado pelo NOSSO livro de receita, e não pelo `nextDueDate` do Asaas: o
// Asaas gera a cobrança seguinte com antecedência e avança o nextDueDate antes
// de ela ser paga, então ele pode apontar um mês além do que o cliente pagou -
// e o cliente ganharia um mês de graça por cancelar.
async function fimDoPeriodoPago(clientUserId) {
  const { rows } = await pool.query(
    `SELECT max(paid_at) + interval '1 month' AS fim
       FROM revenue_entries
      WHERE client_user_id = $1 AND kind = ANY($2::text[]) AND refunded_at IS NULL`,
    [clientUserId, MENSALIDADE]
  );
  return rows[0] && rows[0].fim ? new Date(rows[0].fim) : null;
}

// Uma assinatura do Asaas acabou. Descobre de quem ela era e aplica a regra.
// Idempotente: o aviso repetido e a conferência achando o mesmo cancelamento
// não mudam nada na segunda vez.
async function registrarEncerramento(subscriptionId, { origem }) {
  if (!subscriptionId) return { efeito: 'ignorado' };

  const doPlano = await clientSubscriptionsRepository.findByAsaasSubscriptionId(subscriptionId);
  if (doPlano) {
    const clientUserId = Number(doPlano.client_user_id);
    if (doPlano.status === 'cancelado') return { efeito: 'ja_cancelado', clientUserId };

    const fim = doPlano.status === 'ativo' ? await fimDoPeriodoPago(clientUserId) : null;
    if (fim && fim > new Date()) {
      const agendado = await clientSubscriptionsRepository.agendarCancelamento(clientUserId, subscriptionId, fim);
      const ate = agendado && agendado.cancel_at ? new Date(agendado.cancel_at) : fim;
      logger.warn(
        `Assinatura ${subscriptionId} do cliente ${clientUserId} encerrada (${origem}) - acesso mantido ate ${ate.toISOString()}, quando vira cancelada.`
      );
      return { efeito: 'agendado', clientUserId, ate };
    }

    await clientSubscriptionsRepository.cancelarAgora(clientUserId, subscriptionId);
    logger.warn(`Assinatura ${subscriptionId} do cliente ${clientUserId} encerrada (${origem}) - cancelada agora.`);
    return { efeito: 'cancelado', clientUserId };
  }

  const dosExtras = await clientSubscriptionsRepository.findByAsaasExtraSlotsSubscriptionId(subscriptionId);
  if (dosExtras) {
    const clientUserId = Number(dosExtras.client_user_id);
    await clientSubscriptionsRepository.removerExtrasDaAssinatura(clientUserId, subscriptionId);
    logger.warn(`Assinatura de conexoes extras ${subscriptionId} do cliente ${clientUserId} encerrada (${origem}) - extras removidos.`);
    return { efeito: 'extras_removidos', clientUserId };
  }

  // Assinatura antiga que o próprio sistema cancelou numa troca de plano (a
  // referência foi solta antes), ou de outro sistema na mesma conta do Asaas.
  logger.info(`Asaas: assinatura ${subscriptionId} encerrada (${origem}) nao pertence a nenhum cliente ativo - nada a fazer.`);
  return { efeito: 'desconhecida' };
}

function estaEncerrada(assinatura) {
  if (!assinatura) return false;
  return assinatura.deleted === true || assinatura.status === 'INACTIVE' || assinatura.status === 'EXPIRED';
}

// A rede de segurança do webhook.
async function conferirNoAsaas() {
  if (!asaasService.isConfigured()) return { conferidas: 0, encerradas: 0, falhas: 0 };

  const linhas = await clientSubscriptionsRepository.listarAssinaturasAsaasParaConferir();
  let conferidas = 0;
  let encerradas = 0;
  let falhas = 0;

  for (const linha of linhas) {
    const ids = [];
    if (linha.asaas_subscription_id && ['ativo', 'inadimplente'].includes(linha.status) && !linha.cancel_at) {
      ids.push(linha.asaas_subscription_id);
    }
    if (linha.asaas_extra_slots_subscription_id) ids.push(linha.asaas_extra_slots_subscription_id);

    for (const id of ids) {
      try {
        const assinatura = await asaasService.getSubscription(id);
        conferidas += 1;
        if (estaEncerrada(assinatura)) {
          await registrarEncerramento(id, { origem: 'conferencia no Asaas' });
          encerradas += 1;
        }
      } catch (err) {
        // 404 NÃO é tratado como cancelamento. Assinatura que "não existe" é o
        // sintoma de chave/conta trocada (ver a troca de chaves da Stripe em
        // 14/08/2026) - cancelar por isso derrubaria todos os clientes de uma
        // vez por um erro de configuração.
        falhas += 1;
        logger.error(`Conferencia de assinatura: nao consegui ler ${id} no Asaas (seguindo):`, err.message);
      }
    }
  }

  return { conferidas, encerradas, falhas };
}

async function finalizarVencidos() {
  const canceladas = await clientSubscriptionsRepository.finalizarCancelamentosVencidos();
  for (const c of canceladas) {
    logger.warn(`Cliente ${c.client_user_id}: fim do periodo pago chegou - assinatura agora cancelada.`);
  }
  return canceladas.length;
}

// Cobrança de mensalidade recusada sem nunca ter sido paga (cartão reprovado
// na análise do Asaas depois de ficar pendente). A recorrência nasce ANTES da
// cobrança (ver checkoutService.assinarComCartaoSalvo) e, no caminho síncrono,
// é cancelada quando o cartão é recusado na hora - mas quando a recusa chega
// depois, pelo aviso, ninguém cancelava: o cliente seria cobrado no mês
// seguinte por um plano que nunca valeu.
async function desfazerAssinaturaNaoPaga(registro) {
  const clientUserId = Number(registro.client_user_id);
  const sub = await clientSubscriptionsRepository.getOrCreate(clientUserId);
  const id = sub.asaas_subscription_id;
  if (!id) return false;
  // Se o cliente já está ativo NESTE plano, a recorrência é a dele e está paga
  // por outra cobrança - não é a que acabou de ser recusada.
  if (sub.status === 'ativo' && Number(sub.plan_id) === Number(registro.plan_id)) return false;

  await clientSubscriptionsRepository.soltarAssinaturaAsaas(clientUserId, id);
  try {
    await asaasService.cancelSubscription(id);
  } catch (err) {
    logger.error(`ATENCAO: nao consegui cancelar a assinatura ${id} (1a cobranca recusada) - ela pode cobrar mes que vem:`, err.message);
  }
  logger.warn(`Cliente ${clientUserId}: 1a mensalidade recusada - recorrencia ${id} desfeita.`);
  return true;
}

// O próprio cliente pediu para cancelar (link "Cancelar plano" em Plano e uso).
//
// Ordem: cancela no Asaas PRIMEIRO. Se o Asaas falhar, nada muda do nosso lado
// e o cliente vê o erro - marcar "cancelado" aqui com a recorrência ainda de pé
// no Asaas faria a pessoa ser cobrada no mês seguinte por um plano que ela
// cancelou, o pior desencontro possível. O aviso SUBSCRIPTION_DELETED que o
// Asaas manda em seguida cai no mesmo registrarEncerramento e não muda nada
// (idempotente).
async function cancelarPeloCliente(clientUserId) {
  const sub = await clientSubscriptionsRepository.getOrCreate(clientUserId);

  // Clique repetido, ou aviso do Asaas que chegou antes: já está feito.
  if (sub.status === 'cancelado' || sub.cancel_at) {
    return { status: sub.status, cancelaEm: sub.cancel_at || null, jaEstava: true };
  }
  if (!sub.asaas_subscription_id) {
    const err = new Error('sem assinatura recorrente para cancelar');
    err.code = 'SEM_ASSINATURA';
    throw err;
  }

  await asaasService.cancelSubscription(sub.asaas_subscription_id);

  if (sub.asaas_extra_slots_subscription_id) {
    const idExtras = sub.asaas_extra_slots_subscription_id;
    await clientSubscriptionsRepository.soltarAssinaturaDeExtras(clientUserId, idExtras);
    try {
      await asaasService.cancelSubscription(idExtras);
    } catch (err) {
      logger.error(
        `ATENCAO: cliente ${clientUserId} cancelou o plano mas a recorrencia de extras ${idExtras} nao foi cancelada - pode cobrar mes que vem:`,
        err.message
      );
    }
  }

  await registrarEncerramento(sub.asaas_subscription_id, { origem: 'cancelado pelo cliente' });
  const depois = await clientSubscriptionsRepository.getOrCreate(clientUserId);
  return { status: depois.status, cancelaEm: depois.cancel_at || null, jaEstava: false };
}

module.exports = {
  cancelarPeloCliente,
  registrarEncerramento,
  conferirNoAsaas,
  finalizarVencidos,
  desfazerAssinaturaNaoPaga,
  fimDoPeriodoPago,
};
