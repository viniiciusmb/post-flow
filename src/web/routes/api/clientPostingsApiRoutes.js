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
router.post('/:id/post-now', asyncHandler(controller.postNow));
router.post('/:id/retry', asyncHandler(controller.retry));
// Opcoes de publicacao exigidas pela auditoria da Content Posting API.
router.get('/accounts/:id/creator-options', asyncHandler(controller.creatorOptions));
router.put('/:id/options', asyncHandler(controller.saveOptions));
router.delete('/:id/options', asyncHandler(controller.clearOptions));

module.exports = router;
