'use strict';

const express = require('express');
const controller = require('../../controllers/api/clientBillingApiController');
const requireAuthApi = require('../../middleware/requireAuthApi');
const requireRoleApi = require('../../middleware/requireRoleApi');
const asyncHandler = require('../../lib/asyncHandler');
const { ROLES } = require('../../../config/constants');

const router = express.Router();

// CLIENT + ADMIN, igual a todas as outras rotas /api/client/*. Esta era a
// unica que excluia o admin, e o efeito era a tela "Plano e uso" abrir e nao
// carregar nada pra ele: a PAGINA ja permitia admin, so a API e que recusava.
// O admin tambem e dono de canais e usa o proprio sistema.
router.use(requireAuthApi, requireRoleApi([ROLES.CLIENT, ROLES.ADMIN]));

router.get('/overview', asyncHandler(controller.overview));
router.post('/subscribe', asyncHandler(controller.subscribe));
router.post('/buy-package', asyncHandler(controller.buyPackage));
// Assinatura por PIX Automatico (um QR Code paga e autoriza as proximas).
router.post('/subscribe-pix', asyncHandler(controller.subscribePix));
router.get('/pix-authorization', asyncHandler(controller.pixAuthorizationStatus));
// O que a pessoa acabou de pagar - a tela usa pra confirmar o recebimento.
router.get('/ultimo-pagamento', asyncHandler(controller.ultimoPagamento));
router.post('/overage-card/setup', asyncHandler(controller.setupOverageCard));
router.post('/overage-card/disable', asyncHandler(controller.disableOverageCard));
// Cartoes salvos + extrato. Separado do /overview porque fala com a Stripe:
// se ela cair, a tela de plano continua abrindo sem este pedaco.
router.get('/payments', asyncHandler(controller.payments));
router.post('/payments/default-card', asyncHandler(controller.setDefaultCard));

module.exports = router;
