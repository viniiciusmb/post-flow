'use strict';

const express = require('express');
const clientApiController = require('../../controllers/api/clientApiController');
const requireAuthApi = require('../../middleware/requireAuthApi');
const requireRoleApi = require('../../middleware/requireRoleApi');
const asyncHandler = require('../../lib/asyncHandler');
const { ROLES } = require('../../../config/constants');

const router = express.Router();

router.use(requireAuthApi, requireRoleApi(ROLES.CLIENT));

router.get('/dashboard', asyncHandler(clientApiController.dashboard));

module.exports = router;
