// O envio de vídeo avulso passou a perguntar as mesmas coisas que o cadastro
// de canal já perguntava: em que idioma cortar, em que conta postar, e de onde
// vem o estilo do corte.
//
// O que motivou: colar um link mandava o vídeo direto para a fila. Testando na
// conta dele, o fundador colou um vídeo francês e ele foi baixado na trilha
// original, sem nunca ter sido perguntado.
//
// Estes testes exercitam a pilha inteira por HTTP, porque o risco não está na
// conta de idioma - está no que é GRAVADO. A configuração do cliente, a
// exceção de canal e agora a do vídeo moram na MESMA tabela, e gravar no alvo
// errado apagaria em silêncio o estilo que o cliente já tinha.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const pool = require('../../src/db/pool');
const clientVideoSettingsRepository = require('../../src/repositories/clientVideoSettingsRepository');
const sourceVideosRepository = require('../../src/repositories/sourceVideosRepository');
const idiomaDoAudio = require('../../src/lib/idiomaDoAudio');
const { createYoutubeChannel, createSourceVideo } = require('../helpers/db');
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

function config(extra = {}) {
  return {
    captionStyle: 'classic',
    clipLength: 'balanced',
    clipMode: 'ai_choice',
    maxClips: 4,
    showTitle: true,
    titleSeconds: 3,
    descriptionMode: 'auto',
    cropStyleMode: 'auto',
    cropZoomPercent: 100,
    showPartLabel: false,
    partLabelPosition: 'top_right',
    titleStyle: 'classic',
    audioLanguage: 'original',
    ...extra,
  };
}

test('o editor de estilo aberto num video avulso grava SO naquele video', async () => {
  const { user, agent } = await clienteLogado();
  const video = await createSourceVideo(user.id);
  // O cliente já tem o estilo dele configurado para todos os canais.
  await clientVideoSettingsRepository.upsert(user.id, config({ maxClips: 9, clipLength: 'long' }));

  const salvo = await agent.put('/api/client/video-settings', {
    ...config({ maxClips: 2, clipLength: 'short' }),
    sourceVideoId: Number(video.id),
  });
  assert.equal(salvo.status, 200, salvo.text);

  const doVideo = await clientVideoSettingsRepository.findVideoOverride(user.id, video.id);
  assert.equal(doVideo.max_clips, 2);

  const padrao = await clientVideoSettingsRepository.findByClientId(user.id);
  assert.equal(padrao.max_clips, 9, 'o padrao do cliente nao pode ser tocado');
  assert.equal(padrao.clip_length, 'long');
});

test('o GET do estilo de um video sem configuracao propria devolve o padrao, marcado', async () => {
  const { user, agent } = await clienteLogado();
  const video = await createSourceVideo(user.id);
  await clientVideoSettingsRepository.upsert(user.id, config({ maxClips: 7 }));

  const r = await agent.get(`/api/client/video-settings?sourceVideoId=${video.id}`);

  assert.equal(r.status, 200);
  assert.equal(r.body.maxClips, 7, 'mostra o padrao como ponto de partida');
  assert.equal(r.body.usesDefault, true, 'marcado como "ainda nao e deste video"');
  assert.equal(r.body.sourceVideoId, Number(video.id));
});

test('um cliente nao configura o estilo do video de outro (mesmo sabendo o id)', async () => {
  const { user } = await clienteLogado();
  const video = await createSourceVideo(user.id);
  const intruso = await clienteLogado();

  const r = await intruso.agent.put('/api/client/video-settings', {
    ...config({ maxClips: 1 }),
    sourceVideoId: Number(video.id),
  });

  assert.equal(r.status, 400);
  assert.equal(
    await clientVideoSettingsRepository.findVideoOverride(user.id, video.id),
    null,
    'nada foi gravado no video da vitima'
  );
});

test('o GET do estilo de video de outro cliente tambem e recusado', async () => {
  const { user } = await clienteLogado();
  const video = await createSourceVideo(user.id);
  const intruso = await clienteLogado();

  const r = await intruso.agent.get(`/api/client/video-settings?sourceVideoId=${video.id}`);
  assert.equal(r.status, 400);
});

test('configurar o estilo de um canal continua funcionando (nao quebrou nada)', async () => {
  const { user, agent } = await clienteLogado();
  const canal = await createYoutubeChannel(user.id);
  await clientVideoSettingsRepository.upsert(user.id, config({ maxClips: 9 }));

  const r = await agent.put('/api/client/video-settings', {
    ...config({ maxClips: 3 }),
    channelId: Number(canal.id),
  });

  assert.equal(r.status, 200);
  assert.equal((await clientVideoSettingsRepository.findChannelOverride(user.id, canal.id)).max_clips, 3);
  assert.equal((await clientVideoSettingsRepository.findByClientId(user.id)).max_clips, 9);
});

test('salvar o padrao do cliente continua funcionando com videos ja configurados', async () => {
  // O índice único do padrão passou a ter mais uma condição. Se o ON CONFLICT
  // não repetisse o predicado novo, salvar a configuração padrão passaria a
  // falhar com "no unique or exclusion constraint matching" - e só depois de
  // existir um vídeo com estilo próprio, que é o que torna isso traiçoeiro.
  const { user, agent } = await clienteLogado();
  const video = await createSourceVideo(user.id);
  await clientVideoSettingsRepository.upsert(user.id, config({ maxClips: 5 }), { sourceVideoId: video.id });

  const r = await agent.put('/api/client/video-settings', config({ maxClips: 6 }));

  assert.equal(r.status, 200, r.text);
  assert.equal((await clientVideoSettingsRepository.findByClientId(user.id)).max_clips, 6);
  assert.equal((await clientVideoSettingsRepository.findVideoOverride(user.id, video.id)).max_clips, 5);
});

test('link invalido e recusado na previa, antes de qualquer consulta ao YouTube', async () => {
  const { agent } = await clienteLogado();
  const r = await agent.post('/api/client/source-videos/manual/preview', { url: 'nao-e-um-link' });
  assert.equal(r.status, 400);
});

test('o idioma escolhido no envio vence a configuracao do cliente', async () => {
  // A escolha do envio é a mais recente e a mais explícita que existe: alguém
  // colou aquele link e disse em que idioma queria ESTE vídeo.
  const { user } = await clienteLogado();
  await clientVideoSettingsRepository.upsert(user.id, config({ audioLanguage: 'es' }));

  const video = await sourceVideosRepository.createManual({
    clientUserId: user.id,
    youtubeVideoId: `vid_esc_${process.pid}_${Date.now()}`,
    title: 'Video dublado',
    thumbnailUrl: null,
    publishedAt: new Date(),
    durationSeconds: 300,
    chosenAudioLanguage: 'pt',
  });

  const settings = await clientVideoSettingsRepository.resolveForVideo(user.id, null, video.id);
  // Chama a MESMA função que o pipeline usa (processVideoJob). Repetir a
  // conta aqui faria o teste provar a si mesmo: a versão anterior deste teste
  // continuava passando com a decisão removida do produto.
  assert.equal(idiomaDoAudio.idiomaParaOVideo(video, settings), 'pt');
});

test('sem escolha no envio, vale a configuracao', async () => {
  const settings = { audio_language: 'es' };
  assert.equal(idiomaDoAudio.idiomaParaOVideo({ chosen_audio_language: null }, settings), 'es');
});

test('"original" escolhido no envio vence uma configuracao em outro idioma', async () => {
  // É o caso que separa "não escolheu" de "escolheu original": quem viu o
  // seletor e ficou com a trilha do canal não pode receber o corte no idioma
  // que ele configurou meses atrás para outros vídeos.
  const settings = { audio_language: 'pt' };
  assert.equal(idiomaDoAudio.idiomaParaOVideo({ chosen_audio_language: 'original' }, settings), 'original');
});

test('trocar o idioma DENTRO do editor de um video muda o que o corte vai usar', async () => {
  // Havia duas fontes para o mesmo dado: a escolha do envio e a configuração.
  // A do envio vence, então editar a configuração deixaria a tela mostrando um
  // idioma e o corte saindo em outro. Visto na verificação visual: o cliente
  // escolhia português no pop-up e o editor abria dizendo "original".
  const { user, agent } = await clienteLogado();
  const video = await sourceVideosRepository.createManual({
    clientUserId: user.id,
    youtubeVideoId: `vid_ed_${process.pid}_${Date.now()}`,
    title: 'Dublado',
    thumbnailUrl: null,
    publishedAt: new Date(),
    durationSeconds: 300,
    chosenAudioLanguage: 'pt',
  });

  // A tela mostra o que VALE, não a configuração crua.
  const aberto = await agent.get(`/api/client/video-settings?sourceVideoId=${video.id}`);
  assert.equal(aberto.body.audioLanguage, 'pt');

  // E trocar ali muda o que o pipeline vai usar de verdade.
  const salvo = await agent.put('/api/client/video-settings', {
    ...config({ audioLanguage: 'es' }),
    sourceVideoId: Number(video.id),
  });
  assert.equal(salvo.status, 200, salvo.text);

  const depois = await sourceVideosRepository.findById(video.id);
  const settings = await clientVideoSettingsRepository.resolveForVideo(user.id, null, video.id);
  assert.equal(
    idiomaDoAudio.idiomaParaOVideo(depois, settings),
    'es',
    'o idioma que o pipeline usa tem que ser o que a tela acabou de salvar'
  );
});
