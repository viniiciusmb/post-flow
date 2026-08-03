'use strict';

const express = require('express');
const controller = require('../../controllers/api/clientTunnelApiController');
const requireAuthApi = require('../../middleware/requireAuthApi');
const requireRoleApi = require('../../middleware/requireRoleApi');
const asyncHandler = require('../../lib/asyncHandler');
const { ROLES } = require('../../../config/constants');

const router = express.Router();

router.use(requireAuthApi, requireRoleApi([ROLES.CLIENT, ROLES.ADMIN]));

router.get('/', asyncHandler(controller.status));
router.post('/pair', asyncHandler(controller.completePairing));
router.post('/test', asyncHandler(controller.test));
router.put('/require-tunnel', asyncHandler(controller.setRequireTunnel));
router.delete('/', asyncHandler(controller.disconnect));

module.exports = router;
