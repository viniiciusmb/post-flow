// A promoção de primeiro mês é de ESTREIA — só para quem nunca teve plano.
//
// O relato (fundador, 01/09/2026): a conta de teste dele estava com um plano
// ATIVO e mesmo assim a tela de "Plano e uso" anunciava "R$59,90 no 1º mês".
// A única trava que existia era `first_month_used_at`, marcado quando o
// primeiro mês é efetivamente PAGO — e essa conta nunca tinha pago nada: o
// plano foi atribuído na mão pelo admin, que é como todo cliente é ativado
// hoje. Todo cliente ativo do sistema estava nessa situação.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const pool = require('../../src/db/pool');
const clientSubscriptionsRepository = require('../../src/repositories/clientSubscriptionsRepository');
const subscriptionPlansRepository = require('../../src/repositories/subscriptionPlansRepository');
const { promocaoDisponivel, aplicaPromocao } = require('../../src/lib/promocaoDePrimeiroMes');
const { createClient } = require('../helpers/db');

test.after(async () => {
  await pool.end();
});

const PLANO_COM_PROMO = { price_cents: 9990, first_month_price_cents: 5990 };

test('cliente recém-criado, sem plano nenhum, tem direito à promoção', async () => {
  const cliente = await createClient();
  const sub = await clientSubscriptionsRepository.getOrCreate(cliente.id);

  assert.equal(sub.status, 'sem_plano');
  assert.equal(sub.first_plan_at, null);
  assert.equal(promocaoDisponivel(sub), true);
  assert.equal(aplicaPromocao(PLANO_COM_PROMO, sub), true);
});

test('cliente COM plano ativo não tem direito, mesmo sem nunca ter pago', async () => {
  // É exatamente a conta de teste do fundador: plano atribuído pela tela do
  // admin, `first_month_used_at` nulo porque nenhum pagamento aconteceu.
  const cliente = await createClient();
  const planos = await subscriptionPlansRepository.listActive();
  await clientSubscriptionsRepository.setPlan(cliente.id, planos[0].id);

  const sub = await clientSubscriptionsRepository.getOrCreate(cliente.id);
  assert.equal(sub.first_month_used_at, null, 'ninguém pagou nada — é justamente esse o caso');
  assert.ok(sub.first_plan_at, 'ganhar um plano tem que deixar carimbo, senão não há como saber depois');
  assert.equal(promocaoDisponivel(sub), false);
  assert.equal(aplicaPromocao(PLANO_COM_PROMO, sub), false);
});

test('perder o plano NÃO devolve o direito à promoção', async () => {
  // Sem isto, "cancelar e voltar" viraria desconto infinito por outra porta:
  // a do admin tirando e repondo o plano.
  const cliente = await createClient();
  const planos = await subscriptionPlansRepository.listActive();
  await clientSubscriptionsRepository.setPlan(cliente.id, planos[0].id);
  await pool.query(
    "UPDATE client_subscriptions SET plan_id = NULL, status = 'sem_plano' WHERE client_user_id = $1",
    [cliente.id]
  );

  const sub = await clientSubscriptionsRepository.getOrCreate(cliente.id);
  assert.equal(sub.plan_id, null);
  assert.equal(sub.status, 'sem_plano', 'o estado atual diz "novo"...');
  assert.equal(promocaoDisponivel(sub), false, '...mas o carimbo lembra que não é');
});

test('trocar de plano depois não adianta o carimbo de estreia', async () => {
  // COALESCE, não now(): se a data fosse reescrita a cada troca de plano ela
  // viraria "último plano", e quem é cliente há meses voltaria a parecer novo.
  const cliente = await createClient();
  const planos = await subscriptionPlansRepository.listActive();
  await clientSubscriptionsRepository.setPlan(cliente.id, planos[0].id);
  const primeiro = await clientSubscriptionsRepository.getOrCreate(cliente.id);

  await pool.query(
    "UPDATE client_subscriptions SET first_plan_at = now() - interval '90 days' WHERE client_user_id = $1",
    [cliente.id]
  );
  const antigo = (await clientSubscriptionsRepository.getOrCreate(cliente.id)).first_plan_at;

  await clientSubscriptionsRepository.setPlan(cliente.id, planos[planos.length - 1].id);
  const depois = await clientSubscriptionsRepository.getOrCreate(cliente.id);

  assert.equal(
    new Date(depois.first_plan_at).getTime(),
    new Date(antigo).getTime(),
    'a data de estreia foi reescrita na troca de plano'
  );
  assert.ok(primeiro.first_plan_at, 'guarda de sanidade do próprio teste');
});

test('quem já pagou um primeiro mês promocional também perde o direito', async () => {
  const cliente = await createClient();
  await clientSubscriptionsRepository.getOrCreate(cliente.id);
  await clientSubscriptionsRepository.markFirstMonthUsed(cliente.id);

  const sub = await clientSubscriptionsRepository.getOrCreate(cliente.id);
  assert.equal(promocaoDisponivel(sub), false);
});

test('plano sem preço promocional nunca anuncia desconto', async () => {
  const cliente = await createClient();
  const sub = await clientSubscriptionsRepository.getOrCreate(cliente.id);

  assert.equal(aplicaPromocao({ price_cents: 9990, first_month_price_cents: null }, sub), false);
  // Um "promocional" que não é menor que o cheio não é promoção nenhuma —
  // anunciar "1º mês por R$99,90 · depois R$99,90" faria a tela parecer quebrada.
  assert.equal(aplicaPromocao({ price_cents: 9990, first_month_price_cents: 9990 }, sub), false);
});
