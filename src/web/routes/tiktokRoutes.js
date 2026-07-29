'use strict';

const express = require('express');
const tiktokController = require('../controllers/tiktokController');
const requireAuth = require('../middleware/requireAuth');
const requireRole = require('../middleware/requireRole');
const asyncHandler = require('../lib/asyncHandler');
const { ROLES } = require('../../config/constants');

const router = express.Router();

router.use(requireAuth, requireRole([ROLES.CLIENT, ROLES.ADMIN]));

router.get('/connect', tiktokController.connect);
router.get('/callback', asyncHandler(tiktokController.callback));

module.exports = router;
