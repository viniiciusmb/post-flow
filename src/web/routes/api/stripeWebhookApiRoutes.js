'use strict';

const express = require('express');
const controller = require('../../controllers/api/stripeWebhookApiController');
const asyncHandler = require('../../lib/asyncHandler');

const router = express.Router();

// SEM requireAuthApi de proposito - quem chama e a Stripe, sem sessao
// nenhuma. A assinatura (stripe-signature) e verificada dentro do
// controller via stripeService.constructWebhookEvent - o corpo bruto (nao
// JSON-parseado) e garantido pelo express.raw() montado antes do
// express.json() global em app.js.
router.post('/', asyncHandler(controller.webhook));

module.exports = router;
