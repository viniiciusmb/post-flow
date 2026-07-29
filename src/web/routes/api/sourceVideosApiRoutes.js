'use strict';

const express = require('express');
const controller = require('../../controllers/api/sourceVideosApiController');
const requireAuthApi = require('../../middleware/requireAuthApi');
const requireRoleApi = require('../../middleware/requireRoleApi');
const asyncHandler = require('../../lib/asyncHandler');
const { ROLES } = require('../../../config/constants');

const router = express.Router();

router.use(requireAuthApi, requireRoleApi([ROLES.CLIENT, ROLES.ADMIN]));

router.get('/', asyncHandler(controller.list));
router.post('/manual', asyncHandler(controller.createManual));
router.get('/:id/clips', asyncHandler(controller.listClips));
router.post('/:id/retry', asyncHandler(controller.retry));
router.get('/clips/:id/download', asyncHandler(controller.downloadClip));

module.exports = router;
