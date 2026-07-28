'use strict';

const express = require('express');
const googleController = require('../controllers/googleController');
const requireAuth = require('../middleware/requireAuth');
const requireRole = require('../middleware/requireRole');
const asyncHandler = require('../lib/asyncHandler');
const { ROLES } = require('../../config/constants');

const router = express.Router();

router.use(requireAuth, requireRole(ROLES.ADMIN));

router.get('/connect', googleController.connect);
router.get('/callback', asyncHandler(googleController.callback));

module.exports = router;
