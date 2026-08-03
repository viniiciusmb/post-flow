// Testa se um tunel SSH (founder ou de um cliente) esta funcionando de
// verdade - busca o IP direto da VPS e o IP passando pelo proxy SOCKS5
// daquele tunel especifico; se forem diferentes, o tunel esta saindo pela
// internet de quem conectou (evidencia real). Roda periodicamente (todos os
// tuneis) e tambem sob demanda (1 tunel so, quando o usuario clica "Testar
// conexao").
'use strict';

const https = require('https');
const { SocksProxyAgent } = require('socks-proxy-agent');
const config = require('../../config');
const downloadTunnelsRepository = require('../../repositories/downloadTunnelsRepository');
const creditsUnlockService = require('../../services/creditsUnlockService');
const logger = require('../../lib/logger');

const IP_CHECK_URL = 'https://api.ipify.org?format=json';

function fetchIp(agent) {
  return new Promise((resolve, reject) => {
    const req = https.get(IP_CHECK_URL, { agent, timeout: 10_000 }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data).ip);
        } catch (err) {
          reject(new Error(`Resposta inesperada do servico de IP: ${err.message}`));
        }
      });
    });
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Tempo esgotado (10s) esperando resposta.'));
    });
    req.on('error', reject);
  });
}

async function testTunnel(tunnel) {
  const result = { testedAt: new Date().toISOString() };

  try {
    result.directIp = await fetchIp(undefined);
  } catch (err) {
    result.directError = err.message;
  }

  if (config.tunnel.relaySocksHost) {
    try {
      const socksUrl = `socks5://${config.tunnel.relaySocksHost}:${tunnel.assigned_port}`;
      const agent = new SocksProxyAgent(socksUrl);
      result.proxiedIp = await fetchIp(agent);
      result.success = Boolean(result.proxiedIp) && result.proxiedIp !== result.directIp;
    } catch (err) {
      result.proxiedError = err.message;
      result.success = false;
    }
  } else {
    result.proxiedError = 'TUNNEL_RELAY_SOCKS_HOST nao configurado.';
    result.success = false;
  }

  const estavaConectado = tunnel.connected === true;
  await downloadTunnelsRepository.markTestResult(tunnel.id, { connected: result.success, result });
  logger.info(`Teste do tunel #${tunnel.id} (${tunnel.owner_type}) concluido: ${JSON.stringify(result)}`);

  // Acabou de VOLTAR: devolve pra fila o que estava esperando por ele. So na
  // transicao (desconectado -> conectado) pra nao reenfileirar a cada teste.
  if (tunnel.owner_type === 'client' && tunnel.client_user_id && result.success && !estavaConectado) {
    await creditsUnlockService
      .unlockAwaitingTunnelForClient(tunnel.client_user_id)
      .catch((err) => logger.error(`Falha ao destravar videos do cliente ${tunnel.client_user_id}:`, err.message));
  }

  return result;
}

// Sob demanda - 1 tunel especifico (botao "Testar conexao" no painel).
async function runOne(tunnelId) {
  const tunnels = await downloadTunnelsRepository.listAll();
  // pg devolve BIGINT como string - comparar com Number() dos dois lados
  // evita o mesmo bug de comparacao ja visto com outros ids BIGINT no projeto.
  const tunnel = tunnels.find((t) => Number(t.id) === Number(tunnelId));
  if (!tunnel) throw new Error(`Tunel #${tunnelId} nao encontrado.`);
  return testTunnel(tunnel);
}

// Periodico - todos os tuneis, pra manter o campo "connected" atualizado
// (usado na hora de escolher qual tunel usar pra um download).
async function runAll() {
  const tunnels = await downloadTunnelsRepository.listAll();
  for (const tunnel of tunnels) {
    await testTunnel(tunnel);
  }
}

module.exports = { runOne, runAll };
