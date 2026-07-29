'use strict';

const express = require('express');
const requireAuth = require('../middleware/requireAuth');
const requireRole = require('../middleware/requireRole');
const serveSpaPage = require('../lib/serveSpaPage');
const { ROLES } = require('../../config/constants');

const router = express.Router();

router.use(requireAuth, requireRole(ROLES.CLIENT));

router.get('/', serveSpaPage('client'));
router.get('/youtube-channels', serveSpaPage('youtube-channels'));
router.get('/videos-clips', serveSpaPage('videos-clips'));
router.get('/tiktok-account', serveSpaPage('tiktok-account'));

module.exports = router;
