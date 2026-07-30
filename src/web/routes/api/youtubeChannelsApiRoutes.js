'use strict';

const express = require('express');
const controller = require('../../controllers/api/youtubeChannelsApiController');
const requireAuthApi = require('../../middleware/requireAuthApi');
const requireRoleApi = require('../../middleware/requireRoleApi');
const asyncHandler = require('../../lib/asyncHandler');
const { ROLES } = require('../../../config/constants');

const router = express.Router();

router.use(requireAuthApi, requireRoleApi([ROLES.CLIENT, ROLES.ADMIN]));

router.get('/', asyncHandler(controller.list));
router.post('/', asyncHandler(controller.create));
router.post('/:id/active', asyncHandler(controller.setActive));
router.post('/:id/export-folder', asyncHandler(controller.setExportFolder));
router.delete('/:id', asyncHandler(controller.remove));

module.exports = router;
