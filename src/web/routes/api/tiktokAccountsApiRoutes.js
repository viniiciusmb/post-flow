'use strict';

const express = require('express');
const controller = require('../../controllers/api/tiktokAccountsApiController');
const requireAuthApi = require('../../middleware/requireAuthApi');
const requireRoleApi = require('../../middleware/requireRoleApi');
const asyncHandler = require('../../lib/asyncHandler');
const { ROLES } = require('../../../config/constants');

const router = express.Router();

router.use(requireAuthApi, requireRoleApi([ROLES.CLIENT, ROLES.ADMIN]));

router.get('/', asyncHandler(controller.list));
router.post('/:id/deactivate', asyncHandler(controller.deactivate));
router.put('/:id/auto-post', asyncHandler(controller.setAutoPost));
router.put('/:id/publish-mode', asyncHandler(controller.setPublishMode));
router.get('/:id/schedule', asyncHandler(controller.getSchedule));
router.put('/:id/schedule', asyncHandler(controller.setSchedule));
router.put('/:id/queue-pause', asyncHandler(controller.setQueuePaused));
router.post('/:id/fix-schedule', asyncHandler(controller.fixSchedule));
router.put('/:id/queue-order', asyncHandler(controller.setQueueOrder));

module.exports = router;
