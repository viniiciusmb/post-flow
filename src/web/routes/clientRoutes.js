'use strict';

const express = require('express');
const requireAuth = require('../middleware/requireAuth');
const requireRole = require('../middleware/requireRole');
const serveSpaPage = require('../lib/serveSpaPage');
const { ROLES } = require('../../config/constants');

const router = express.Router();

router.use(requireAuth, requireRole([ROLES.CLIENT, ROLES.ADMIN]));

router.get('/', serveSpaPage('client'));
router.get('/youtube-channels', serveSpaPage('youtube-channels'));
router.get('/videos-clips', serveSpaPage('videos-clips'));
router.get('/tiktok-account', serveSpaPage('tiktok-account'));
router.get('/settings', serveSpaPage('client-settings'));
router.get('/tunnel', serveSpaPage('tunnel'));
router.get('/billing', serveSpaPage('client-billing'));
// Checkout transparente: o pagamento acontece aqui dentro, sem sair do site.
router.get('/checkout', serveSpaPage('client-checkout'));
router.get('/commissions', serveSpaPage('client-commissions'));
router.get('/tutorial', serveSpaPage('tutorial'));

module.exports = router;
