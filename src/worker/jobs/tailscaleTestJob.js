// Testa se o rele Tailscale (YTDLP_TAILSCALE_PROXY_URL) esta configurado e
// realmente saindo por um IP diferente do IP direto da VPS - a evidencia de
// que o rele funciona e o IP "via rele" ser diferente do IP "direto" (o
// aparelho que virou saida tem seu proprio IP residencial). So roda quando
// pedido pela tela admin "Tailscale" (sem agendamento fixo).
'use strict';

const https = require('https');
const { SocksProxyAgent } = require('socks-proxy-agent');
const config = require('../../config');
const settingsRepository = require('../../repositories/settingsRepository');
const logger = require('../../lib/logger');

const IP_CHECK_URL = 'https://api.ipify.org?format=json';
const SETTINGS_KEY = 'tailscale_test_result';

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

async function run() {
  const proxyUrl = config.youtube.tailscaleProxyUrl;
  const result = { testedAt: new Date().toISOString(), configured: Boolean(proxyUrl) };

  try {
    result.directIp = await fetchIp(undefined);
  } catch (err) {
    result.directError = err.message;
  }

  if (proxyUrl) {
    try {
      const agent = new SocksProxyAgent(proxyUrl);
      result.proxiedIp = await fetchIp(agent);
      result.success = Boolean(result.proxiedIp) && result.proxiedIp !== result.directIp;
    } catch (err) {
      result.proxiedError = err.message;
      result.success = false;
    }
  } else {
    result.success = false;
  }

  await settingsRepository.setValue(SETTINGS_KEY, result);
  logger.info(`Teste do rele Tailscale concluido: ${JSON.stringify(result)}`);
}

module.exports = { run, SETTINGS_KEY };
