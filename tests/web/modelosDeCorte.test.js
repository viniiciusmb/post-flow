// Modelos de estilo de corte (08/10/2026): prontos + salvos pelo cliente,
// aplicados em um ou vários canais.
//
// O que precisa funcionar "perfeitamente" (pedido do fundador):
//   - aplicar copia o estilo para cada alvo escolhido, e só para eles;
//   - o que é do canal (idioma do áudio, descrição, imagem de fundo) nunca
//     viaja junto;
//   - um cliente não lê, aplica nem apaga modelo de outro, nem aplica no canal
//     de outro;
//   - pedido com um alvo inválido não grava nada pela metade.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const pool = require('../../src/db/pool');
const settingsRepository = require('../../src/repositories/settingsRepository');
const painelNovo = require('../../src/lib/painelNovo');
const modelosDeCorte = require('../../src/lib/modelosDeCorte');
const clientVideoSettingsRepository = require('../../src/repositories/clientVideoSettingsRepository');
const { validarEstilo } = require('../../src/web/controllers/api/clientVideoSettingsApiController');
const { startServer, stopServer, createLoginableClient, createAgent } = require('../helpers/http');

let url;
test.before(async () => {
  url = await startServer();
});
test.after(async () => {
  await stopServer();
  await pool.end();
});

async function logado({ noPainelNovo = true } = {}) {
  const u = await createLoginableClient();
  if (noPainelNovo) {
    const atuais = await painelNovo.idsLiberados();
    await settingsRepository.setValue(painelNovo.CHAVE, [...atuais, Number(u.id)]);
  }
  const agent = createAgent(url);
  await agent.login(u.email, u.password);
  return { u, agent };
}

let n = 0;
async function canal(userId) {
  const { rows } = await pool.query(
    `INSERT INTO youtube_channels (client_user_id, youtube_channel_id, channel_url, channel_name)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [userId, `UCmodelo_${process.pid}_${n}`, `https://www.youtube.com/@modelo${n}`, `Canal ${n++}`]
  );
  return Number(rows[0].id);
}

const estiloDe = async (agent, channelId) =>
  (await agent.get(`/api/client/video-settings${channelId ? `?channelId=${channelId}` : ''}`)).body;

test('todo modelo pronto passa na mesma validacao da tela', () => {
  assert.ok(modelosDeCorte.PADROES.length >= 5);
  for (const p of modelosDeCorte.PADROES) {
    const r = validarEstilo(p.campos, clientVideoSettingsRepository.DEFAULTS);
    assert.equal(r.erro, undefined, `modelo pronto "${p.chave}" seria recusado: ${r.erro}`);
    for (const proibido of ['audioLanguage', 'descriptionTemplate', 'descriptionMode', 'backgroundTemplatePath']) {
      assert.ok(!(proibido in p.campos), `modelo pronto "${p.chave}" leva ${proibido}`);
    }
  }
});

test('quem nao esta no painel novo nao usa modelos', async () => {
  const { agent } = await logado({ noPainelNovo: false });
  assert.equal((await agent.get('/api/client/video-settings/modelos')).status, 403);
});

test('salvar o estilo de um canal e aplicar em outros dois', async () => {
  const { u, agent } = await logado();
  const a = await canal(u.id);
  const b = await canal(u.id);
  const c = await canal(u.id);

  await agent.put('/api/client/video-settings', {
    channelId: a,
    cropStyleMode: 'manual',
    captionStyle: 'neon_verde',
    titleStyle: 'cartao',
    maxClips: 7,
    audioLanguage: 'en',
    descriptionMode: 'fixed',
    descriptionTemplate: 'Siga @canalA',
  });
  // B já tem idioma e descrição próprios, que precisam sobreviver ao modelo.
  await agent.put('/api/client/video-settings', { channelId: b, audioLanguage: 'es', descriptionMode: 'fixed', descriptionTemplate: 'Siga @canalB' });

  const salvo = await agent.post('/api/client/video-settings/modelos', { nome: 'Meu neon', channelId: a });
  assert.equal(salvo.status, 201);
  const campos = salvo.body.modelo.campos;
  assert.equal(campos.captionStyle, 'neon_verde');
  assert.equal(campos.maxClips, 7);
  assert.ok(!('audioLanguage' in campos) && !('descriptionTemplate' in campos), 'modelo nao leva idioma nem descricao');

  const r = await agent.post('/api/client/video-settings/modelos/aplicar', {
    modeloId: salvo.body.modelo.id,
    alvos: { channelIds: [b, c] },
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.aplicados, 2);

  const eb = await estiloDe(agent, b);
  assert.equal(eb.captionStyle, 'neon_verde');
  assert.equal(eb.titleStyle, 'cartao');
  assert.equal(eb.maxClips, 7);
  assert.equal(eb.audioLanguage, 'es', 'idioma do canal B nao pode virar o do canal A');
  assert.equal(eb.descriptionTemplate, 'Siga @canalB', 'descricao do canal B nao pode virar a do A');
  assert.equal((await estiloDe(agent, c)).captionStyle, 'neon_verde');

  // O padrão de todos os canais não foi pedido e não pode ter mudado.
  assert.notEqual((await estiloDe(agent, null)).captionStyle, 'neon_verde');
});

test('modelo pronto muda a aparencia e preserva a quantidade de cortes', async () => {
  const { agent } = await logado();
  await agent.put('/api/client/video-settings', { maxClips: 9, clipMode: 'fixed_count' });
  const r = await agent.post('/api/client/video-settings/modelos/aplicar', { padrao: 'viral', alvos: { padraoDoCliente: true } });
  assert.equal(r.status, 200);
  const e = await estiloDe(agent, null);
  assert.equal(e.captionStyle, 'maiusculo_amarelo');
  assert.equal(e.titleStyle, 'destaque_amarelo');
  assert.equal(e.maxClips, 9);
  assert.equal(e.clipMode, 'fixed_count');

  await agent.post('/api/client/video-settings/modelos/aplicar', { padrao: 'serie', alvos: { padraoDoCliente: true } });
  const s = await estiloDe(agent, null);
  assert.equal(s.clipMode, 'full_parts');
  assert.equal(s.showPartLabel, true);
});

test('salvar de novo com o mesmo nome substitui, nao duplica', async () => {
  const { agent } = await logado();
  await agent.put('/api/client/video-settings', { cropStyleMode: 'manual', captionStyle: 'bold' });
  assert.equal((await agent.post('/api/client/video-settings/modelos', { nome: 'Padrão da loja' })).status, 201);
  await agent.put('/api/client/video-settings', { captionStyle: 'minimal' });
  const r = await agent.post('/api/client/video-settings/modelos', { nome: '  padrão da LOJA ' });
  assert.equal(r.status, 200);
  assert.equal(r.body.substituido, true);
  const lista = (await agent.get('/api/client/video-settings/modelos')).body;
  assert.equal(lista.meus.length, 1);
  assert.equal(lista.meus[0].campos.captionStyle, 'minimal');
  assert.ok(lista.padroes.length >= 5);
});

test('nome vazio ou longo demais e recusado', async () => {
  const { agent } = await logado();
  assert.equal((await agent.post('/api/client/video-settings/modelos', { nome: '   ' })).status, 400);
  assert.equal((await agent.post('/api/client/video-settings/modelos', { nome: 'x'.repeat(61) })).status, 400);
});

test('um cliente nao usa, nao apaga e nao aplica no canal do outro', async () => {
  const dono = await logado();
  const canalDoDono = await canal(dono.u.id);
  const m = (await dono.agent.post('/api/client/video-settings/modelos', { nome: 'Secreto' })).body.modelo;

  const intruso = await logado();
  const canalDoIntruso = await canal(intruso.u.id);
  assert.equal((await intruso.agent.post('/api/client/video-settings/modelos/aplicar', { modeloId: m.id, alvos: { padraoDoCliente: true } })).status, 404);
  assert.equal((await intruso.agent.delete(`/api/client/video-settings/modelos/${m.id}`)).status, 404);
  assert.equal((await intruso.agent.get('/api/client/video-settings/modelos')).body.meus.length, 0);
  assert.equal((await intruso.agent.post('/api/client/video-settings/modelos', { nome: 'x', channelId: canalDoDono })).status, 404);

  // Um canal de outro no meio da lista: nada é gravado, nem no próprio canal.
  const antes = (await estiloDe(intruso.agent, canalDoIntruso)).captionStyle;
  const r = await intruso.agent.post('/api/client/video-settings/modelos/aplicar', {
    padrao: 'neon',
    alvos: { channelIds: [canalDoIntruso, canalDoDono] },
  });
  assert.equal(r.status, 404);
  assert.equal((await estiloDe(intruso.agent, canalDoIntruso)).captionStyle, antes);
  const { rows } = await pool.query('SELECT 1 FROM client_video_settings WHERE youtube_channel_id = $1', [canalDoDono]);
  assert.equal(rows.length, 0, 'canal do dono nao pode ganhar estilo pelo pedido do intruso');

  assert.equal((await dono.agent.delete(`/api/client/video-settings/modelos/${m.id}`)).status, 200);
});

test('fundo de imagem vira desfocado onde nao ha imagem enviada', async () => {
  const { u, agent } = await logado();
  const a = await canal(u.id);
  const b = await canal(u.id);
  await agent.put('/api/client/video-settings', { channelId: a, captionStyle: 'bold' });
  await pool.query(
    "UPDATE client_video_settings SET background_style = 'template', background_template_path = '/tmp/x.png' WHERE youtube_channel_id = $1",
    [a]
  );
  const m = (await agent.post('/api/client/video-settings/modelos', { nome: 'Com imagem', channelId: a })).body.modelo;
  assert.equal(m.campos.backgroundStyle, 'template');
  assert.ok(!('backgroundTemplatePath' in m.campos), 'o caminho do arquivo nunca entra no modelo');

  const r = await agent.post('/api/client/video-settings/modelos/aplicar', { modeloId: m.id, alvos: { channelIds: [b] } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.avisos, ['fundo_de_imagem']);
  const eb = await estiloDe(agent, b);
  assert.equal(eb.backgroundStyle, 'blur');
  assert.equal(eb.captionStyle, 'bold');
});
