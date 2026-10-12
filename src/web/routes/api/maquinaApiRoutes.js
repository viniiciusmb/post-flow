'use strict';

// Estado da linha de produção (tela Início do painel novo). Em teste: só quem
// está no painel novo.
const express = require('express');
const controller = require('../../controllers/api/maquinaApiController');
const requireAuthApi = require('../../middleware/requireAuthApi');
const requireRoleApi = require('../../middleware/requireRoleApi');
const requirePainelNovo = require('../../middleware/requirePainelNovo');
const asyncHandler = require('../../lib/asyncHandler');
const { ROLES } = require('../../../config/constants');

const router = express.Router();
router.use(requireAuthApi, requireRoleApi([ROLES.CLIENT, ROLES.ADMIN]), requirePainelNovo.api);
router.get('/', asyncHandler(controller.estado));
// Barra do topo e menu: consultado por toda tela do painel novo.
router.get('/resumo', asyncHandler(controller.resumo));

module.exports = router;
