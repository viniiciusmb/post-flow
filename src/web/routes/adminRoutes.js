'use strict';

const express = require('express');
const adminController = require('../controllers/adminController');
const driveController = require('../controllers/driveController');
const adminQueueController = require('../controllers/adminQueueController');
const requireAuth = require('../middleware/requireAuth');
const requireRole = require('../middleware/requireRole');
const asyncHandler = require('../lib/asyncHandler');
const serveSpaPage = require('../lib/serveSpaPage');
const { ROLES } = require('../../config/constants');

const router = express.Router();

router.use(requireAuth, requireRole(ROLES.ADMIN));

router.get('/', serveSpaPage('admin'));
router.get('/clients', asyncHandler(adminController.listClients));
router.get('/postings', asyncHandler(adminController.listPostings));

router.get('/drive', asyncHandler(driveController.manage));
router.post('/drive/general-folder', asyncHandler(driveController.setGeneralFolder));
router.post('/drive/client-folder', asyncHandler(driveController.setClientFolder));

router.get('/queue', asyncHandler(adminQueueController.show));
router.post('/queue/:id/retry', asyncHandler(adminQueueController.retry));

module.exports = router;
