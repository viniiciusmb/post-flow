'use strict';

const metricsRepository = require('../../../repositories/metricsRepository');
const downloadTunnelsRepository = require('../../../repositories/downloadTunnelsRepository');
const settingsRepository = require('../../../repositories/settingsRepository');
const config = require('../../../config');
const { resolveRange } = require('../../../lib/dateRanges');

const RESIDENTIAL_PROXY_ENABLED_KEY = 'residential_proxy_enabled';

async function overview(req, res) {
  const { range, since, until } = resolveRange(req.query.range);

  const [byEgress, byClient, allTunnels, proxyEnabled] = await Promise.all([
    metricsRepository.bandwidthByEgressSince(since, until),
    metricsRepository.bandwidthByClientSince(since, until),
    downloadTunnelsRepository.listAll(),
    settingsRepository.getValue(RESIDENTIAL_PROXY_ENABLED_KEY, true),
  ]);

  const founderTunnel = allTunnels.find((t) => t.owner_type === 'founder') || null;
  const clientTunnels = allTunnels.filter((t) => t.owner_type === 'client');

  res.json({
    range: { key: range, since, until },
    byEgress,
    byClient,
    founderTunnel: founderTunnel
      ? {
          id: founderTunnel.id,
          enabled: founderTunnel.enabled,
          connected: founderTunnel.connected,
          lastCheckedAt: founderTunnel.last_checked_at,
        }
      : null,
    proxy: {
      configured: Boolean(config.youtube.proxyUrl),
      enabled: proxyEnabled,
    },
    clientTunnels: clientTunnels.map((t) => ({
      id: t.id,
      clientUserId: t.client_user_id,
      label: t.label,
      enabled: t.enabled,
      connected: t.connected,
    })),
  });
}

async function toggleFounderTunnel(req, res) {
  const founderTunnel = await downloadTunnelsRepository.findFounderTunnel();
  if (!founderTunnel) return res.status(404).json({ error: res.locals.t('erros.nenhumFallback') });

  const updated = await downloadTunnelsRepository.setEnabled(founderTunnel.id, Boolean(req.body.enabled));
  res.json({ enabled: updated.enabled });
}

async function toggleProxy(req, res) {
  const enabled = Boolean(req.body.enabled);
  await settingsRepository.setValue(RESIDENTIAL_PROXY_ENABLED_KEY, enabled);
  res.json({ enabled });
}

module.exports = { overview, toggleFounderTunnel, toggleProxy };
