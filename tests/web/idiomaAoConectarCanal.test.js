// Escolher o idioma do canal no pop-up de cadastro (01/09/2026).
//
// O pop-up que já pergunta "quer processar o vídeo mais recente?" passa a
// mostrar os idiomas que AQUELE vídeo tem, com o idioma do painel marcado.
//
// O risco a travar aqui não é o seletor — é o que ele GRAVA. A configuração de
// corte do cliente e a exceção de canal moram na MESMA tabela, e gravar a linha
// inteira a partir de uma tela que nunca carregou o estilo do cliente apagaria
// em silêncio tudo que ele já tinha escolhido. Já aconteceu neste projeto, com
// dois cartões salvando a mesma linha.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const pool = require('../../src/db/pool');
const clientVideoSettingsRepository = require('../../src/repositories/clientVideoSettingsRepository');
const { createYoutubeChannel } = require('../helpers/db');
const { startServer, stopServer, createLoginableClient, createAgent } = require('../helpers/http');

let url;

test.before(async () => {
  url = await startServer();
});

test.after(async () => {
  await stopServer();
  await pool.end();
});

async function clienteLogado() {
  const user = await createLoginableClient();
  const agent = createAgent(url);
  await agent.login(user.email, user.password);
  return { user, agent };
}

test('escolher o idioma cria a exceção do canal sem apagar o estilo do cliente', async () => {
  const { user, agent } = await clienteLogado();
  const canal = await createYoutubeChannel(user.id);

  // O cliente já configurou o estilo dele para TODOS os canais.
  await clientVideoSettingsRepository.upsert(user.id, {
    clipLength: 'long', clipMode: 'fixed_count', maxClips: 9,
    showTitle: true, titleSeconds: 5, descriptionMode: 'auto',
    cropStyleMode: 'manual', cropZoomPercent: 70, showPartLabel: true,
    partLabelPosition: 'bottom_left', titleStyle: 'bubble_purple',
    captionStyle: 'neon_verde', captionFont: 'Poppins', partLabelSizePercent: 150,
  });

  const r = await agent.put(`/api/client/youtube-channels/${canal.id}/audio-language`, { audioLanguage: 'pt' });
  assert.equal(r.status, 200);
  assert.equal(r.body.audioLanguage, 'pt');

  const doCanal = await clientVideoSettingsRepository.findChannelOverride(user.id, canal.id);
  assert.equal(doCanal.audio_language, 'pt');
  // Tudo que o cliente tinha escolhido continua valendo neste canal.
  assert.equal(doCanal.caption_style, 'neon_verde', 'o estilo de legenda do cliente foi apagado');
  assert.equal(doCanal.title_style, 'bubble_purple', 'o estilo de título foi apagado');
  assert.equal(doCanal.max_clips, 9, 'a quantidade de cortes foi apagada');
  assert.equal(doCanal.crop_zoom_percent, 70, 'o enquadramento foi apagado');
  assert.equal(doCanal.part_label_size_percent, 150, 'o tamanho da numeração foi apagado');
  assert.equal(doCanal.caption_font, 'Poppins', 'a fonte foi apagada');

  // E o padrão "de todos os canais" não foi tocado.
  const padrao = await clientVideoSettingsRepository.findByClientId(user.id);
  assert.equal(padrao.audio_language, 'original', 'escolher o idioma de UM canal mexeu no padrão de todos');
});

test('trocar o idioma de novo não desfaz o resto', async () => {
  const { user, agent } = await clienteLogado();
  const canal = await createYoutubeChannel(user.id);

  await agent.put(`/api/client/youtube-channels/${canal.id}/audio-language`, { audioLanguage: 'pt' });
  // Depois o cliente ajusta o estilo desse canal.
  await pool.query(
    "UPDATE client_video_settings SET caption_style = 'amarelo_caixa' WHERE client_user_id = $1 AND youtube_channel_id = $2",
    [user.id, canal.id]
  );
  await agent.put(`/api/client/youtube-channels/${canal.id}/audio-language`, { audioLanguage: 'es' });

  const doCanal = await clientVideoSettingsRepository.findChannelOverride(user.id, canal.id);
  assert.equal(doCanal.audio_language, 'es');
  assert.equal(doCanal.caption_style, 'amarelo_caixa', 'trocar o idioma reverteu o estilo do canal');
});

test('canal de outro cliente não pode ter o idioma trocado', async () => {
  const dono = await createLoginableClient();
  const canal = await createYoutubeChannel(dono.id);
  const { agent } = await clienteLogado();

  const r = await agent.put(`/api/client/youtube-channels/${canal.id}/audio-language`, { audioLanguage: 'pt' });
  assert.equal(r.status, 404, 'deu para mexer no canal de outra pessoa');

  const doCanal = await clientVideoSettingsRepository.findChannelOverride(dono.id, canal.id);
  assert.ok(!doCanal, 'criou configuração no canal alheio');
});

test('idioma inválido é recusado', async () => {
  const { user, agent } = await clienteLogado();
  const canal = await createYoutubeChannel(user.id);

  // "nao-e-idioma-nenhum" é o caso traiçoeiro: normalizar primeiro cortaria no
  // hífen e deixaria "nao", um código de 3 letras que passaria por válido.
  for (const lixo of ['nao-e-idioma-nenhum', '', '../../etc', 'portugues', 123]) {
    const r = await agent.put(`/api/client/youtube-channels/${canal.id}/audio-language`, { audioLanguage: lixo });
    assert.equal(r.status, 400, `aceitou "${lixo}" como idioma`);
  }
  assert.ok(!(await clientVideoSettingsRepository.findChannelOverride(user.id, canal.id)), 'gravou lixo no canal');
});

test('idioma fora da nossa lista de nomes ainda é aceito', async () => {
  // O seletor oferece o que o VÍDEO tem, não o que previmos. Recusar 'sv'
  // porque ele não está no nosso menu barraria uma escolha que a própria tela
  // acabou de oferecer.
  const { user, agent } = await clienteLogado();
  const canal = await createYoutubeChannel(user.id);

  const r = await agent.put(`/api/client/youtube-channels/${canal.id}/audio-language`, { audioLanguage: 'sv' });
  assert.equal(r.status, 200);
  assert.equal(r.body.audioLanguage, 'sv');
});

test('sem sessão, ninguém troca idioma de canal nenhum', async () => {
  const dono = await createLoginableClient();
  const canal = await createYoutubeChannel(dono.id);
  const anonimo = createAgent(url);
  await anonimo.get('/');

  const r = await anonimo.put(`/api/client/youtube-channels/${canal.id}/audio-language`, { audioLanguage: 'pt' });
  assert.equal(r.status, 401);
});
