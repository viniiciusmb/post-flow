'use strict';

const express = require('express');
const controller = require('../../controllers/api/adminCommissionsApiController');
const requireAuthApi = require('../../middleware/requireAuthApi');
const requireRoleApi = require('../../middleware/requireRoleApi');
const asyncHandler = require('../../lib/asyncHandler');
const { ROLES } = require('../../../config/constants');

const router = express.Router();

router.use(requireAuthApi, requireRoleApi(ROLES.ADMIN));

router.get('/overview', asyncHandler(controller.overview));
router.get('/affiliates', asyncHandler(controller.listAffiliates));
router.put('/affiliates/:userId/percent', asyncHandler(controller.setAffiliatePercent));
router.get('/settings', asyncHandler(controller.getSettings));
router.put('/settings', asyncHandler(controller.putSettings));
router.get('/withdrawals', asyncHandler(controller.listWithdrawals));
router.post('/withdrawals/:id/approve', asyncHandler(controller.approveWithdrawal));
router.post('/withdrawals/:id/reject', asyncHandler(controller.rejectWithdrawal));
router.get('/links', asyncHandler(controller.listLinks));
router.post('/links', asyncHandler(controller.createLink));

module.exports = router;
