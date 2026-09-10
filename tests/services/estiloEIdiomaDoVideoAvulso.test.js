// Vídeo avulso (link colado ou arquivo enviado) passou a poder ter idioma e
// estilo próprios, escolhidos na hora do envio.
//
// O que motivou: colar o link mandava o vídeo direto para a fila, baixado na
// trilha ORIGINAL e cortado com a configuração padrão do cliente. Quem colava
// um vídeo gringo dublado recebia os cortes em outra língua sem nunca ter sido
// perguntado - foi exatamente o que o fundador viu testando um vídeo francês.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const clientVideoSettingsRepository = require('../../src/repositories/clientVideoSettingsRepository');
const sourceVideosRepository = require('../../src/repositories/sourceVideosRepository');
const pool = require('../../src/db/pool');
const { createClient, createSourceVideo, createYoutubeChannel, closePool } = require('../helpers/db');

test.after(() => closePool());

// A configuração completa que o upsert exige, com um valor que dá para
// reconhecer depois.
function config(extra = {}) {
  return {
    captionStyle: 'classic',
    clipLength: 'balanced',
    clipMode: 'ai_choice',
    maxClips: 4,
    showTitle: true,
    titleSeconds: 3,
    descriptionMode: 'auto',
    descriptionTemplate: null,
    cropStyleMode: 'auto',
    cropZoomPercent: 100,
    showPartLabel: false,
    partLabelPosition: 'top_right',
    titleStyle: 'classic',
    audioLanguage: 'original',
    ...extra,
  };
}

test('a linha padrao do cliente e a de um video avulso convivem sem colidir', async () => {
  // O índice único do padrão era (client_user_id) WHERE youtube_channel_id IS
  // NULL - e a linha de um vídeo também tem canal nulo. Sem ajustar o
  // predicado, o PRIMEIRO vídeo com estilo próprio faria o INSERT falhar
  // dizendo que já existe uma configuração padrão.
  const cliente = await createClient();
  const video = await createSourceVideo(cliente.id);

  await clientVideoSettingsRepository.upsert(cliente.id, config({ maxClips: 4 }));
  await clientVideoSettingsRepository.upsert(cliente.id, config({ maxClips: 9 }), {
    sourceVideoId: video.id,
  });

  const padrao = await clientVideoSettingsRepository.findByClientId(cliente.id);
  const doVideo = await clientVideoSettingsRepository.findVideoOverride(cliente.id, video.id);
  assert.equal(padrao.max_clips, 4, 'o padrao do cliente continua o dele');
  assert.equal(doVideo.max_clips, 9);
});

test('salvar o estilo do video duas vezes atualiza a mesma linha (nao cria outra)', async () => {
  const cliente = await createClient();
  const video = await createSourceVideo(cliente.id);

  await clientVideoSettingsRepository.upsert(cliente.id, config({ maxClips: 5 }), { sourceVideoId: video.id });
  await clientVideoSettingsRepository.upsert(cliente.id, config({ maxClips: 7 }), { sourceVideoId: video.id });

  const { rows } = await pool.query(
    'SELECT count(*)::int AS n FROM client_video_settings WHERE source_video_id = $1',
    [video.id]
  );
  assert.equal(rows[0].n, 1);
  assert.equal((await clientVideoSettingsRepository.findVideoOverride(cliente.id, video.id)).max_clips, 7);
});

test('o pipeline usa o estilo do VIDEO antes do canal e do padrao', async () => {
  const cliente = await createClient();
  const canal = await createYoutubeChannel(cliente.id);
  const video = await createSourceVideo(cliente.id);

  await clientVideoSettingsRepository.upsert(cliente.id, config({ maxClips: 1 }));
  await clientVideoSettingsRepository.upsert(cliente.id, config({ maxClips: 2 }), {
    youtubeChannelId: canal.id,
  });
  await clientVideoSettingsRepository.upsert(cliente.id, config({ maxClips: 3 }), {
    sourceVideoId: video.id,
  });

  const doVideo = await clientVideoSettingsRepository.resolveForVideo(cliente.id, canal.id, video.id);
  assert.equal(doVideo.max_clips, 3, 'o video manda: e a escolha mais recente e mais explicita');

  const semVideo = await clientVideoSettingsRepository.resolveForVideo(cliente.id, canal.id, null);
  assert.equal(semVideo.max_clips, 2, 'sem estilo de video, vale o do canal');

  const soPadrao = await clientVideoSettingsRepository.resolveForVideo(cliente.id, null, null);
  assert.equal(soPadrao.max_clips, 1);
});

test('video SEM estilo proprio continua seguindo o padrao do cliente, inclusive quando ele muda', async () => {
  // 'client' não grava linha nenhuma de propósito: gravar uma cópia
  // congelaria o estilo daquele vídeo sem ninguém ter pedido.
  const cliente = await createClient();
  const video = await createSourceVideo(cliente.id);
  await clientVideoSettingsRepository.upsert(cliente.id, config({ maxClips: 4 }));

  assert.equal((await clientVideoSettingsRepository.resolveForVideo(cliente.id, null, video.id)).max_clips, 4);

  await clientVideoSettingsRepository.upsert(cliente.id, config({ maxClips: 6 }));
  assert.equal(
    (await clientVideoSettingsRepository.resolveForVideo(cliente.id, null, video.id)).max_clips,
    6,
    'sem linha propria, o video acompanha o padrao'
  );
});

test('copiar o estilo de um canal CONGELA os valores - mudar o canal depois nao mexe no video', async () => {
  const cliente = await createClient();
  const canal = await createYoutubeChannel(cliente.id);
  const video = await createSourceVideo(cliente.id);
  await clientVideoSettingsRepository.upsert(cliente.id, config({ maxClips: 2, captionStyle: 'bold' }), {
    youtubeChannelId: canal.id,
  });

  await clientVideoSettingsRepository.copiarEstiloParaVideo(cliente.id, video.id, { deCanalId: canal.id });
  assert.equal((await clientVideoSettingsRepository.findVideoOverride(cliente.id, video.id)).max_clips, 2);

  // O cliente muda o estilo daquele canal depois.
  await clientVideoSettingsRepository.upsert(cliente.id, config({ maxClips: 8 }), { youtubeChannelId: canal.id });

  assert.equal(
    (await clientVideoSettingsRepository.findVideoOverride(cliente.id, video.id)).max_clips,
    2,
    'o video ja mandado cortar nao pode mudar sozinho - o cliente ja viu como ia ficar'
  );
});

test('copiar sem canal usa o padrao do cliente como ponto de partida', async () => {
  const cliente = await createClient();
  const video = await createSourceVideo(cliente.id);
  await clientVideoSettingsRepository.upsert(cliente.id, config({ maxClips: 5, captionStyle: 'bold' }));

  await clientVideoSettingsRepository.copiarEstiloParaVideo(cliente.id, video.id, {});

  const doVideo = await clientVideoSettingsRepository.findVideoOverride(cliente.id, video.id);
  assert.equal(doVideo.max_clips, 5);
  assert.equal(doVideo.caption_style, 'bold');
});

test('trocar o idioma de um video nao apaga o estilo que ele ja tinha', async () => {
  const cliente = await createClient();
  const video = await createSourceVideo(cliente.id);
  await clientVideoSettingsRepository.upsert(cliente.id, config({ maxClips: 7, captionStyle: 'bold' }), {
    sourceVideoId: video.id,
  });

  await clientVideoSettingsRepository.setVideoAudioLanguage(cliente.id, video.id, 'pt');

  const doVideo = await clientVideoSettingsRepository.findVideoOverride(cliente.id, video.id);
  assert.equal(doVideo.audio_language, 'pt');
  assert.equal(doVideo.max_clips, 7, 'o resto do estilo sobrevive');
  assert.equal(doVideo.caption_style, 'bold');
});

test('o idioma escolhido no envio fica gravado no proprio video', async () => {
  const cliente = await createClient();
  const criado = await sourceVideosRepository.createManual({
    clientUserId: cliente.id,
    youtubeVideoId: `vid_${process.pid}_${Date.now()}`,
    title: 'Le Dernier qui Mange le Piment',
    thumbnailUrl: null,
    publishedAt: new Date(),
    durationSeconds: 600,
    chosenAudioLanguage: 'pt',
  });

  assert.equal(criado.chosen_audio_language, 'pt');
});

test('nao escolher idioma e diferente de escolher "original"', async () => {
  // NULL quer dizer "vale a configuração"; 'original' é uma escolha explícita
  // de quem viu o seletor e decidiu ficar com a trilha do canal.
  const cliente = await createClient();
  const semEscolha = await sourceVideosRepository.createManual({
    clientUserId: cliente.id,
    youtubeVideoId: `vid_sem_${process.pid}_${Date.now()}`,
    title: 'Sem escolha',
    thumbnailUrl: null,
    publishedAt: new Date(),
    durationSeconds: 60,
  });
  assert.equal(semEscolha.chosen_audio_language, null);
});

test('o estilo do video some junto com o video', async () => {
  const cliente = await createClient();
  const video = await createSourceVideo(cliente.id);
  await clientVideoSettingsRepository.upsert(cliente.id, config(), { sourceVideoId: video.id });

  await pool.query('DELETE FROM source_videos WHERE id = $1', [video.id]);

  const { rows } = await pool.query(
    'SELECT count(*)::int AS n FROM client_video_settings WHERE source_video_id = $1',
    [video.id]
  );
  assert.equal(rows[0].n, 0, 'estilo de video apagado nao serve pra nada');
});

test('uma linha nunca pode ser de um canal E de um video ao mesmo tempo', async () => {
  const cliente = await createClient();
  const canal = await createYoutubeChannel(cliente.id);
  const video = await createSourceVideo(cliente.id);

  await assert.rejects(
    () =>
      pool.query(
        `INSERT INTO client_video_settings (client_user_id, youtube_channel_id, source_video_id, caption_style)
         VALUES ($1, $2, $3, 'classic')`,
        [cliente.id, canal.id, video.id]
      ),
    /chk_video_settings_um_alvo/,
    'senao a resolucao passaria a depender da ordem das consultas'
  );
});
