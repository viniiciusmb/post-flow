'use strict';

const express = require('express');
const clientApiController = require('../../controllers/api/clientApiController');
const requireAuthApi = require('../../middleware/requireAuthApi');
const requireRoleApi = require('../../middleware/requireRoleApi');
const asyncHandler = require('../../lib/asyncHandler');
const { ROLES } = require('../../../config/constants');

const router = express.Router();

router.use(requireAuthApi, requireRoleApi([ROLES.CLIENT, ROLES.ADMIN]));

router.get('/dashboard', asyncHandler(clientApiController.dashboard));
router.get('/tiktok-account', asyncHandler(clientApiController.tiktokAccount));
router.get('/usage', asyncHandler(clientApiController.usage));

module.exports = router;
