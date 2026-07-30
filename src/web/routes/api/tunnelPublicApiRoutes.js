'use strict';

const express = require('express');
const controller = require('../../controllers/api/tunnelPublicApiController');
const asyncHandler = require('../../lib/asyncHandler');

const router = express.Router();

// SEM requireAuthApi de proposito - quem chama e o programa de bandeja
// instalado no aparelho, sem sessao de login nenhuma (ver controller).
router.post('/register-pending', asyncHandler(controller.registerPending));

module.exports = router;
