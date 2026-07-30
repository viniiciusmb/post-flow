// Fala com o servidor de controle do sidecar do rele Tailscale
// (docker/tailscale-relay/control-server.js) - endpoint interno, sem
// dominio publico, so alcancavel de dentro da rede do Docker Swarm.
'use strict';

const config = require('../config');

function baseUrl() {
  const url = config.tailscale.relayUrl;
  if (!url) throw new Error('TAILSCALE_RELAY_URL nao configurado.');
  return url.replace(/\/$/, '');
}

async function listPeers() {
  const response = await fetch(`${baseUrl()}/peers`, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Rele respondeu ${response.status}.`);
  }
  const data = await response.json();
  return data.peers;
}

async function setExitNode(hostname) {
  const response = await fetch(`${baseUrl()}/exit-node`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hostname }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Rele respondeu ${response.status}.`);
  }
}

async function clearExitNode() {
  const response = await fetch(`${baseUrl()}/exit-node/clear`, {
    method: 'POST',
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Rele respondeu ${response.status}.`);
  }
}

module.exports = { listPeers, setExitNode, clearExitNode };
