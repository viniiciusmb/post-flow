// Servidor de controle bem pequeno que roda dentro do sidecar do rele SSH,
// ao lado do sshd isolado. So o backend do Post Flow fala com ele (rede
// interna do Docker Swarm, sem dominio publico) - gerencia quem pode abrir
// um tunel (linha no authorized_keys do usuario "tunnel", restrita a uma
// porta especifica via "permitlisten").
'use strict';

const http = require('http');
const fs = require('fs');

const PORT = Number(process.env.CONTROL_PORT || 8080);
const AUTHORIZED_KEYS_PATH = process.env.AUTHORIZED_KEYS_PATH || '/home/tunnel/.ssh/authorized_keys';

const KEY_LINE_RE = /^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp256|ecdsa-sha2-nistp384|ecdsa-sha2-nistp521) [A-Za-z0-9+/=]+(?: .*)?$/;

function isValidPublicKey(value) {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (trimmed.includes('\n') || trimmed.includes('\r')) return false;
  return KEY_LINE_RE.test(trimmed);
}

function isValidPort(value) {
  const port = Number(value);
  return Number.isInteger(port) && port >= 20000 && port <= 29999;
}

function readLines() {
  if (!fs.existsSync(AUTHORIZED_KEYS_PATH)) return [];
  return fs
    .readFileSync(AUTHORIZED_KEYS_PATH, 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > 0);
}

function writeLines(lines) {
  fs.writeFileSync(AUTHORIZED_KEYS_PATH, lines.join('\n') + (lines.length ? '\n' : ''), { mode: 0o600 });
}

function portMarker(port) {
  return `permitlisten="${port}"`;
}

function authorize(publicKey, port, label) {
  const marker = portMarker(port);
  const safeLabel = String(label || 'tunnel').replace(/[^\w .-]/g, '').slice(0, 60);
  const line = `restrict,${marker} ${publicKey.trim()} ${safeLabel}`;
  const lines = readLines().filter((existing) => !existing.includes(marker));
  lines.push(line);
  writeLines(lines);
}

function revoke(port) {
  const marker = portMarker(port);
  const lines = readLines().filter((existing) => !existing.includes(marker));
  writeLines(lines);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/health') {
      return send(res, 200, { ok: true });
    }

    if (req.method === 'POST' && req.url === '/authorize') {
      const body = await readJsonBody(req);
      if (!isValidPublicKey(body.publicKey)) return send(res, 400, { error: 'publicKey invalida.' });
      if (!isValidPort(body.port)) return send(res, 400, { error: 'port invalida (precisa ser 20000-29999).' });
      authorize(body.publicKey, Number(body.port), body.label);
      return send(res, 200, { ok: true });
    }

    if (req.method === 'POST' && req.url === '/revoke') {
      const body = await readJsonBody(req);
      if (!isValidPort(body.port)) return send(res, 400, { error: 'port invalida.' });
      revoke(Number(body.port));
      return send(res, 200, { ok: true });
    }

    send(res, 404, { error: 'not found' });
  } catch (err) {
    send(res, 503, { error: err.message });
  }
});

server.listen(PORT, () => {
  console.log(`Servidor de controle do rele SSH rodando na porta ${PORT}`);
});
