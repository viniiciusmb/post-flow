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
router.get('/:id/clips', asyncHandler(controller.listClips));

module.exports = router;
