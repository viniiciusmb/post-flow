// De hora em hora: confere no Asaas se alguma assinatura foi encerrada sem o
// aviso ter chegado, e aplica os cancelamentos cujo período pago acabou.
// Ver cancelamentoDeAssinaturaService.
'use strict';

const cancelamentoDeAssinaturaService = require('../../services/cancelamentoDeAssinaturaService');
const logger = require('../../lib/logger');

async function run() {
  // Conferir primeiro: um encerramento descoberto agora de quem já passou do
  // período pago é cancelado na mesma volta.
  const conferencia = await cancelamentoDeAssinaturaService.conferirNoAsaas();
  const finalizados = await cancelamentoDeAssinaturaService.finalizarVencidos();
  if (conferencia.encerradas || finalizados || conferencia.falhas) {
    logger.info(
      `Assinaturas: ${conferencia.conferidas} conferida(s), ${conferencia.encerradas} encerrada(s), ${finalizados} cancelamento(s) aplicado(s), ${conferencia.falhas} falha(s) de leitura.`
    );
  }
  return { ...conferencia, finalizados };
}

module.exports = { run };
