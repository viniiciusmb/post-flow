'use strict';

const express = require('express');
const adminApiController = require('../../controllers/api/adminApiController');
const adminQueueApiController = require('../../controllers/api/adminQueueApiController');
const adminMetricsApiController = require('../../controllers/api/adminMetricsApiController');
const adminBandwidthApiController = require('../../controllers/api/adminBandwidthApiController');
const adminCostsApiController = require('../../controllers/api/adminCostsApiController');
const adminErrorsApiController = require('../../controllers/api/adminErrorsApiController');
const adminNarratedApiController = require('../../controllers/api/adminNarratedApiController');
const adminLivesApiController = require('../../controllers/api/adminLivesApiController');
const requireAuthApi = require('../../middleware/requireAuthApi');
const requireRoleApi = require('../../middleware/requireRoleApi');
const asyncHandler = require('../../lib/asyncHandler');
const { ROLES } = require('../../../config/constants');
const adminRevenueApiController = require('../../controllers/api/adminRevenueApiController');
const adminSupportApiController = require('../../controllers/api/adminSupportApiController');

const router = express.Router();

router.use(requireAuthApi, requireRoleApi(ROLES.ADMIN));

router.get('/dashboard', asyncHandler(adminApiController.dashboard));
router.get('/support', asyncHandler(adminSupportApiController.list));
router.get('/support/:id', asyncHandler(adminSupportApiController.detail));
router.post('/support/:id/status', asyncHandler(adminSupportApiController.setStatus));
router.get('/clients', asyncHandler(adminApiController.clients));
// Canais do YouTube e contas do TikTok de UM cliente - ver clientConnections.
router.get('/clients/:id/connections', asyncHandler(adminApiController.clientConnections));
// Teto de criadores ativos do app no TikTok - ver tiktokCapacityService.
router.post('/tiktok-limit', asyncHandler(adminApiController.setTiktokLimit));
router.post('/tiktok-limit/snooze', asyncHandler(adminApiController.snoozeTiktokLimit));
router.get('/postings', asyncHandler(adminApiController.postings));
router.get('/queue', asyncHandler(adminQueueApiController.overview));
router.post('/queue/:id/retry', asyncHandler(adminQueueApiController.retry));
router.get('/metrics', asyncHandler(adminMetricsApiController.overview));
// Quantos videos processar ao mesmo tempo - ver videoConcurrencyService.
router.post('/metrics/max-simultaneos', asyncHandler(adminMetricsApiController.setMaxSimultaneos));
router.get('/costs', asyncHandler(adminCostsApiController.overview));
router.get('/revenue', asyncHandler(adminRevenueApiController.overview));
router.post('/costs/cotacao', asyncHandler(adminCostsApiController.setCotacao));
router.post('/costs/infra', asyncHandler(adminCostsApiController.setInfra));
// Saldo das contas de IA - ver saldoDasIasService.
router.get('/costs/ai-balances', asyncHandler(adminCostsApiController.saldosDasIas));
router.post('/costs/ai-balances/:provedor', asyncHandler(adminCostsApiController.informarSaldoDeIa));
// Video narrado a partir de um roteiro - MODO DE TESTE, so admin. Fica atras
// do requireRoleApi(ADMIN) montado no topo deste arquivo: e o mesmo guarda que
// protege o resto do painel, e e ele que mantem o recurso invisivel pros
// clientes enquanto esta em teste.
router.get('/narrated', asyncHandler(adminNarratedApiController.list));
router.post('/narrated/preview', asyncHandler(adminNarratedApiController.preview));
router.post('/narrated', asyncHandler(adminNarratedApiController.create));
router.get('/narrated/:id', asyncHandler(adminNarratedApiController.detail));
router.get('/narrated/:id/download', asyncHandler(adminNarratedApiController.download));
router.delete('/narrated/:id', asyncHandler(adminNarratedApiController.remove));
// Cortes de lives da Twitch - fase de validacao, so admin (ver
// docs/CHECKLIST_MIGRACAO_E_LIVES.md).
router.get('/lives', asyncHandler(adminLivesApiController.estado));
router.put('/lives/config', asyncHandler(adminLivesApiController.salvarConfig));
router.put('/lives/opcoes', asyncHandler(adminLivesApiController.salvarOpcoes));
router.get('/lives/estilo', asyncHandler(adminLivesApiController.obterEstilo));
router.put('/lives/estilo', asyncHandler(adminLivesApiController.salvarEstilo));
router.post('/lives/canais', asyncHandler(adminLivesApiController.adicionarCanal));
router.delete('/lives/canais/:id', asyncHandler(adminLivesApiController.removerCanal));
router.post('/lives/canais/:id/pausar', asyncHandler(adminLivesApiController.pausarCanal));
router.post('/lives/canais/:id/retomar', asyncHandler(adminLivesApiController.retomarCanal));
router.post('/lives/canais/:id/clipar-agora', asyncHandler(adminLivesApiController.cliparAgora));
router.get('/lives/cortes', asyncHandler(adminLivesApiController.listarCortes));
router.get('/lives/cortes/:id/arquivo', asyncHandler(adminLivesApiController.arquivoDoCorte));
router.delete('/lives/cortes/:id', asyncHandler(adminLivesApiController.apagarCorte));

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
