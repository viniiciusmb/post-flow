#!/usr/bin/env node
// Roda so uma vez, quando as chaves da Stripe chegarem: cria os 3 Products/
// Prices (Starter/Pro/Max) na Stripe de verdade via API e grava o
// stripe_price_id de volta em subscription_plans - evita cadastrar isso na
// mao no dashboard. Uso: node scripts/stripe-setup.js
'use strict';

require('dotenv').config();
const { Client } = require('pg');
const stripeService = require('../src/services/stripeService');

async function main() {
  if (!stripeService.isConfigured()) {
    console.error('STRIPE_SECRET_KEY nao configurada - configure o .env antes de rodar esse script.');
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL nao definida.');
    process.exit(1);
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const { rows: plans } = await client.query('SELECT * FROM subscription_plans ORDER BY price_cents ASC');
    for (const plan of plans) {
      if (plan.stripe_price_id) {
        console.log(`Plano "${plan.name}" ja tem stripe_price_id (${plan.stripe_price_id}) - pulando.`);
        continue;
      }
      const { priceId } = await stripeService.createProductAndPrice({ name: `Post Flow - ${plan.name}`, priceCents: plan.price_cents });
      await client.query('UPDATE subscription_plans SET stripe_price_id = $2 WHERE id = $1', [plan.id, priceId]);
      console.log(`Plano "${plan.name}": criado Price ${priceId} na Stripe.`);
    }
    console.log('Pronto.');
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
