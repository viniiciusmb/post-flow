'use strict';

const express = require('express');
const adminApiController = require('../../controllers/api/adminApiController');
const adminQueueApiController = require('../../controllers/api/adminQueueApiController');
const adminMetricsApiController = require('../../controllers/api/adminMetricsApiController');
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

module.exports = router;
