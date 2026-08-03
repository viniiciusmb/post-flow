'use strict';

const express = require('express');
const publicController = require('../controllers/publicController');
const seoController = require('../controllers/seoController');
const asyncHandler = require('../lib/asyncHandler');

const router = express.Router();

router.get('/', asyncHandler(publicController.landing));
router.get('/termos', publicController.terms);
router.get('/privacidade', publicController.privacy);
router.get('/contato', publicController.contact);

// Lidos por buscador e por IA. Servidos por rota (nao como arquivo estatico)
// pra nunca divergirem do que o site realmente tem - ver seoController.
router.get('/robots.txt', seoController.robots);
router.get('/sitemap.xml', seoController.sitemap);
router.get('/llms.txt', asyncHandler(seoController.llms));

module.exports = router;
