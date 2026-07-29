'use strict';

const express = require('express');
const controller = require('../../controllers/api/clientDriveApiController');
const requireAuthApi = require('../../middleware/requireAuthApi');
const requireRoleApi = require('../../middleware/requireRoleApi');
const asyncHandler = require('../../lib/asyncHandler');
const { ROLES } = require('../../../config/constants');

const router = express.Router();

router.use(requireAuthApi, requireRoleApi([ROLES.CLIENT, ROLES.ADMIN]));

router.get('/', asyncHandler(controller.status));
router.post('/folder', asyncHandler(controller.setFolder));

module.exports = router;
