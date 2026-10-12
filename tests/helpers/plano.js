// Dá um plano ativo a um cliente de teste. Desde 12/10/2026 cliente sem plano
// não conecta rede social nem acompanha live (limite 0), então todo teste que
// usa essas telas precisa de um cliente com plano - o Max por padrão, que é o
// de limite maior e não atrapalha teste que não é sobre limite.
'use strict';

const pool = require('../../src/db/pool');
const clientSubscriptionsRepository = require('../../src/repositories/clientSubscriptionsRepository');

async function darPlano(userId, key = 'max') {
  const { rows } = await pool.query('SELECT id FROM subscription_plans WHERE key = $1', [key]);
  if (!rows[0]) throw new Error(`Plano ${key} não existe no banco de teste.`);
  await clientSubscriptionsRepository.setPlan(userId, rows[0].id);
}

module.exports = { darPlano };
