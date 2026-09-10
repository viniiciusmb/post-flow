// Cortar o vídeo mais recente de um canal A QUALQUER MOMENTO.
//
// O pop-up "quer processar o vídeo mais recente?" só existia no instante do
// cadastro. Quem recusava perdia a opção para sempre — e recusar é o caminho
// natural: o cliente conecta o canal, vai configurar o estilo do corte, e só
// então quer aquele vídeo. A essa altura ele não era mais oferecido em lugar
// nenhum, e o canal só pegaria o PRÓXIMO vídeo publicado.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const pool = require('../../src/db/pool');
const sourceVideosRepository = require('../../src/repositories/sourceVideosRepository');
const youtubeChannelsRepository = require('../../src/repositories/youtubeChannelsRepository');
const ytDlpService = require('../../src/services/ytDlpService');
const queueService = require('../../src/services/queueService');
const { createYoutubeChannel } = require('../helpers/db');
const { startServer, stopServer, createLoginableClient, createAgent } = require('../helpers/http');

let url;
const listarOriginal = ytDlpService.listChannelVideos;

test.before(async () => {
  url = await startServer();
});

test.after(async () => {
  ytDlpService.listChannelVideos = listarOriginal;
  await stopServer();
  // Mandar cortar enfileira de verdade, e o pg-boss abre conexões e um
  // agendador próprios. Sem encerrá-lo o processo do teste fica vivo depois de
  // todos passarem, e o runner acaba marcando o ARQUIVO como falho por tempo -
  // com todos os testes verdes na lista, que é um jeito confuso de falhar.
  await queueService.stopBoss();
  await pool.end();
});

// O yt-dlp de verdade sairia para o YouTube. O que estes testes precisam
// provar é o que o sistema FAZ com a resposta, não que o yt-dlp funciona.
function fingirVideoDoCanal(video) {
  ytDlpService.listChannelVideos = async () => (video ? [video] : []);
}

function videoNormal(extra = {}) {
  return {
    videoId: `vid_${process.pid}_${Math.random().toString(36).slice(2, 10)}`,
    title: 'Vídeo mais recente do canal',
    thumbnailUrl: null,
    durationSeconds: 600,
    publishedAt: new Date(),
    liveStatus: 'not_live',
    availability: 'public',
    ...extra,
  };
}

async function clienteComCanal() {
  const user = await createLoginableClient();
  const agent = createAgent(url);
  await agent.login(user.email, user.password);
  const canal = await createYoutubeChannel(user.id);
  return { user, agent, canal };
}

test('o canal mostra qual e o video mais recente sem cadastrar nada', async () => {
  const { user, agent, canal } = await clienteComCanal();
  const video = videoNormal();
  fingirVideoDoCanal(video);

  const r = await agent.get(`/api/client/youtube-channels/${canal.id}/latest-video`);

  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.video.videoId, video.videoId);
  assert.equal(r.body.video.disponivel, true);
  assert.equal(r.body.video.jaNoSistema, null);

  const { rows } = await pool.query(
    'SELECT count(*)::int AS n FROM source_videos WHERE owner_client_user_id = $1',
    [user.id]
  );
  assert.equal(rows[0].n, 0, 'consultar nao pode cadastrar - so o "sim" do cliente cadastra');
});

test('mandar cortar depois do cadastro entra na fila normalmente', async () => {
  const { user, agent, canal } = await clienteComCanal();
  const video = videoNormal();
  fingirVideoDoCanal(video);

  const r = await agent.post(`/api/client/youtube-channels/${canal.id}/process-latest-video`, {});

  assert.equal(r.status, 201, r.text);
  const criado = await sourceVideosRepository.findByYoutubeVideoIdForOwner(video.videoId, user.id);
  assert.ok(criado, 'o video foi cadastrado');
  assert.equal(Number(criado.youtube_channel_id), Number(canal.id), 'vinculado ao canal, nao avulso');
});

test('video que ja estava PARADO na lista e enfileirado, nao recusado', async () => {
  // É o caso mais comum agora: a checagem periódica pode ter cadastrado o
  // vídeo e o freio de engarrafamento tê-lo deixado parado. Antes isto era
  // sempre 409 "você já processou esse vídeo", o que é falso - ele estava ali
  // esperando alguém mandar.
  const { user, agent, canal } = await clienteComCanal();
  const video = videoNormal();
  fingirVideoDoCanal(video);

  const jaExistia = await sourceVideosRepository.createIfNotExists({
    youtubeChannelId: canal.id,
    ownerClientUserId: user.id,
    youtubeVideoId: video.videoId,
    title: video.title,
    thumbnailUrl: null,
    publishedAt: video.publishedAt,
    durationSeconds: video.durationSeconds,
  });
  assert.equal(jaExistia.status, 'detected');

  const r = await agent.post(`/api/client/youtube-channels/${canal.id}/process-latest-video`, {});

  assert.equal(r.status, 201, r.text);
  assert.equal(Number(r.body.id), Number(jaExistia.id), 'usa o video que ja existia, nao cria outro');

  const { rows } = await pool.query(
    'SELECT count(*)::int AS n FROM source_videos WHERE youtube_video_id = $1 AND owner_client_user_id = $2',
    [video.videoId, user.id]
  );
  assert.equal(rows[0].n, 1, 'nunca duplica o video');
});

test('video pausado volta a andar quando o cliente manda cortar', async () => {
  const { user, agent, canal } = await clienteComCanal();
  const video = videoNormal();
  fingirVideoDoCanal(video);
  const criado = await sourceVideosRepository.createIfNotExists({
    youtubeChannelId: canal.id,
    ownerClientUserId: user.id,
    youtubeVideoId: video.videoId,
    title: video.title,
    thumbnailUrl: null,
    publishedAt: video.publishedAt,
    durationSeconds: video.durationSeconds,
  });
  await pool.query("UPDATE source_videos SET status = 'paused', cancel_requested = true WHERE id = $1", [criado.id]);

  const r = await agent.post(`/api/client/youtube-channels/${canal.id}/process-latest-video`, {});

  assert.equal(r.status, 201, r.text);
  const depois = await sourceVideosRepository.findById(criado.id);
  assert.equal(
    depois.cancel_requested,
    false,
    'sem limpar a marca de pausa, o worker pararia de novo no primeiro checkpoint'
  );
});

test('video JA PRONTO nao e reprocessado - responde explicando', async () => {
  const { user, agent, canal } = await clienteComCanal();
  const video = videoNormal();
  fingirVideoDoCanal(video);
  const criado = await sourceVideosRepository.createIfNotExists({
    youtubeChannelId: canal.id,
    ownerClientUserId: user.id,
    youtubeVideoId: video.videoId,
    title: video.title,
    thumbnailUrl: null,
    publishedAt: video.publishedAt,
    durationSeconds: video.durationSeconds,
  });
  await pool.query("UPDATE source_videos SET status = 'ready' WHERE id = $1", [criado.id]);

  const r = await agent.post(`/api/client/youtube-channels/${canal.id}/process-latest-video`, {});

  assert.equal(r.status, 409);
  assert.ok(r.body.error.includes('ready'), 'a mensagem diz em que situacao ele esta');
});

test('a consulta avisa quando o video ja esta no sistema', async () => {
  const { user, agent, canal } = await clienteComCanal();
  const video = videoNormal();
  fingirVideoDoCanal(video);
  const criado = await sourceVideosRepository.createIfNotExists({
    youtubeChannelId: canal.id,
    ownerClientUserId: user.id,
    youtubeVideoId: video.videoId,
    title: video.title,
    thumbnailUrl: null,
    publishedAt: video.publishedAt,
    durationSeconds: video.durationSeconds,
  });

  const r = await agent.get(`/api/client/youtube-channels/${canal.id}/latest-video`);

  assert.equal(Number(r.body.video.jaNoSistema.id), Number(criado.id));
  assert.equal(r.body.video.jaNoSistema.status, 'detected');
});

test('estreia e video de membros vem marcados como indisponiveis', async () => {
  // A tela usa isso pra explicar em vez de deixar clicar e o vídeo virar erro
  // minutos depois. O vídeo não tem defeito nenhum nos dois casos.
  const { agent, canal } = await clienteComCanal();

  fingirVideoDoCanal(videoNormal({ liveStatus: 'is_upcoming' }));
  const estreia = await agent.get(`/api/client/youtube-channels/${canal.id}/latest-video`);
  assert.equal(estreia.body.video.disponivel, false);

  fingirVideoDoCanal(videoNormal({ availability: 'subscriber_only' }));
  const membros = await agent.get(`/api/client/youtube-channels/${canal.id}/latest-video`);
  assert.equal(membros.body.video.disponivel, false);
});

test('canal de OUTRO cliente nunca e consultado nem processado', async () => {
  const { canal } = await clienteComCanal();
  const intruso = await createLoginableClient();
  const agenteIntruso = createAgent(url);
  await agenteIntruso.login(intruso.email, intruso.password);
  fingirVideoDoCanal(videoNormal());

  assert.equal((await agenteIntruso.get(`/api/client/youtube-channels/${canal.id}/latest-video`)).status, 404);
  assert.equal(
    (await agenteIntruso.post(`/api/client/youtube-channels/${canal.id}/process-latest-video`, {})).status,
    404
  );
});

test('canal sem nenhum video responde sem quebrar', async () => {
  const { agent, canal } = await clienteComCanal();
  fingirVideoDoCanal(null);

  assert.equal((await agent.get(`/api/client/youtube-channels/${canal.id}/latest-video`)).status, 404);
});

test('o marco d agua NAO e movido por mandar cortar o ultimo video', async () => {
  // O marco é do job de checagem. Movê-lo aqui faria o sistema pular tudo que
  // foi publicado entre ele e este vídeo - é a família de defeitos que já
  // custou vídeos perdidos quatro vezes neste projeto.
  const { user, agent, canal } = await clienteComCanal();
  await youtubeChannelsRepository.updatePollState(canal.id, { lastVideoId: 'MARCO_ANTIGO' });
  fingirVideoDoCanal(videoNormal());

  await agent.post(`/api/client/youtube-channels/${canal.id}/process-latest-video`, {});

  const depois = await youtubeChannelsRepository.findById(canal.id);
  assert.equal(depois.last_video_id, 'MARCO_ANTIGO');
  assert.equal(Number(depois.client_user_id), Number(user.id));
});
