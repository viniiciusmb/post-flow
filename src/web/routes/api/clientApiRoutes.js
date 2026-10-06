'use strict';

const express = require('express');
const clientApiController = require('../../controllers/api/clientApiController');
const onboardingApiController = require('../../controllers/api/onboardingApiController');
const clientNoticesApiController = require('../../controllers/api/clientNoticesApiController');
const clientSupportApiController = require('../../controllers/api/clientSupportApiController');
const requireAuthApi = require('../../middleware/requireAuthApi');
const requireRoleApi = require('../../middleware/requireRoleApi');
const asyncHandler = require('../../lib/asyncHandler');
const { ROLES } = require('../../../config/constants');

const router = express.Router();

router.use(requireAuthApi, requireRoleApi([ROLES.CLIENT, ROLES.ADMIN]));

router.get('/dashboard', asyncHandler(clientApiController.dashboard));
router.get('/profile', asyncHandler(clientApiController.getProfile));
router.put('/profile', asyncHandler(clientApiController.updateProfile));
router.put('/password', asyncHandler(clientApiController.updatePassword));
router.get('/usage', asyncHandler(clientApiController.usage));
router.get('/onboarding', asyncHandler(onboardingApiController.status));
router.get('/notices', asyncHandler(clientNoticesApiController.list));
router.post('/notices/:id/dismiss', asyncHandler(clientNoticesApiController.dismiss));
// Flora (suporte com IA) so para o admin enquanto esta em teste. Para abrir
// aos clientes: tirar o requireRoleApi destas duas linhas e da rota da pagina
// (clientRoutes.js), e devolver o item "menu.flora" ao CLIENT_GROUPS do menu.
router.get('/support', requireRoleApi(ROLES.ADMIN), asyncHandler(clientSupportApiController.current));
router.post('/support/messages', requireRoleApi(ROLES.ADMIN), asyncHandler(clientSupportApiController.send));

module.exports = router;
