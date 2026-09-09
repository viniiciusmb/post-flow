'use strict';

const express = require('express');
const controller = require('../../controllers/api/clientCommissionsApiController');
const requireAuthApi = require('../../middleware/requireAuthApi');
const requireRoleApi = require('../../middleware/requireRoleApi');
const asyncHandler = require('../../lib/asyncHandler');
const { ROLES } = require('../../../config/constants');

const router = express.Router();

router.use(requireAuthApi, requireRoleApi([ROLES.CLIENT, ROLES.ADMIN]));

router.get('/overview', asyncHandler(controller.overview));
router.post('/links', asyncHandler(controller.createLink));
router.put('/links/:id', asyncHandler(controller.renameLink));
router.post('/links/:id/archive', asyncHandler(controller.archiveLink));
router.put('/pix-key', asyncHandler(controller.updatePixKey));
router.post('/withdraw', asyncHandler(controller.requestWithdrawal));

module.exports = router;
