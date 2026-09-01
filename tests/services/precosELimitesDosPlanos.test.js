// A tabela de preços e limites, travada.
//
// Estes números são uma decisão de negócio, não um detalhe de implementação:
// eles aparecem na landing, no checkout e na fatura de quem paga. Um teste que
// os lê do banco e confere contra o que foi combinado é o que impede um ajuste
// futuro de mudar preço sem ninguém perceber.
//
// O que está travado aqui:
//   - o preço do 1º mês é o promocional e o do 2º em diante é o cheio, com o
//     desconto batendo 40%;
//   - todo preço cheio termina em ,90 (era a regra pedida);
//   - conexões e minutos crescem junto com o plano;
//   - o minuto excedente fica MAIS BARATO quanto maior o plano — se isso
//     inverter, o plano caro passa a punir quem o comprou;
//   - só o plano maior vende conexões extras.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const pool = require('../../src/db/pool');
const subscriptionPlansRepository = require('../../src/repositories/subscriptionPlansRepository');

test.after(async () => {
  await pool.end();
});

// O combinado, escrito por extenso. Se um destes números mudar de propósito,
// muda-se aqui junto — o que força a mudança a ser deliberada.
const COMBINADO = {
  starter: {
    primeiroMes: 5990,
    mensal: 9990,
    canais: 1,
    contas: 1,
    minutos: 90,
    bonus: 120,
    excedente: 25,
    excedenteBonus: 15,
    slotExtra: null,
  },
  pro: {
    primeiroMes: 9990,
    mensal: 15990,
    canais: 2,
    contas: 2,
    minutos: 180,
    bonus: 240,
    excedente: 20,
    excedenteBonus: 12,
    slotExtra: null,
  },
  max: {
    primeiroMes: 13990,
    mensal: 22990,
    canais: 3,
    contas: 3,
    minutos: 270,
    bonus: 360,
    excedente: 18,
    excedenteBonus: 11,
    extraCanal: 1490,
    extraConta: 2990,
    extraAmbos: 3990,
  },
};

test('cada plano tem exatamente os preços, limites e cotas combinados', async () => {
  for (const [chave, esperado] of Object.entries(COMBINADO)) {
    const plano = await subscriptionPlansRepository.findByKey(chave);
    assert.ok(plano, `o plano ${chave} tem que existir`);
    assert.equal(plano.first_month_price_cents, esperado.primeiroMes, `1º mês do ${chave}`);
    assert.equal(plano.price_cents, esperado.mensal, `mensalidade do ${chave}`);
    assert.equal(plano.max_youtube_channels, esperado.canais, `canais do ${chave}`);
    assert.equal(plano.max_tiktok_accounts, esperado.contas, `contas do ${chave}`);
    assert.equal(plano.weekly_minutes_normal, esperado.minutos, `minutos do ${chave}`);
    assert.equal(plano.weekly_minutes_bonus, esperado.bonus, `minutos bônus do ${chave}`);
    assert.equal(plano.overage_cents_normal, esperado.excedente, `excedente do ${chave}`);
    assert.equal(plano.overage_cents_bonus, esperado.excedenteBonus, `excedente bônus do ${chave}`);
    assert.equal(plano.extra_channel_price_cents, esperado.extraCanal ?? null, `canal extra do ${chave}`);
    assert.equal(plano.extra_tiktok_price_cents, esperado.extraConta ?? null, `conta extra do ${chave}`);
    assert.equal(plano.extra_both_price_cents, esperado.extraAmbos ?? null, `par extra do ${chave}`);
  }
});

test('o primeiro mês é um desconto de verdade, mas não um preço novo', async () => {
  // Era "exatamente 40%" enquanto as mensalidades foram DERIVADAS do preço de
  // estreia. Em 01/09/2026 o fundador passou a definir a mensalidade direto
  // (Pro 159,90 e Max 229,90), então a proporção deixou de ser a regra - o que
  // continua valendo é a faixa: desconto que se sente, sem virar outro produto.
  const planos = await subscriptionPlansRepository.listActive();
  for (const p of planos) {
    const desconto = 1 - p.first_month_price_cents / p.price_cents;
    assert.ok(
      desconto >= 0.25 && desconto <= 0.5,
      `o desconto de estreia do ${p.key} deu ${(desconto * 100).toFixed(1)}% - fora da faixa de 25% a 50%`
    );
  }
});

test('todo preço termina em ,90 — foi a regra pedida para não sair número quebrado', async () => {
  const planos = await subscriptionPlansRepository.listActive();
  for (const p of planos) {
    assert.equal(p.price_cents % 100, 90, `a mensalidade do ${p.key} não termina em ,90`);
    assert.equal(p.first_month_price_cents % 100, 90, `o 1º mês do ${p.key} não termina em ,90`);
    for (const coluna of ['extra_channel_price_cents', 'extra_tiktok_price_cents', 'extra_both_price_cents']) {
      if (p[coluna]) assert.equal(p[coluna] % 100, 90, `${coluna} do ${p.key} não termina em ,90`);
    }
  }
});

test('quanto maior o plano, mais barato o minuto excedente', async () => {
  // listActive devolve em ordem de preço crescente.
  const planos = await subscriptionPlansRepository.listActive();
  for (let i = 1; i < planos.length; i += 1) {
    assert.ok(
      planos[i].overage_cents_normal < planos[i - 1].overage_cents_normal,
      `o plano ${planos[i].key} tem que ter minuto mais barato que o ${planos[i - 1].key}`
    );
    assert.ok(
      planos[i].overage_cents_bonus < planos[i - 1].overage_cents_bonus,
      `o bônus do ${planos[i].key} também precisa ficar mais barato`
    );
    // Pela nossa internet sempre custa mais: a banda é nossa nesse caminho.
    assert.ok(planos[i].overage_cents_bonus < planos[i].overage_cents_normal);
  }
});

test('plano maior nunca entrega menos que o menor', async () => {
  const planos = await subscriptionPlansRepository.listActive();
  for (let i = 1; i < planos.length; i += 1) {
    assert.ok(planos[i].weekly_minutes_normal > planos[i - 1].weekly_minutes_normal);
    assert.ok(planos[i].weekly_minutes_bonus > planos[i - 1].weekly_minutes_bonus);
    assert.ok(planos[i].max_youtube_channels > planos[i - 1].max_youtube_channels);
    assert.ok(planos[i].max_tiktok_accounts > planos[i - 1].max_tiktok_accounts);
    assert.ok(planos[i].queue_priority > planos[i - 1].queue_priority);
  }
});

test('nenhum plano é "ilimitado" — o limite existe para poder ser vendido', async () => {
  // O plano maior era ilimitado antes. Enquanto for, não faz sentido vender
  // conexão extra: não haveria nada para liberar.
  const planos = await subscriptionPlansRepository.listActive();
  for (const p of planos) {
    assert.ok(p.max_youtube_channels !== null, `${p.key} sem limite de canais`);
    assert.ok(p.max_tiktok_accounts !== null, `${p.key} sem limite de contas`);
  }
  const vendemExtras = planos.filter((p) => p.extra_channel_price_cents);
  assert.equal(vendemExtras.length, 1, 'só o plano maior vende conexões extras');
  assert.equal(vendemExtras[0].key, planos[planos.length - 1].key);
});
