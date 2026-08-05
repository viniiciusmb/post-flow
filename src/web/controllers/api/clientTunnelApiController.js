'use strict';

const downloadTunnelsRepository = require('../../../repositories/downloadTunnelsRepository');
const sshRelayControlService = require('../../../services/sshRelayControlService');
const queueService = require('../../../services/queueService');
const creditsUnlockService = require('../../../services/creditsUnlockService');
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
    // true = só baixar com o computador dele ligado; false = deixar sair pela
    // nossa banda quando ele estiver desligado.
    requireClientTunnel: tunnel.require_client_tunnel === true,
  };
}

async function status(req, res) {
  const tunnel = await downloadTunnelsRepository.findByClientId(req.session.user.id);
  res.json({ tunnel: tunnelToApi(tunnel) });
}

// Escolha do cliente: esperar o computador dele, ou deixar o download sair pela
// nossa banda quando ele estiver desligado. Só faz sentido pra quem já tem o
// programa pareado - por isso devolve 404 sem túnel, em vez de criar um.
async function setRequireTunnel(req, res) {
  const tunnel = await downloadTunnelsRepository.findByClientId(req.session.user.id);
  if (!tunnel) return res.status(404).json({ error: res.locals.t('erros.programaNaoConectado') });

  const atualizado = await downloadTunnelsRepository.setRequireClientTunnel(
    req.session.user.id,
    req.body.requireClientTunnel === true
  );

  // Desligou a exigência: o que estava esperando o computador dele pode sair
  // agora pela nossa banda. Sem isso, o vídeo ficaria parado até o computador
  // voltar mesmo depois de a pessoa ter dito que não quer mais esperar.
  if (atualizado && !atualizado.require_client_tunnel) {
    await creditsUnlockService
      .unlockAwaitingTunnelForClient(req.session.user.id)
      .catch((err) => logger.error('Falha ao destravar videos que esperavam a conexao:', err.message));
  }

  res.json({ tunnel: tunnelToApi(atualizado) });
}

async function completePairing(req, res) {
  const pairingCode = String(req.body.pairingCode || '').trim().toUpperCase();
  if (!pairingCode) return res.status(400).json({ error: res.locals.t('erros.informeCodigo') });

  const existing = await downloadTunnelsRepository.findByClientId(req.session.user.id);
  if (existing) {
    return res.status(400).json({ error: res.locals.t('erros.jaTemPrograma') });
  }

  const pending = await downloadTunnelsRepository.findByPairingCode(pairingCode);
  if (!pending) {
    return res.status(400).json({ error: res.locals.t('erros.codigoInvalido') });
  }

  // Autoriza no rele ANTES de vincular ao cliente - se isso falhar, a linha
  // continua pendente (o cliente so ve "codigo invalido" e pode tentar de
  // novo), em vez de ficar "pareada" no banco mas sem chave autorizada de
  // verdade no servidor (estado inconsistente).
  try {
    await sshRelayControlService.authorize(pending.public_key, pending.assigned_port, pending.label);
  } catch (err) {
    logger.error(`Falha ao autorizar o tunel #${pending.id} no rele:`, err);
    return res.status(502).json({ error: res.locals.t('erros.naoAutorizouPrograma') });
  }

  const tunnel = await downloadTunnelsRepository.completePairing(pairingCode, req.session.user.id);
  if (!tunnel) {
    return res.status(400).json({ error: res.locals.t('erros.codigoInvalido') });
  }

  res.json({ tunnel: tunnelToApi(tunnel) });
}

async function test(req, res) {
  const tunnel = await downloadTunnelsRepository.findByClientId(req.session.user.id);
  if (!tunnel) return res.status(404).json({ error: res.locals.t('erros.nenhumPrograma') });

  const boss = await queueService.getBoss();
  await boss.send(QUEUE_TUNNEL_TEST_ONE, { tunnelId: tunnel.id });
  res.status(202).json({ started: true });
}

async function disconnect(req, res) {
  const tunnel = await downloadTunnelsRepository.findByClientId(req.session.user.id);
  if (!tunnel) return res.status(404).json({ error: res.locals.t('erros.nenhumPrograma') });

  try {
    await sshRelayControlService.revoke(tunnel.assigned_port);
  } catch (err) {
    logger.error(`Falha ao revogar o tunel #${tunnel.id} no rele:`, err);
  }
  await downloadTunnelsRepository.removeByClientId(req.session.user.id);
  res.status(204).end();
}

module.exports = {
  setRequireTunnel, status, completePairing, test, disconnect };
