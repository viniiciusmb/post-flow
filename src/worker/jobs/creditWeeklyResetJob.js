// Reset semanal de credito - roda de hora em hora, mas so mexe nos clientes
// cujo ciclo ja completou 7 dias (client_credits.cycle_start_at). A cota nao
// acumula sobra (used_* zera); credito avulso comprado carrega pro proximo
// ciclo (extra_* fica intocado) - ver clientCreditsRepository.resetDueCycles.
// Tambem e o momento em que uma troca de plano feita no meio do ciclo
// anterior passa a valer pra cota (o plan_id ja tinha mudado na hora, so a
// cota esperava esse reset).
'use strict';

const clientCreditsRepository = require('../../repositories/clientCreditsRepository');
const logger = require('../../lib/logger');

async function run() {
  const resetClientIds = await clientCreditsRepository.resetDueCycles();
  if (resetClientIds.length > 0) {
    logger.info(`Reset semanal de credito aplicado pra ${resetClientIds.length} cliente(s).`);
  }
}

module.exports = { run };
