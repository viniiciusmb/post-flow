'use strict';

const express = require('express');
const adminApiController = require('../../controllers/api/adminApiController');
const requireAuthApi = require('../../middleware/requireAuthApi');
const requireRoleApi = require('../../middleware/requireRoleApi');
const asyncHandler = require('../../lib/asyncHandler');
const { ROLES } = require('../../../config/constants');

const router = express.Router();

router.use(requireAuthApi, requireRoleApi(ROLES.ADMIN));

router.get('/dashboard', asyncHandler(adminApiController.dashboard));

module.exports = router;
