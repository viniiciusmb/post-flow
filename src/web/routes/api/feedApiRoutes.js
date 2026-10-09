'use strict';

// Feed de cortes. Em teste: só quem está no painel novo (admin e as contas de
// lib/painelNovo), como o resto da remodelação.
const express = require('express');
const controller = require('../../controllers/api/feedApiController');
const requireAuthApi = require('../../middleware/requireAuthApi');
const requireRoleApi = require('../../middleware/requireRoleApi');
const requirePainelNovo = require('../../middleware/requirePainelNovo');
const asyncHandler = require('../../lib/asyncHandler');
const { ROLES } = require('../../../config/constants');

const router = express.Router();

router.use(requireAuthApi, requireRoleApi([ROLES.CLIENT, ROLES.ADMIN]), requirePainelNovo.api);

router.get('/', asyncHandler(controller.listar));
router.get('/contexto', asyncHandler(controller.contexto));
// :tipo = youtube | live (os dois tipos de corte têm ids independentes).
router.put('/cortes/:tipo/:id/gostei', asyncHandler(controller.gostei));
router.post('/cortes/:tipo/:id/enviar', asyncHandler(controller.enviar));

module.exports = router;
