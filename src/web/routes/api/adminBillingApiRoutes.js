'use strict';

const express = require('express');
const controller = require('../../controllers/api/adminBillingApiController');
const requireAuthApi = require('../../middleware/requireAuthApi');
const requireRoleApi = require('../../middleware/requireRoleApi');
const asyncHandler = require('../../lib/asyncHandler');
const { ROLES } = require('../../../config/constants');

const router = express.Router();

router.use(requireAuthApi, requireRoleApi(ROLES.ADMIN));

router.get('/clients', asyncHandler(controller.listClients));
router.get('/plans', asyncHandler(controller.listPlans));
router.post('/clients/:clientUserId/plan', asyncHandler(controller.assignPlan));
router.get('/overage', asyncHandler(controller.overageSummary));

module.exports = router;
