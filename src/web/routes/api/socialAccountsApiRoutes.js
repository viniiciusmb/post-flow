'use strict';

// Contas do Instagram e do Facebook. Em teste: só quem está no painel novo
// (admin e as contas de lib/painelNovo).
const express = require('express');
const controller = require('../../controllers/api/socialAccountsApiController');
const requireAuthApi = require('../../middleware/requireAuthApi');
const requireRoleApi = require('../../middleware/requireRoleApi');
const requirePainelNovo = require('../../middleware/requirePainelNovo');
const asyncHandler = require('../../lib/asyncHandler');
const { ROLES } = require('../../../config/constants');

const router = express.Router();

router.use(requireAuthApi, requireRoleApi([ROLES.CLIENT, ROLES.ADMIN]), requirePainelNovo.api);

router.get('/', asyncHandler(controller.listar));
router.post('/:network/conectar', asyncHandler(controller.iniciarConexao));
router.get('/facebook/paginas', asyncHandler(controller.paginasDoFacebook));
router.post('/facebook/paginas', asyncHandler(controller.conectarPaginas));
router.delete('/:id', asyncHandler(controller.desconectar));

module.exports = router;
