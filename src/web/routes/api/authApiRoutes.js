'use strict';

const express = require('express');
const authApiController = require('../../controllers/api/authApiController');
const passwordResetApiController = require('../../controllers/api/passwordResetApiController');
const requireAuthApi = require('../../middleware/requireAuthApi');
const asyncHandler = require('../../lib/asyncHandler');

const router = express.Router();

router.post('/login', asyncHandler(authApiController.login));
router.post('/logout', requireAuthApi, authApiController.logout);
router.get('/me', requireAuthApi, authApiController.me);

// Recuperacao de senha. Sem requireAuthApi: quem esqueceu a senha nao esta
// logado. O que protege aqui e o token do link (uso unico, 30min, so o hash no
// banco) mais o limite de tentativas aplicado em app.js.
router.post('/forgot-password', asyncHandler(passwordResetApiController.request));
router.get('/reset-password', asyncHandler(passwordResetApiController.check));
router.post('/reset-password', asyncHandler(passwordResetApiController.reset));

module.exports = router;
