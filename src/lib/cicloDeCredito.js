// Quando a cota semanal do cliente renova.
//
// A conta mora aqui, e nao na tela, porque quem RESETA de verdade e o
// creditWeeklyResetJob (clientCreditsRepository.resetDueCycles): ele so mexe em
// quem tem `cycle_start_at <= now() - interval '7 days'` E assinatura ativa.
// A tela precisa responder exatamente a mesma pergunta - um contador que zera
// e nao renova nada e pior do que nao ter contador nenhum.
//
// Duas consequencias dessa regra que o contador herda de proposito:
//
//   1. Assinatura que nao esta 'ativo' NAO renova. Cliente inadimplente fica
//      com a cota parada ate voltar a pagar (e ai renova na hora seguinte,
//      porque o prazo ja passou). Por isso devolvemos null em vez de uma data:
//      prometer uma renovacao que o job nao vai fazer e mentira.
//
//   2. O job roda DE HORA EM HORA, entao a renovacao acontece em ate ~1h
//      depois do prazo. Por isso o prazo vencido nao vira numero negativo na
//      tela - quem mostra decide dizer "a qualquer momento".
'use strict';

const DIAS_DO_CICLO = 7;
const MS_POR_DIA = 24 * 60 * 60 * 1000;

/**
 * Instante em que a cota semanal renova, ou null quando nao ha renovacao
 * prevista (sem ciclo iniciado, ou assinatura que nao esta ativa).
 */
function proximoReset(credits, subscription) {
  if (!credits || !credits.cycle_start_at) return null;
  if (!subscription || subscription.status !== 'ativo') return null;
  const inicio = new Date(credits.cycle_start_at);
  if (Number.isNaN(inicio.getTime())) return null;
  return new Date(inicio.getTime() + DIAS_DO_CICLO * MS_POR_DIA);
}

/**
 * Quantos segundos faltam, contados no relogio do SERVIDOR.
 *
 * O navegador recebe este numero e conta pra baixo a partir dele em vez de
 * comparar a data com o proprio relogio: computador com a hora errada (ou so
 * com o fuso trocado) mostraria "renova em 3 dias" pra quem renova amanha.
 * Nunca negativo - prazo vencido e "ja deu a hora", nao "-2 horas".
 */
function segundosAteReset(credits, subscription, agora = new Date()) {
  const reset = proximoReset(credits, subscription);
  if (!reset) return null;
  return Math.max(0, Math.round((reset.getTime() - agora.getTime()) / 1000));
}

module.exports = { proximoReset, segundosAteReset, DIAS_DO_CICLO };
