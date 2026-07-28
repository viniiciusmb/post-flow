'use strict';

const express = require('express');
const authController = require('../controllers/authController');
const asyncHandler = require('../lib/asyncHandler');

const router = express.Router();

router.get('/login', authController.showLogin);
router.post('/login', asyncHandler(authController.login));
router.get('/register', authController.showRegister);
router.post('/register', asyncHandler(authController.register));
router.post('/logout', authController.logout);

module.exports = router;
