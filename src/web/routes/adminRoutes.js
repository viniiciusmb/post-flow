'use strict';

const express = require('express');
const adminController = require('../controllers/adminController');
const requireAuth = require('../middleware/requireAuth');
const requireRole = require('../middleware/requireRole');
const asyncHandler = require('../lib/asyncHandler');
const { ROLES } = require('../../config/constants');

const router = express.Router();

router.use(requireAuth, requireRole(ROLES.ADMIN));

router.get('/', asyncHandler(adminController.dashboard));
router.get('/clients', asyncHandler(adminController.listClients));
router.get('/postings', asyncHandler(adminController.listPostings));

module.exports = router;
