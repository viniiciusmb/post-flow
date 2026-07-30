// Fala com o servidor de controle do sidecar do rele SSH
// (docker/ssh-relay/control-server.js) - endpoint interno, sem dominio
// publico, so alcancavel de dentro da rede do Docker Swarm.
'use strict';

const config = require('../config');

function baseUrl() {
  const url = config.tunnel.relayControlUrl;
  if (!url) throw new Error('TUNNEL_RELAY_CONTROL_URL nao configurado.');
  return url.replace(/\/$/, '');
}

async function authorize(publicKey, port, label) {
  const response = await fetch(`${baseUrl()}/authorize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ publicKey, port, label }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Rele respondeu ${response.status}.`);
  }
}

async function revoke(port) {
  const response = await fetch(`${baseUrl()}/revoke`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ port }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Rele respondeu ${response.status}.`);
  }
}

module.exports = { authorize, revoke };
