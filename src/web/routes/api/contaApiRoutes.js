'use strict';

// Exclusão da própria conta. Em teste: só quem está no painel novo, e só conta
// de cliente (o serviço recusa admin).
const express = require('express');
const controller = require('../../controllers/api/contaApiController');
const requireAuthApi = require('../../middleware/requireAuthApi');
const requireRoleApi = require('../../middleware/requireRoleApi');
const requirePainelNovo = require('../../middleware/requirePainelNovo');
const asyncHandler = require('../../lib/asyncHandler');
const { ROLES } = require('../../../config/constants');

const router = express.Router();
router.use(requireAuthApi, requireRoleApi([ROLES.CLIENT, ROLES.ADMIN]), requirePainelNovo.api);
router.get('/exclusao', asyncHandler(controller.resumoDaExclusao));
router.delete('/', asyncHandler(controller.excluir));

module.exports = router;
