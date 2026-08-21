'use strict';

const express = require('express');
const controller = require('../../controllers/api/asaasWebhookApiController');
const asyncHandler = require('../../lib/asyncHandler');

const router = express.Router();

// SEM requireAuthApi de propósito - quem chama é o Asaas, sem sessão nenhuma.
// A autenticação é o token combinado que ele manda no cabeçalho
// asaas-access-token, conferido dentro do controller.
//
// Diferente da Stripe, o Asaas não assina o corpo da requisição, então esta
// rota usa o express.json() normal (não precisa do corpo bruto).
router.post('/', asyncHandler(controller.webhook));

module.exports = router;
