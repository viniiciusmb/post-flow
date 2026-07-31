'use strict';

const express = require('express');
const controller = require('../../controllers/api/clientBillingApiController');
const requireAuthApi = require('../../middleware/requireAuthApi');
const requireRoleApi = require('../../middleware/requireRoleApi');
const asyncHandler = require('../../lib/asyncHandler');
const { ROLES } = require('../../../config/constants');

const router = express.Router();

router.use(requireAuthApi, requireRoleApi(ROLES.CLIENT));

router.get('/overview', asyncHandler(controller.overview));
router.post('/subscribe', asyncHandler(controller.subscribe));
router.post('/buy-package', asyncHandler(controller.buyPackage));
router.post('/overage-card/setup', asyncHandler(controller.setupOverageCard));
router.post('/overage-card/disable', asyncHandler(controller.disableOverageCard));

module.exports = router;
