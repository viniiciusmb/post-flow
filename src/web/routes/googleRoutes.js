'use strict';

const express = require('express');
const googleController = require('../controllers/googleController');
const googleLoginController = require('../controllers/googleLoginController');
const requireAuth = require('../middleware/requireAuth');
const requireRole = require('../middleware/requireRole');
const asyncHandler = require('../lib/asyncHandler');
const { ROLES } = require('../../config/constants');

const router = express.Router();

// ENTRAR com Google: publico de proposito, e por isso vem ANTES do requireAuth
// abaixo (no Express, o middleware so vale pras rotas declaradas depois dele).
// Quem esta entrando ainda nao tem sessao - exigir login aqui seria pedir que a
// pessoa entrasse pra poder entrar.
router.get('/login', googleLoginController.start);
router.get('/login/callback', asyncHandler(googleLoginController.callback));

// Daqui pra baixo e a conexao do Google DRIVE, que so faz sentido pra quem ja
// esta logado.
router.use(requireAuth, requireRole([ROLES.ADMIN, ROLES.CLIENT]));

router.get('/connect', googleController.connect);
router.get('/callback', asyncHandler(googleController.callback));

module.exports = router;
