// Servidor de controle bem pequeno que roda dentro do sidecar do rele
// Tailscale, ao lado do containerboot oficial. So o video-worker fala com
// ele (rede interna do Docker Swarm, sem dominio publico) - sem essas rotas
// nao ha como escolher DINAMICAMENTE qual cliente vira "saida" antes de
// cada download, ja que a propria Tailscale so troca de exit-node via
// comando `tailscale set`, nao por variavel de ambiente.
'use strict';

const http = require('http');
const { execFile } = require('child_process');

const PORT = Number(process.env.CONTROL_PORT || 8080);

function runTailscale(args) {
  return new Promise((resolve, reject) => {
    execFile('tailscale', args, { timeout: 15_000 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr?.trim() || err.message));
      resolve(stdout);
    });
  });
}

async function listPeers() {
  const stdout = await runTailscale(['status', '--json']);
  const status = JSON.parse(stdout);
  const peers = Object.values(status.Peer || {});
  return peers.map((p) => ({
    hostname: p.HostName,
    tailscaleIp: p.TailscaleIPs?.[0] || null,
    online: Boolean(p.Online),
    exitNodeOption: Boolean(p.ExitNodeOption),
  }));
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

    if (req.method === 'GET' && req.url === '/peers') {
      const peers = await listPeers();
      return send(res, 200, { peers });
    }

    if (req.method === 'POST' && req.url === '/exit-node') {
      const body = await readJsonBody(req);
      const hostname = String(body.hostname || '').trim();
      if (!hostname) return send(res, 400, { error: 'hostname obrigatorio.' });
      await runTailscale(['set', `--exit-node=${hostname}`]);
      return send(res, 200, { ok: true, exitNode: hostname });
    }

    if (req.method === 'POST' && req.url === '/exit-node/clear') {
      await runTailscale(['set', '--exit-node=']);
      return send(res, 200, { ok: true });
    }

    send(res, 404, { error: 'not found' });
  } catch (err) {
    send(res, 503, { error: err.message });
  }
});

server.listen(PORT, () => {
  console.log(`Servidor de controle do rele Tailscale rodando na porta ${PORT}`);
});
