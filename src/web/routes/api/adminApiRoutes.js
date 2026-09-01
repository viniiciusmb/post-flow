'use strict';

const express = require('express');
const adminApiController = require('../../controllers/api/adminApiController');
const adminQueueApiController = require('../../controllers/api/adminQueueApiController');
const adminMetricsApiController = require('../../controllers/api/adminMetricsApiController');
const adminBandwidthApiController = require('../../controllers/api/adminBandwidthApiController');
const adminErrorsApiController = require('../../controllers/api/adminErrorsApiController');
const requireAuthApi = require('../../middleware/requireAuthApi');
const requireRoleApi = require('../../middleware/requireRoleApi');
const asyncHandler = require('../../lib/asyncHandler');
const { ROLES } = require('../../../config/constants');

const router = express.Router();

router.use(requireAuthApi, requireRoleApi(ROLES.ADMIN));

router.get('/dashboard', asyncHandler(adminApiController.dashboard));
router.get('/clients', asyncHandler(adminApiController.clients));
// Teto de criadores ativos do app no TikTok - ver tiktokCapacityService.
router.post('/tiktok-limit', asyncHandler(adminApiController.setTiktokLimit));
router.post('/tiktok-limit/snooze', asyncHandler(adminApiController.snoozeTiktokLimit));
router.get('/postings', asyncHandler(adminApiController.postings));
router.get('/queue', asyncHandler(adminQueueApiController.overview));
router.post('/queue/:id/retry', asyncHandler(adminQueueApiController.retry));
router.get('/metrics', asyncHandler(adminMetricsApiController.overview));
// Quantos videos processar ao mesmo tempo - ver videoConcurrencyService.
router.post('/metrics/max-simultaneos', asyncHandler(adminMetricsApiController.setMaxSimultaneos));
router.get('/bandwidth', asyncHandler(adminBandwidthApiController.overview));
router.post('/bandwidth/founder-tunnel/toggle', asyncHandler(adminBandwidthApiController.toggleFounderTunnel));
router.post('/bandwidth/proxy/toggle', asyncHandler(adminBandwidthApiController.toggleProxy));
router.post('/bandwidth/mostrar-tunel', asyncHandler(adminBandwidthApiController.toggleMostrarTunel));
router.post('/bandwidth/proxy/purchased', asyncHandler(adminBandwidthApiController.setProxyPurchased));

// Painel de erros. Fica atras do requireRoleApi(ADMIN) la de cima - a lista
// junta falhas de TODOS os clientes, entao nao pode vazar pra ninguem mais.
router.get('/errors', asyncHandler(adminErrorsApiController.list));
router.post('/errors/:id/retry', asyncHandler(adminErrorsApiController.retry));
router.post('/errors/:id/resolve', asyncHandler(adminErrorsApiController.resolve));

module.exports = router;
