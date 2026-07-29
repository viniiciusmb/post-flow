'use strict';

const express = require('express');
const authApiController = require('../../controllers/api/authApiController');
const requireAuthApi = require('../../middleware/requireAuthApi');
const asyncHandler = require('../../lib/asyncHandler');

const router = express.Router();

router.post('/login', asyncHandler(authApiController.login));
router.post('/logout', requireAuthApi, authApiController.logout);
router.get('/me', requireAuthApi, authApiController.me);

module.exports = router;
