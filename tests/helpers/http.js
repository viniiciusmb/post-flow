// Sobe o app Express de verdade num porta livre e devolve um "navegador" de
// mentira que guarda cookies e reenvia o token anti-CSRF - do jeito que a SPA
// faz. Assim os testes exercitam a pilha inteira (rota + middleware de sessao +
// CSRF + controller + repositorio), nao so a camada de baixo.
'use strict';

const bcrypt = require('bcryptjs');
const pool = require('../../src/db/pool');

let server;
let baseUrl;

async function startServer() {
  if (server) return baseUrl;
  const app = require('../../src/web/app');
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  return baseUrl;
}

async function stopServer() {
  if (!server) return;
  await new Promise((resolve) => server.close(resolve));
  server = undefined;
  baseUrl = undefined;
}

let userCounter = 0;

// Cria um cliente com senha de verdade (hash bcrypt) pra poder logar por HTTP.
async function createLoginableClient({ role = 'client', password = 'senha-de-teste-123' } = {}) {
  userCounter += 1;
  const email = `http${userCounter}_${Date.now()}@teste.local`;
  const hash = await bcrypt.hash(password, 4); // custo baixo: e teste, nao producao
  const { rows } = await pool.query(
    `INSERT INTO users (email, password_hash, role, business_name)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [email, hash, role, `Empresa ${userCounter}`]
  );
  return { ...rows[0], password };
}

// Guarda cookies entre chamadas (sessao + csrf_token), igual um navegador.
function createAgent(url) {
  const cookies = new Map();

  function cookieHeader() {
    return [...cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  function absorve(response) {
    for (const raw of response.headers.getSetCookie?.() || []) {
      const [par] = raw.split(';');
      const igual = par.indexOf('=');
      if (igual > 0) cookies.set(par.slice(0, igual).trim(), par.slice(igual + 1).trim());
    }
  }

  async function request(method, path, body) {
    const headers = { cookie: cookieHeader() };
    if (body !== undefined) headers['content-type'] = 'application/json';
    // Mesmo comportamento do web-client/src/lib/api.ts: reenvia no cabecalho o
    // token que o servidor deixou no cookie legivel.
    const token = cookies.get('csrf_token');
    if (token) headers['x-csrf-token'] = decodeURIComponent(token);

    const response = await fetch(`${url}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'manual',
    });
    absorve(response);
    const texto = await response.text();
    let json;
    try {
      json = JSON.parse(texto);
    } catch {
      json = null;
    }
    // headers vem junto porque redirecionamento e comportamento testavel: em
    // fluxo de pagina (cadastro, login) o que importa e PRA ONDE foi, e isso
    // so esta no Location.
    return { status: response.status, body: json, text: texto, headers: response.headers };
  }

  return {
    get: (path) => request('GET', path),
    post: (path, body) => request('POST', path, body ?? {}),
    put: (path, body) => request('PUT', path, body ?? {}),
    delete: (path) => request('DELETE', path),
    // Envia SEM o cabecalho de CSRF - e assim que um site malicioso mandaria.
    postSemCsrf: async (path, body) => {
      const response = await fetch(`${url}${path}`, {
        method: 'POST',
        headers: { cookie: cookieHeader(), 'content-type': 'application/json' },
        body: JSON.stringify(body ?? {}),
        redirect: 'manual',
      });
      return { status: response.status };
    },
    async login(email, password) {
      // GET primeiro pra receber o cookie de CSRF, igual abrir a pagina - mas
      // na LANDING, nao no /login.
      //
      // Motivo: /login esta na lista do limitador de forca bruta (20 pedidos
      // por IP a cada 15 min), e o GET conta junto com o POST. Cada login
      // gastava DOIS do orcamento, entao um arquivo com 11 testes estourava o
      // limite e falhava com 429 - uma falha que parece bug do sistema e e do
      // teste. O middleware de CSRF e global, entao qualquer GET serve pra
      // pegar o cookie.
      await request('GET', '/');
      const r = await request('POST', '/api/auth/login', { email, password });
      if (r.status !== 200) throw new Error(`login falhou (${r.status}): ${r.text}`);
      return r;
    },
  };
}

module.exports = { startServer, stopServer, createLoginableClient, createAgent };
