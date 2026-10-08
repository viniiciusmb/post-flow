// Conexão das contas do Instagram e do Facebook pela Outstand (08/10/2026),
// e o painel novo que só algumas contas veem.
//
// O que mais importa aqui é a VOLTA da autorização: a URL de retorno traz o id
// da conta conectada e qualquer um pode montá-la à mão. Os testes provam que a
// conta só é vinculada a quem iniciou a conexão, e nunca à conta de outro.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const pool = require('../../src/db/pool');
const config = require('../../src/config');
const settingsRepository = require('../../src/repositories/settingsRepository');
const painelNovo = require('../../src/lib/painelNovo');
const { startServer, stopServer, createLoginableClient, createAgent } = require('../helpers/http');

let url;
let outstand;
const chamadas = [];
const contas = new Map(); // id -> conta como a Outstand devolve
const removidas = [];

test.before(async () => {
  outstand = http.createServer((req, res) => {
    let bruto = '';
    req.on('data', (c) => (bruto += c));
    req.on('end', () => {
      const [caminho, query] = req.url.split('?');
      const corpo = bruto ? JSON.parse(bruto) : null;
      chamadas.push({ metodo: req.method, caminho, corpo });
      const responde = (status, body) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(body));
      };
      let m;
      if (req.method === 'POST' && (m = caminho.match(/^\/v1\/social-networks\/(\w+)\/auth-url$/))) {
        return responde(200, { success: true, data: { auth_url: `https://outstand.test/${m[1]}?tenant_id=${corpo.tenant_id}` } });
      }
      if (req.method === 'GET' && caminho === '/v1/social-accounts') {
        const id = new URLSearchParams(query).get('id');
        return responde(200, { success: true, data: contas.has(id) ? [contas.get(id)] : [] });
      }
      if (req.method === 'GET' && (m = caminho.match(/^\/v1\/social-accounts\/pending\/(.+)$/))) {
        if (m[1] !== 'tok-fb') return responde(404, { success: false, error: 'expired' });
        return responde(200, {
          success: true,
          data: {
            network: 'facebook',
            availablePages: [
              { id: 'pg1', type: 'page', name: 'Loja do Teste', profilePictureUrl: 'https://img/p.jpg', category: 'Loja' },
              { id: 'pg2', type: 'page', name: 'Outra Página' },
            ],
          },
        });
      }
      if (req.method === 'POST' && (m = caminho.match(/^\/v1\/social-accounts\/pending\/(.+)\/finalize$/))) {
        const ids = corpo.selectedPageIds;
        return responde(200, {
          success: true,
          connectedAccounts: ids.map((id) => ({ id: `fb_${id}_${process.pid}`, nickname: `Página ${id}`, username: id, network: 'facebook', accountType: 'page' })),
        });
      }
      if (req.method === 'DELETE' && (m = caminho.match(/^\/v1\/social-accounts\/(.+)$/))) {
        removidas.push(m[1]);
        return responde(200, { success: true });
      }
      responde(404, { success: false, error: 'rota falsa nao existe' });
    });
  });
  await new Promise((r) => outstand.listen(0, '127.0.0.1', r));
  config.outstand.apiKey = 'chave-de-teste';
  config.outstand.baseUrlOverride = `http://127.0.0.1:${outstand.address().port}`;
  url = await startServer();
});

test.after(async () => {
  await stopServer();
  await new Promise((r) => outstand.close(r));
  await pool.end();
});

async function logado({ noPainelNovo = true, role = 'client' } = {}) {
  const u = await createLoginableClient({ role });
  if (noPainelNovo && role === 'client') {
    const atuais = await painelNovo.idsLiberados();
    await settingsRepository.setValue(painelNovo.CHAVE, [...atuais, Number(u.id)]);
  }
  const agent = createAgent(url);
  await agent.login(u.email, u.password);
  return { u, agent };
}

let n = 0;
function contaNaOutstand({ network = 'instagram', tenant }) {
  const id = `acc_${process.pid}_${n++}`;
  contas.set(id, { id, network, tenant_id: tenant, username: `perfil${n}`, nickname: `Perfil ${n}`, profile_picture_url: null, accountType: 'business' });
  return id;
}

const local = (r) => r.headers.get('location') || '';

test('quem nao esta no painel novo nao ve as telas nem as rotas novas', async () => {
  const { agent } = await logado({ noPainelNovo: false });
  assert.equal((await agent.get('/api/client/social-accounts')).status, 403);
  assert.equal((await agent.get('/api/client/lives')).status, 403);
  assert.equal(local(await agent.get('/client/social')), '/client/tiktok-account');
  assert.equal(local(await agent.get('/client/youtube')), '/client/youtube-channels');
  assert.equal((await agent.get('/api/auth/me')).body.ui.painelNovo, false);
});

test('admin e as contas da lista veem o painel novo', async () => {
  const admin = await logado({ role: 'admin' });
  assert.equal((await admin.agent.get('/api/auth/me')).body.ui.painelNovo, true);
  const { agent } = await logado();
  assert.equal((await agent.get('/api/auth/me')).body.ui.painelNovo, true);
  // Nao redireciona pro painel antigo (o HTML em si so existe depois do build).
  assert.notEqual((await agent.get('/client/social')).status, 302);
  assert.equal((await agent.get('/api/client/lives')).status, 200);
});

test('instagram: conecta e a conta aparece so pra quem conectou', async () => {
  const { u, agent } = await logado();
  const r = await agent.post('/api/client/social-accounts/instagram/conectar');
  assert.equal(r.status, 200);
  const pedido = chamadas.filter((c) => c.caminho === '/v1/social-networks/instagram/auth-url').at(-1);
  assert.equal(pedido.corpo.tenant_id, `pf_${u.id}`);
  assert.match(pedido.corpo.redirect_uri, /\/client\/social\/retorno\/instagram$/);
  assert.equal(pedido.corpo.force_account_selection, true);

  const id = contaNaOutstand({ tenant: `pf_${u.id}` });
  const volta = await agent.get(`/client/social/retorno/instagram?success=true&account_id=${id}`);
  assert.match(local(volta), /conectada=1/);
  const lista = (await agent.get('/api/client/social-accounts')).body;
  assert.equal(lista.disponivel, true);
  assert.equal(lista.contas.length, 1);
  assert.equal(lista.contas[0].network, 'instagram');

  const outro = await logado();
  assert.equal((await outro.agent.get('/api/client/social-accounts')).body.contas.length, 0);
});

test('volta sem ter iniciado a conexao nao vincula nada', async () => {
  const { u, agent } = await logado();
  const id = contaNaOutstand({ tenant: `pf_${u.id}` });
  const volta = await agent.get(`/client/social/retorno/instagram?success=true&account_id=${id}`);
  assert.match(local(volta), /erro=sessao/);
  assert.equal((await agent.get('/api/client/social-accounts')).body.contas.length, 0);
});

test('conta de outro tenant (URL editada) nao e vinculada', async () => {
  const vitima = await logado();
  const { agent } = await logado();
  await agent.post('/api/client/social-accounts/instagram/conectar');
  const daVitima = contaNaOutstand({ tenant: `pf_${vitima.u.id}` });
  const volta = await agent.get(`/client/social/retorno/instagram?success=true&account_id=${daVitima}`);
  assert.match(local(volta), /erro=conta/);
  assert.equal((await agent.get('/api/client/social-accounts')).body.contas.length, 0);
});

test('conta de uma rede nao entra como outra', async () => {
  const { u, agent } = await logado();
  await agent.post('/api/client/social-accounts/instagram/conectar');
  const doFacebook = contaNaOutstand({ network: 'facebook', tenant: `pf_${u.id}` });
  const volta = await agent.get(`/client/social/retorno/instagram?success=true&account_id=${doFacebook}`);
  assert.match(local(volta), /erro=conta/);
});

test('conta ja vinculada a outro cliente nao e tomada', async () => {
  const dono = await logado();
  await dono.agent.post('/api/client/social-accounts/instagram/conectar');
  const id = contaNaOutstand({ tenant: `pf_${dono.u.id}` });
  await dono.agent.get(`/client/social/retorno/instagram?success=true&account_id=${id}`);

  // Mesma conta reaparece no tenant de outro cliente (a Outstand reaproveitou).
  const intruso = await logado();
  contas.get(id).tenant_id = `pf_${intruso.u.id}`;
  await intruso.agent.post('/api/client/social-accounts/instagram/conectar');
  const volta = await intruso.agent.get(`/client/social/retorno/instagram?success=true&account_id=${id}`);
  assert.match(local(volta), /erro=outro_cliente/);
  assert.equal((await dono.agent.get('/api/client/social-accounts')).body.contas.length, 1);
});

test('facebook: token fica na sessao, cliente escolhe a pagina, e o token nao serve duas vezes', async () => {
  const { agent } = await logado();
  await agent.post('/api/client/social-accounts/facebook/conectar');
  const volta = await agent.get('/client/social/retorno/facebook?session=tok-fb');
  assert.match(local(volta), /escolher=1/);
  assert.ok(!local(volta).includes('tok-fb'), 'o token nao pode ir pra barra de endereco');

  const paginas = await agent.get('/api/client/social-accounts/facebook/paginas');
  assert.equal(paginas.status, 200);
  assert.deepEqual(paginas.body.paginas.map((p) => p.id), ['pg1', 'pg2']);

  assert.equal((await agent.post('/api/client/social-accounts/facebook/paginas', { pageIds: [] })).status, 400);
  const fim = await agent.post('/api/client/social-accounts/facebook/paginas', { pageIds: ['pg1'] });
  assert.equal(fim.status, 200);
  assert.equal(fim.body.conectadas, 1);
  assert.equal(fim.body.contas[0].network, 'facebook');
  assert.equal((await agent.get('/api/client/social-accounts/facebook/paginas')).status, 409);
});

test('facebook: sem ter autorizado, nao da pra listar nem escolher pagina', async () => {
  const { agent } = await logado();
  assert.equal((await agent.get('/api/client/social-accounts/facebook/paginas')).status, 409);
  assert.equal((await agent.post('/api/client/social-accounts/facebook/paginas', { pageIds: ['pg1'] })).status, 409);
});

test('desconectar: so a propria conta, e avisa a Outstand', async () => {
  const dono = await logado();
  await dono.agent.post('/api/client/social-accounts/instagram/conectar');
  const id = contaNaOutstand({ tenant: `pf_${dono.u.id}` });
  await dono.agent.get(`/client/social/retorno/instagram?success=true&account_id=${id}`);
  const nossa = (await dono.agent.get('/api/client/social-accounts')).body.contas[0];

  const outro = await logado();
  assert.equal((await outro.agent.delete(`/api/client/social-accounts/${nossa.id}`)).status, 404);
  assert.ok(!removidas.includes(id));

  const r = await dono.agent.delete(`/api/client/social-accounts/${nossa.id}`);
  assert.equal(r.status, 200);
  assert.equal(r.body.contas.length, 0);
  assert.ok(removidas.includes(id));
});
