// Título do vídeo no idioma original.
//
// O YouTube traduz título e descrição conforme quem pergunta. A listagem do
// canal (--flat-playlist) vinha em inglês: um vídeo chamado "ABRIMOS UM
// RESTAURANTE" chegava no sistema como "WE OPENED A RESTAURANT". Consultar o
// vídeo em si devolve o original.
//
// Confirmado na VPS contra o YouTube de verdade, no mesmo vídeo:
//   listagem do canal  -> "WE OPENED A RESTAURANT! FT. ÉRICK JACQUIN"
//   consulta do vídeo  -> "ABRIMOS UM RESTAURANTE! FT. ÉRICK JACQUIN"
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const pool = require('../../src/db/pool');
const channelCheckJob = require('../../src/worker/videoJobs/channelCheckJob');
const ytDlpService = require('../../src/services/ytDlpService');
const { createClient, createYoutubeChannel } = require('../helpers/db');

test.after(async () => {
  await pool.end();
});

const bossFalso = { send: async () => {} };

// Simula os dois caminhos do yt-dlp: a listagem (que traduz) e a consulta de um
// vídeo (que traz o original).
function comYtDlp({ listagem, metadados }, fn) {
  const listarOriginal = ytDlpService.listChannelVideos;
  const metaOriginal = ytDlpService.getVideoMetadata;
  ytDlpService.listChannelVideos = async () => listagem;
  ytDlpService.getVideoMetadata = metadados;
  return fn().finally(() => {
    ytDlpService.listChannelVideos = listarOriginal;
    ytDlpService.getVideoMetadata = metaOriginal;
  });
}

async function tituloSalvo(canalId) {
  const { rows } = await pool.query(
    'SELECT title FROM source_videos WHERE youtube_channel_id = $1 ORDER BY id DESC LIMIT 1',
    [canalId]
  );
  return rows[0] ? rows[0].title : null;
}

// A checagem só enfileira vídeo NOVO quando já existe marco d'água, então o
// canal precisa ter um last_video_id anterior.
async function comMarcoDagua(canalId, videoId) {
  await pool.query('UPDATE youtube_channels SET last_video_id = $2 WHERE id = $1', [canalId, videoId]);
}

test('salva o título original, não o traduzido pelo YouTube', async () => {
  const cliente = await createClient();
  const canal = await createYoutubeChannel(cliente.id);
  await comMarcoDagua(canal.id, 'antigo000001');

  await comYtDlp(
    {
      listagem: [
        { videoId: 'novo00000001', title: 'WE OPENED A RESTAURANT!', thumbnailUrl: null, publishedAt: null, durationSeconds: 600 },
        { videoId: 'antigo000001', title: 'anterior', thumbnailUrl: null, publishedAt: null, durationSeconds: 600 },
      ],
      metadados: async () => ({ title: 'ABRIMOS UM RESTAURANTE!', language: 'pt-BR' }),
    },
    () => channelCheckJob.run(bossFalso)
  );

  assert.equal(await tituloSalvo(canal.id), 'ABRIMOS UM RESTAURANTE!');
});

test('vídeo em inglês continua em inglês', async () => {
  // O contrário também precisa valer: a correção não pode "abrasileirar" um
  // canal que fala inglês. Por isso a solução é buscar o ORIGINAL, e não fixar
  // um idioma preferido.
  const cliente = await createClient();
  const canal = await createYoutubeChannel(cliente.id);
  await comMarcoDagua(canal.id, 'antigo000002');

  await comYtDlp(
    {
      listagem: [
        { videoId: 'novo00000002', title: 'qualquer coisa', thumbnailUrl: null, publishedAt: null, durationSeconds: 600 },
        { videoId: 'antigo000002', title: 'anterior', thumbnailUrl: null, publishedAt: null, durationSeconds: 600 },
      ],
      metadados: async () => ({ title: 'The Galaxy Z Fold 8 Review', language: 'en' }),
    },
    () => channelCheckJob.run(bossFalso)
  );

  assert.equal(await tituloSalvo(canal.id), 'The Galaxy Z Fold 8 Review');
});

test('se a consulta do título falhar, o vídeo NÃO se perde', async () => {
  const cliente = await createClient();
  const canal = await createYoutubeChannel(cliente.id);
  await comMarcoDagua(canal.id, 'antigo000003');

  await comYtDlp(
    {
      listagem: [
        { videoId: 'novo00000003', title: 'TITULO DA LISTAGEM', thumbnailUrl: null, publishedAt: null, durationSeconds: 600 },
        { videoId: 'antigo000003', title: 'anterior', thumbnailUrl: null, publishedAt: null, durationSeconds: 600 },
      ],
      metadados: async () => {
        throw new Error('YouTube bloqueou');
      },
    },
    () => channelCheckJob.run(bossFalso)
  );

  // Título errado incomoda; vídeo perdido é pior. Cai no título da listagem.
  assert.equal(await tituloSalvo(canal.id), 'TITULO DA LISTAGEM');
});

test('a falha do título não marca o canal como quebrado', async () => {
  const cliente = await createClient();
  const canal = await createYoutubeChannel(cliente.id);
  await comMarcoDagua(canal.id, 'antigo000004');

  await comYtDlp(
    {
      listagem: [
        { videoId: 'novo00000004', title: 'TITULO', thumbnailUrl: null, publishedAt: null, durationSeconds: 600 },
        { videoId: 'antigo000004', title: 'anterior', thumbnailUrl: null, publishedAt: null, durationSeconds: 600 },
      ],
      metadados: async () => {
        throw new Error('YouTube bloqueou');
      },
    },
    () => channelCheckJob.run(bossFalso)
  );

  // A checagem em si deu certo: o vídeo foi detectado. Marcar o canal como
  // falho aqui encheria o painel de erros de coisa que não é problema.
  const { rows } = await pool.query('SELECT last_check_ok FROM youtube_channels WHERE id = $1', [canal.id]);
  assert.equal(rows[0].last_check_ok, true);
});
