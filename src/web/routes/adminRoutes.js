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
router.get('/costs', serveSpaPage('admin-costs'));
router.get('/revenue', serveSpaPage('admin-revenue'));
router.get('/billing', serveSpaPage('admin-billing'));
router.get('/commissions', serveSpaPage('admin-commissions'));
router.get('/narrated', serveSpaPage('admin-narrated'));
router.get('/lives', serveSpaPage('admin-lives'));
router.get('/errors', serveSpaPage('admin-errors'));
// Mesma tela, só com os erros das novidades em teste (painel novo).
router.get('/errors-teste', serveSpaPage('admin-errors'));
router.get('/support', serveSpaPage('admin-support'));

module.exports = router;
