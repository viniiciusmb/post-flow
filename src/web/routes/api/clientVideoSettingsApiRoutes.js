'use strict';

const path = require('path');
const fs = require('fs');
const express = require('express');
const multer = require('multer');
const controller = require('../../controllers/api/clientVideoSettingsApiController');
const templateController = require('../../controllers/api/backgroundTemplateApiController');
const requireAuthApi = require('../../middleware/requireAuthApi');
const requireRoleApi = require('../../middleware/requireRoleApi');
const asyncHandler = require('../../lib/asyncHandler');
const config = require('../../../config');
const { ROLES } = require('../../../config/constants');

const router = express.Router();

router.use(requireAuthApi, requireRoleApi([ROLES.CLIENT, ROLES.ADMIN]));

// Template de fundo. Limite baixo de propósito: é uma imagem 1080x1920, não um
// arquivo de design. O tipo real é conferido pelos BYTES dentro do controller
// (extensão e content-type são escolhidos por quem envia, então não valem como
// verificação).
const uploadsTemp = path.join(config.videoProcessing.workDir, 'uploads-temp');
const uploadTemplate = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      fs.mkdirSync(uploadsTemp, { recursive: true });
      cb(null, uploadsTemp);
    },
    filename: (req, file, cb) => cb(null, `tpl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
  }),
  limits: { fileSize: 8 * 1024 * 1024 },
});

router.get('/', asyncHandler(controller.get));
router.put('/', asyncHandler(controller.update));

// Faz um canal voltar a seguir a configuração de todos os canais.
router.delete('/channel/:channelId', asyncHandler(controller.removeChannelStyle));

router.post('/background-template', uploadTemplate.single('image'), asyncHandler(templateController.upload));
router.get('/background-template', asyncHandler(templateController.download));
router.delete('/background-template', asyncHandler(templateController.remove));

module.exports = router;
