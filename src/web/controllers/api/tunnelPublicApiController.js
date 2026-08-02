// Rota SEM autenticacao - quem chama e o programa de bandeja instalado no
// aparelho do cliente/founder (nao tem sessao de login nenhuma). So cria uma
// linha pendente com um codigo de pareamento; a linha so vira "de verdade"
// (autorizada no rele) quando o cliente cola o codigo no painel, ja logado
// (ver clientTunnelApiController.completePairing).
'use strict';

const downloadTunnelsRepository = require('../../../repositories/downloadTunnelsRepository');
const config = require('../../../config');

const KEY_LINE_RE = /^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp256|ecdsa-sha2-nistp384|ecdsa-sha2-nistp521) [A-Za-z0-9+/=]+(?: .*)?$/;

async function registerPending(req, res) {
  const publicKey = String(req.body.publicKey || '').trim();
  const label = String(req.body.label || '').trim();

  if (!KEY_LINE_RE.test(publicKey) || publicKey.includes('\n')) {
    return res.status(400).json({ error: 'publicKey inválida.' });
  }

  const tunnel = await downloadTunnelsRepository.createPendingPairing({ publicKey, label });

  res.json({
    pairingCode: tunnel.pairing_code,
    sshHost: config.tunnel.relayPublicHost,
    sshPort: Number(config.tunnel.relayPublicPort),
    assignedPort: tunnel.assigned_port,
    sshUser: 'tunnel',
  });
}

module.exports = { registerPending };
