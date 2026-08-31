'use strict';

const express = require('express');
const controller = require('../../controllers/api/clientCheckoutApiController');
const requireAuthApi = require('../../middleware/requireAuthApi');
const requireRoleApi = require('../../middleware/requireRoleApi');
const asyncHandler = require('../../lib/asyncHandler');
const { ROLES } = require('../../../config/constants');

const router = express.Router();

// CLIENT + ADMIN: o admin tambem e dono de canais e usa o proprio sistema.
router.use(requireAuthApi, requireRoleApi([ROLES.CLIENT, ROLES.ADMIN]));

// Tudo que a tela de checkout precisa pra se montar, numa requisicao so.
router.get('/contexto', asyncHandler(controller.contexto));
router.post('/cartao', asyncHandler(controller.salvarCartao));
router.delete('/cartao', asyncHandler(controller.removerCartao));
router.post('/pagar', asyncHandler(controller.pagar));
// A tela pergunta se o PIX ja caiu enquanto o QR Code esta aberto.
router.get('/pagamento/:id', asyncHandler(controller.statusDoPagamento));
router.post('/extras/remover', asyncHandler(controller.removerExtras));

module.exports = router;
