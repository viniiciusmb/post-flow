'use strict';

const express = require('express');
const adminApiController = require('../../controllers/api/adminApiController');
const adminQueueApiController = require('../../controllers/api/adminQueueApiController');
const adminMetricsApiController = require('../../controllers/api/adminMetricsApiController');
const adminTailscaleApiController = require('../../controllers/api/adminTailscaleApiController');
const adminBandwidthApiController = require('../../controllers/api/adminBandwidthApiController');
const requireAuthApi = require('../../middleware/requireAuthApi');
const requireRoleApi = require('../../middleware/requireRoleApi');
const asyncHandler = require('../../lib/asyncHandler');
const { ROLES } = require('../../../config/constants');

const router = express.Router();

router.use(requireAuthApi, requireRoleApi(ROLES.ADMIN));

router.get('/dashboard', asyncHandler(adminApiController.dashboard));
router.get('/clients', asyncHandler(adminApiController.clients));
router.get('/postings', asyncHandler(adminApiController.postings));
router.get('/queue', asyncHandler(adminQueueApiController.overview));
router.post('/queue/:id/retry', asyncHandler(adminQueueApiController.retry));
router.get('/metrics', asyncHandler(adminMetricsApiController.overview));
router.get('/tailscale/status', asyncHandler(adminTailscaleApiController.status));
router.post('/tailscale/test', asyncHandler(adminTailscaleApiController.test));
router.get('/bandwidth', asyncHandler(adminBandwidthApiController.overview));
router.post('/bandwidth/founder-tunnel/toggle', asyncHandler(adminBandwidthApiController.toggleFounderTunnel));
router.post('/bandwidth/proxy/toggle', asyncHandler(adminBandwidthApiController.toggleProxy));

module.exports = router;
