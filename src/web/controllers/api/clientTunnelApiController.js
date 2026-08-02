'use strict';

const downloadTunnelsRepository = require('../../../repositories/downloadTunnelsRepository');
const sshRelayControlService = require('../../../services/sshRelayControlService');
const queueService = require('../../../services/queueService');
const logger = require('../../../lib/logger');

const QUEUE_TUNNEL_TEST_ONE = 'tunnel-test-one';

function tunnelToApi(tunnel) {
  if (!tunnel) return null;
  return {
    id: tunnel.id,
    label: tunnel.label,
    connected: tunnel.connected,
    lastCheckedAt: tunnel.last_checked_at,
    lastTestResult: tunnel.last_test_result,
    paired: !tunnel.pairing_code,
  };
}

async function status(req, res) {
  const tunnel = await downloadTunnelsRepository.findByClientId(req.session.user.id);
  res.json({ tunnel: tunnelToApi(tunnel) });
}

async function completePairing(req, res) {
  const pairingCode = String(req.body.pairingCode || '').trim().toUpperCase();
  if (!pairingCode) return res.status(400).json({ error: 'Informe o código de pareamento.' });

  const existing = await downloadTunnelsRepository.findByClientId(req.session.user.id);
  if (existing) {
    return res.status(400).json({ error: 'Você já tem um programa conectado. Desconecte o atual antes de parear outro.' });
  }

  const pending = await downloadTunnelsRepository.findByPairingCode(pairingCode);
  if (!pending) {
    return res.status(400).json({ error: 'Código inválido ou expirado. Gere um novo no programa.' });
  }

  // Autoriza no rele ANTES de vincular ao cliente - se isso falhar, a linha
  // continua pendente (o cliente so ve "codigo invalido" e pode tentar de
  // novo), em vez de ficar "pareada" no banco mas sem chave autorizada de
  // verdade no servidor (estado inconsistente).
  try {
    await sshRelayControlService.authorize(pending.public_key, pending.assigned_port, pending.label);
  } catch (err) {
    logger.error(`Falha ao autorizar o tunel #${pending.id} no rele:`, err);
    return res.status(502).json({ error: 'Não consegui autorizar o programa no servidor. Tente de novo em instantes.' });
  }

  const tunnel = await downloadTunnelsRepository.completePairing(pairingCode, req.session.user.id);
  if (!tunnel) {
    return res.status(400).json({ error: 'Código inválido ou expirado. Gere um novo no programa.' });
  }

  res.json({ tunnel: tunnelToApi(tunnel) });
}

async function test(req, res) {
  const tunnel = await downloadTunnelsRepository.findByClientId(req.session.user.id);
  if (!tunnel) return res.status(404).json({ error: 'Nenhum programa conectado ainda.' });

  const boss = await queueService.getBoss();
  await boss.send(QUEUE_TUNNEL_TEST_ONE, { tunnelId: tunnel.id });
  res.status(202).json({ started: true });
}

async function disconnect(req, res) {
  const tunnel = await downloadTunnelsRepository.findByClientId(req.session.user.id);
  if (!tunnel) return res.status(404).json({ error: 'Nenhum programa conectado ainda.' });

  try {
    await sshRelayControlService.revoke(tunnel.assigned_port);
  } catch (err) {
    logger.error(`Falha ao revogar o tunel #${tunnel.id} no rele:`, err);
  }
  await downloadTunnelsRepository.removeByClientId(req.session.user.id);
  res.status(204).end();
}

module.exports = { status, completePairing, test, disconnect };
