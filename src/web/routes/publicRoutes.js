'use strict';

const express = require('express');
const publicController = require('../controllers/publicController');
const asyncHandler = require('../lib/asyncHandler');

const router = express.Router();

router.get('/', asyncHandler(publicController.landing));
router.get('/termos', publicController.terms);
router.get('/privacidade', publicController.privacy);
router.get('/contato', publicController.contact);

module.exports = router;
