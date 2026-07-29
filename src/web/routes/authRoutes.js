'use strict';

const express = require('express');
const authController = require('../controllers/authController');
const asyncHandler = require('../lib/asyncHandler');
const serveSpaPage = require('../lib/serveSpaPage');

const router = express.Router();

router.get('/login', serveSpaPage('login'));
router.post('/login', asyncHandler(authController.login));
router.get('/register', authController.showRegister);
router.post('/register', asyncHandler(authController.register));
router.post('/logout', authController.logout);

module.exports = router;
