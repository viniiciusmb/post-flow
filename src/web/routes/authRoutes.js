'use strict';

const express = require('express');
const authController = require('../controllers/authController');
const asyncHandler = require('../lib/asyncHandler');
const serveSpaPage = require('../lib/serveSpaPage');

const router = express.Router();

router.get('/login', serveSpaPage('login'));
router.post('/login', asyncHandler(authController.login));
// Recuperacao de senha: paginas publicas de proposito - quem esqueceu a senha
// nao consegue entrar pra pedir nada.
router.get('/esqueci-senha', serveSpaPage('forgot-password'));
router.get('/redefinir-senha', serveSpaPage('reset-password'));

router.get('/register', authController.showRegister);
router.post('/register', asyncHandler(authController.register));
router.post('/logout', authController.logout);

module.exports = router;
