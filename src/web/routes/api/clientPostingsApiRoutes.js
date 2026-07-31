'use strict';

const express = require('express');
const controller = require('../../controllers/api/clientPostingsApiController');
const requireAuthApi = require('../../middleware/requireAuthApi');
const requireRoleApi = require('../../middleware/requireRoleApi');
const asyncHandler = require('../../lib/asyncHandler');
const { ROLES } = require('../../../config/constants');

const router = express.Router();

router.use(requireAuthApi, requireRoleApi([ROLES.CLIENT, ROLES.ADMIN]));

router.get('/queue', asyncHandler(controller.listQueue));
router.get('/posted', asyncHandler(controller.listPosted));
router.get('/errors', asyncHandler(controller.listErrors));
router.put('/:id/caption', asyncHandler(controller.updateCaption));
router.post('/:id/skip', asyncHandler(controller.skip));

module.exports = router;
