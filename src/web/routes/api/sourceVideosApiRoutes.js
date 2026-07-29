'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const controller = require('../../controllers/api/sourceVideosApiController');
const requireAuthApi = require('../../middleware/requireAuthApi');
const requireRoleApi = require('../../middleware/requireRoleApi');
const asyncHandler = require('../../lib/asyncHandler');
const config = require('../../../config');
const { ROLES } = require('../../../config/constants');

const router = express.Router();

router.use(requireAuthApi, requireRoleApi([ROLES.CLIENT, ROLES.ADMIN]));

const uploadsDir = path.join(config.videoProcessing.workDir, 'uploads');
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      fs.mkdirSync(uploadsDir, { recursive: true });
      cb(null, uploadsDir);
    },
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname) || '.mp4';
      cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`);
    },
  }),
  limits: { fileSize: 2 * 1024 * 1024 * 1024 }, // 2GB
  fileFilter: (req, file, cb) => {
    cb(null, file.mimetype.startsWith('video/'));
  },
});

router.get('/', asyncHandler(controller.list));
router.post('/manual', asyncHandler(controller.createManual));
router.post('/upload', upload.single('video'), asyncHandler(controller.uploadVideo));
router.get('/:id/clips', asyncHandler(controller.listClips));
router.post('/:id/retry', asyncHandler(controller.retry));
router.post('/:id/cancel', asyncHandler(controller.cancel));
router.delete('/:id', asyncHandler(controller.remove));
router.get('/clips/:id/download', asyncHandler(controller.downloadClip));
router.get('/clips/:id/thumbnail', asyncHandler(controller.clipThumbnail));

module.exports = router;
