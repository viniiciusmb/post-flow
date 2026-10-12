'use strict';

// Contas de Instagram, Facebook, Threads, LinkedIn, Pinterest, Bluesky e
// YouTube, e a fila de publicação de cada uma. Em teste: só quem está no painel
// novo (admin e as contas de lib/painelNovo).
const express = require('express');
const controller = require('../../controllers/api/socialAccountsApiController');
const publicacao = require('../../controllers/api/socialPublicacaoApiController');
const requireAuthApi = require('../../middleware/requireAuthApi');
const requireRoleApi = require('../../middleware/requireRoleApi');
const requirePainelNovo = require('../../middleware/requirePainelNovo');
const asyncHandler = require('../../lib/asyncHandler');
const { ROLES } = require('../../../config/constants');

const router = express.Router();

router.use(requireAuthApi, requireRoleApi([ROLES.CLIENT, ROLES.ADMIN]), requirePainelNovo.api);

router.get('/', asyncHandler(controller.listar));
router.get('/pendente', asyncHandler(controller.paginasPendentes));
router.post('/pendente', asyncHandler(controller.conectarPaginas));
router.post('/aplicar-em-todas', asyncHandler(publicacao.aplicarEmTodas));
router.get('/canais', asyncHandler(publicacao.canais));
router.put('/canais/:canalId', asyncHandler(publicacao.definirCanal));
router.post('/:network/conectar', asyncHandler(controller.iniciarConexao));
router.delete('/:id', asyncHandler(controller.desconectar));
router.post('/:id/testar', asyncHandler(controller.testar));

router.get('/:id/publicacao', asyncHandler(publicacao.obterConfig));
router.put('/:id/horarios', asyncHandler(publicacao.salvarHorarios));
router.put('/:id/pausa', asyncHandler(publicacao.pausar));
router.put('/:id/auto-post', asyncHandler(publicacao.publicarSozinho));
router.put('/:id/opcoes', asyncHandler(publicacao.salvarOpcoes));
router.get('/:id/pinterest/pastas', asyncHandler(publicacao.pastasDoPinterest));
router.get('/:id/fila', asyncHandler(publicacao.fila));
router.get('/:id/publicados', asyncHandler(publicacao.publicados));
router.get('/:id/erros', asyncHandler(publicacao.erros));
router.put('/:id/ordem', asyncHandler(publicacao.ordenar));
router.post('/:id/corrigir-horarios', asyncHandler(publicacao.corrigirHorarios));

module.exports = router;
