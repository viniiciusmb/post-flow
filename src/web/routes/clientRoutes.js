'use strict';

const express = require('express');
const clientController = require('../controllers/clientController');
const requireAuth = require('../middleware/requireAuth');
const requireRole = require('../middleware/requireRole');
const asyncHandler = require('../lib/asyncHandler');
const { ROLES } = require('../../config/constants');

const router = express.Router();

router.use(requireAuth, requireRole(ROLES.CLIENT));

router.get('/', asyncHandler(clientController.dashboard));

module.exports = router;
