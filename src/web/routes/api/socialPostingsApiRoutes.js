'use strict';

// Ações num corte da fila do Instagram/Facebook/...: legenda, não postar,
// postar agora, tentar de novo. Mesma trava do painel novo.
const express = require('express');
const publicacao = require('../../controllers/api/socialPublicacaoApiController');
const requireAuthApi = require('../../middleware/requireAuthApi');
const requireRoleApi = require('../../middleware/requireRoleApi');
const requirePainelNovo = require('../../middleware/requirePainelNovo');
const asyncHandler = require('../../lib/asyncHandler');
const { ROLES } = require('../../../config/constants');

const router = express.Router();

router.use(requireAuthApi, requireRoleApi([ROLES.CLIENT, ROLES.ADMIN]), requirePainelNovo.api);

router.put('/:id/legenda', asyncHandler(publicacao.editarLegenda));
router.post('/:id/cancelar', asyncHandler(publicacao.cancelar));
router.post('/:id/postar-agora', asyncHandler(publicacao.postarAgora));
router.post('/:id/tentar-de-novo', asyncHandler(publicacao.tentarDeNovo));

module.exports = router;
