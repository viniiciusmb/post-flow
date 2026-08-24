// O checklist da tela inicial e o progresso do Tutorial saem daqui.
//
// Dois cuidados que este endpoint precisa ter, e que os testes travam:
// o passo só conta como feito quando é do PRÓPRIO cliente (senão o cliente A
// veria o checklist sumir porque o cliente B conectou uma conta), e
// "concluído" só é verdade com os três feitos — é ele que faz o checklist
// desaparecer da tela.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const pool = require('../../src/db/pool');
const { startServer, stopServer, createLoginableClient, createAgent } = require('../helpers/http');

let baseUrl;

test.before(async () => {
  baseUrl = await startServer();
});

test.after(async () => {
  await stopServer();
  await pool.end();
});

let seq = 0;
const unico = () => `${Date.now()}${seq++}`;

async function clienteLogado() {
  const cliente = await createLoginableClient({ role: 'client' });
  const agente = createAgent(baseUrl);
  await agente.login(cliente.email, cliente.password);
  return { cliente, agente };
}

async function conectarTiktok(clienteId) {
  await pool.query(
    `INSERT INTO tiktok_accounts (client_user_id, tiktok_open_id, display_name, is_active,
       access_token_encrypted, access_token_iv, refresh_token_encrypted, refresh_token_iv,
       scopes, token_expires_at, connected_at)
     VALUES ($1,$2,'conta',true,'x','x','x','x',ARRAY['video.publish'], now()+interval '30 days', now())`,
    [clienteId, `open-${unico()}`]
  );
}

async function adicionarCanal(clienteId) {
  await pool.query(
    `INSERT INTO youtube_channels (client_user_id, youtube_channel_id, channel_url, channel_name)
     VALUES ($1,$2,'https://youtube.com/@x','Canal')`,
    [clienteId, `UC_${unico()}`]
  );
}

async function salvarEstilo(clienteId) {
  await pool.query('INSERT INTO client_video_settings (client_user_id) VALUES ($1)', [clienteId]);
}

test('cliente novo começa com os três passos por fazer', async () => {
  const { agente } = await clienteLogado();
  const { status, body } = await agente.get('/api/client/onboarding');

  assert.equal(status, 200);
  assert.equal(body.tiktokConectado, false);
  assert.equal(body.estiloConfigurado, false);
  assert.equal(body.canalMonitorado, false);
  assert.equal(body.concluido, false, 'checklist sumiria da tela de quem ainda não fez nada');
});

test('cada passo vira "feito" quando a coisa dele existe', async () => {
  const { cliente, agente } = await clienteLogado();

  await conectarTiktok(cliente.id);
  let r = await agente.get('/api/client/onboarding');
  assert.equal(r.body.tiktokConectado, true);
  assert.equal(r.body.concluido, false, 'um passo não pode dar o checklist por terminado');

  await salvarEstilo(cliente.id);
  r = await agente.get('/api/client/onboarding');
  assert.equal(r.body.estiloConfigurado, true);
  assert.equal(r.body.concluido, false);

  await adicionarCanal(cliente.id);
  r = await agente.get('/api/client/onboarding');
  assert.equal(r.body.canalMonitorado, true);
  assert.equal(r.body.concluido, true, 'com os três feitos, o checklist tem que sumir');
});

test('o passo de outro cliente não conta pro meu', async () => {
  // Sem isto, o checklist sumiria da tela de quem ainda não configurou nada
  // só porque OUTRA pessoa conectou uma conta.
  const { cliente: outro } = await clienteLogado();
  await conectarTiktok(outro.id);
  await adicionarCanal(outro.id);
  await salvarEstilo(outro.id);

  const { agente } = await clienteLogado();
  const { body } = await agente.get('/api/client/onboarding');
  assert.equal(body.tiktokConectado, false);
  assert.equal(body.canalMonitorado, false);
  assert.equal(body.estiloConfigurado, false);
  assert.equal(body.concluido, false);
});

test('conta do TikTok desconectada deixa de contar', async () => {
  // Quem desconectou a conta voltou a ter esse passo por fazer - e precisa
  // ver o checklist de novo, não um passo marcado que não existe mais.
  const { cliente, agente } = await clienteLogado();
  await conectarTiktok(cliente.id);
  assert.equal((await agente.get('/api/client/onboarding')).body.tiktokConectado, true);

  await pool.query('UPDATE tiktok_accounts SET is_active = false WHERE client_user_id = $1', [cliente.id]);
  assert.equal((await agente.get('/api/client/onboarding')).body.tiktokConectado, false);
});

test('sem sessão, o endereço não responde', async () => {
  const semLogin = createAgent(baseUrl);
  const { status } = await semLogin.get('/api/client/onboarding');
  assert.equal(status, 401);
});

test('a página do Tutorial abre pra quem está logado', async () => {
  const { agente } = await clienteLogado();
  const { status, text } = await agente.get('/client/tutorial');
  assert.equal(status, 200);
  assert.match(text, /<div id="root">/, 'a página não veio montada');
});

// A prévia do checklist (?guia=1 e ?guia=novo) é decidida no navegador, a
// partir da barra de endereço - o servidor não participa. O que precisa ficar
// travado aqui é que ela NÃO alterou o que o endpoint responde: se a prévia
// tivesse virado um parâmetro de API, um cliente conseguiria pedir o estado de
// "recém-criado" e o checklist voltaria pra tela de quem já terminou.
test('a prévia não muda a resposta do servidor', async () => {
  const { cliente, agente } = await clienteLogado();
  await conectarTiktok(cliente.id);
  await salvarEstilo(cliente.id);
  await adicionarCanal(cliente.id);

  const normal = await agente.get('/api/client/onboarding');
  assert.equal(normal.body.concluido, true);

  for (const query of ['?guia=1', '?guia=novo', '?guia=qualquer']) {
    const r = await agente.get(`/api/client/onboarding${query}`);
    assert.equal(r.body.concluido, true, `${query} mudou o que o servidor respondeu`);
    assert.equal(r.body.tiktokConectado, true, `${query} zerou um passo já feito`);
  }
});
