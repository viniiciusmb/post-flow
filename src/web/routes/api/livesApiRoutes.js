'use strict';

// Tela "Lives" (a que vai pros clientes). Ainda em teste: so o admin abre,
// pelo mesmo motivo da Flora no comeco - o fundador testa antes de abrir.
// Para abrir aos clientes: trocar requireRoleApi(ROLES.ADMIN) por
// [ROLES.CLIENT, ROLES.ADMIN] aqui, a mesma troca em clientRoutes.js
// (/client/lives) e o item "menu.lives" no CLIENT_GROUPS do app-sidebar.
const express = require('express');
const livesApiController = require('../../controllers/api/livesApiController');
const requireAuthApi = require('../../middleware/requireAuthApi');
const requireRoleApi = require('../../middleware/requireRoleApi');
const asyncHandler = require('../../lib/asyncHandler');
const { ROLES } = require('../../../config/constants');

const router = express.Router();

router.use(requireAuthApi, requireRoleApi(ROLES.ADMIN));

router.get('/', asyncHandler(livesApiController.estado));
router.put('/opcoes', asyncHandler(livesApiController.salvarOpcoes));
router.get('/estilo', asyncHandler(livesApiController.obterEstilo));
router.put('/estilo', asyncHandler(livesApiController.salvarEstilo));
router.post('/canais', asyncHandler(livesApiController.adicionarCanal));
router.delete('/canais/:id', asyncHandler(livesApiController.removerCanal));
router.put('/canais/:id/automatico', asyncHandler(livesApiController.definirAutomatico));
router.post('/canais/:id/clipar-esta-live', asyncHandler(livesApiController.cliparEstaLive));
router.delete('/canais/:id/clipar-esta-live', asyncHandler(livesApiController.pararEstaLive));
router.post('/canais/:id/clipar-agora', asyncHandler(livesApiController.cliparAgora));
router.get('/cortes', asyncHandler(livesApiController.listarCortes));
router.get('/cortes/:id/arquivo', asyncHandler(livesApiController.arquivoDoCorte));
router.delete('/cortes/:id', asyncHandler(livesApiController.apagarCorte));

module.exports = router;
