'use strict';

const config = require('../../../config');
const settingsRepository = require('../../../repositories/settingsRepository');
const queueService = require('../../../services/queueService');

const QUEUE_TAILSCALE_TEST = 'tailscale-test';
const SETTINGS_KEY = 'tailscale_test_result';

async function status(req, res) {
  const lastResult = await settingsRepository.getValue(SETTINGS_KEY, null);
  res.json({
    configured: Boolean(config.youtube.tailscaleProxyUrl),
    lastResult,
  });
}

async function test(req, res) {
  const boss = await queueService.getBoss();
  await boss.send(QUEUE_TAILSCALE_TEST, {});
  res.status(202).json({ started: true });
}

module.exports = { status, test };
