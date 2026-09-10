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
router.post('/:id/queue-gate', asyncHandler(controller.setQueueGate));
router.post('/:id/tiktok-account', asyncHandler(controller.setTiktokAccount));
router.post('/:id/export-folder', asyncHandler(controller.setExportFolder));
router.post('/:id/drive-export-mode', asyncHandler(controller.setDriveExportMode));
// Mostra qual e o video mais recente (sem cadastrar), pro cliente decidir.
router.get('/:id/latest-video', asyncHandler(controller.latestVideo));
router.put('/:id/max-video-minutes', asyncHandler(controller.setMaxVideoMinutes));
router.post('/:id/process-latest-video', asyncHandler(controller.processLatestVideo));
router.put('/:id/audio-language', asyncHandler(controller.setAudioLanguage));
router.delete('/:id', asyncHandler(controller.remove));

module.exports = router;
