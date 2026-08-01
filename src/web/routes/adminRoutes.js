'use strict';

const express = require('express');
const requireAuth = require('../middleware/requireAuth');
const requireRole = require('../middleware/requireRole');
const serveSpaPage = require('../lib/serveSpaPage');
const { ROLES } = require('../../config/constants');

const router = express.Router();

router.use(requireAuth, requireRole(ROLES.ADMIN));

router.get('/', serveSpaPage('admin'));
router.get('/clients', serveSpaPage('admin-clients'));
router.get('/postings', serveSpaPage('admin-postings'));
router.get('/queue', serveSpaPage('admin-queue'));
router.get('/metrics', serveSpaPage('admin-metrics'));
router.get('/bandwidth', serveSpaPage('bandwidth'));
router.get('/billing', serveSpaPage('admin-billing'));

module.exports = router;
