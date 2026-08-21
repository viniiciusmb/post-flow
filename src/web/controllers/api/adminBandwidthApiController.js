'use strict';

const metricsRepository = require('../../../repositories/metricsRepository');
const downloadTunnelsRepository = require('../../../repositories/downloadTunnelsRepository');
const sharedVideoAssetsRepository = require('../../../repositories/sharedVideoAssetsRepository');
const settingsRepository = require('../../../repositories/settingsRepository');
const config = require('../../../config');
const { resolveRange } = require('../../../lib/dateRanges');

const RESIDENTIAL_PROXY_ENABLED_KEY = 'residential_proxy_enabled';
const RESIDENTIAL_PROXY_PURCHASED_BYTES_KEY = 'residential_proxy_purchased_bytes';

async function overview(req, res) {
  const { range, since, until } = resolveRange(req.query.range);

  const [byEgress, byClient, allTunnels, proxyEnabled, purchasedBytes, consumedAllTimeBytes, economia] =
    await Promise.all([
      metricsRepository.bandwidthByEgressSince(since, until),
      metricsRepository.bandwidthByClientSince(since, until),
      downloadTunnelsRepository.listAll(),
      settingsRepository.getValue(RESIDENTIAL_PROXY_ENABLED_KEY, true),
      settingsRepository.getValue(RESIDENTIAL_PROXY_PURCHASED_BYTES_KEY, 0),
      metricsRepository.bandwidthProxyAllTimeBytes(),
      // Quanto deixou de ser gasto porque dois clientes monitoram o mesmo
      // canal e o video foi baixado/transcrito uma vez so.
      sharedVideoAssetsRepository.savingsSince(since, until),
    ]);

  const founderTunnel = allTunnels.find((t) => t.owner_type === 'founder') || null;
  const clientTunnels = allTunnels.filter((t) => t.owner_type === 'client');

  res.json({
    range: { key: range, since, until },
    byEgress,
    byClient,
    economia,
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
      purchasedBytes,
      consumedAllTimeBytes,
      remainingBytes: Math.max(0, purchasedBytes - consumedAllTimeBytes),
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

// Saldo comprado e um numero absoluto (nao acumula sozinho) - toda vez que
// o admin recarregar GB no provedor, atualiza aqui pro valor novo total.
async function setProxyPurchased(req, res) {
  const purchasedGb = Number(req.body.purchasedGb);
  if (!Number.isFinite(purchasedGb) || purchasedGb < 0) {
    return res.status(400).json({ error: res.locals.t('erros.valorInvalido') });
  }
  const purchasedBytes = Math.round(purchasedGb * 1024 ** 3);
  await settingsRepository.setValue(RESIDENTIAL_PROXY_PURCHASED_BYTES_KEY, purchasedBytes);
  res.json({ purchasedBytes });
}

module.exports = { overview, toggleFounderTunnel, toggleProxy, setProxyPurchased };
