// Checagem de canal do YouTube.
//
// Estes testes existem por causa de uma falha real: dois canais ficaram 3 dias
// sem detectar vídeo novo. A checagem rodava a cada 20 minutos e falhava toda
// vez, mas o único sinal disso era uma linha no log do servidor - a tela
// mostrava "última checagem: 31/07" e parecia agendamento parado.
//
// Duas coisas estavam erradas e as duas são travadas aqui:
//   1. a hora da tentativa só era gravada quando dava certo, então a data
//      congelava justamente no caso em que ela mais importa;
//   2. nada da falha chegava a quem usa o sistema.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const pool = require('../../src/db/pool');
const youtubeChannelsRepository = require('../../src/repositories/youtubeChannelsRepository');
const channelCheckJob = require('../../src/worker/videoJobs/channelCheckJob');
const ytDlpService = require('../../src/services/ytDlpService');
const { createClient, createYoutubeChannel } = require('../helpers/db');

test.after(async () => {
  await pool.end();
});

async function lerCanal(id) {
  const { rows } = await pool.query('SELECT * FROM youtube_channels WHERE id = $1', [id]);
  return rows[0];
}

// Troca o listChannelVideos de verdade por um de mentira só durante o teste:
// bater no YouTube aqui deixaria o teste dependente de rede e do humor da
// plataforma, que é justamente o que estamos simulando.
async function comListagem(fake, fn) {
  const original = ytDlpService.listChannelVideos;
  ytDlpService.listChannelVideos = fake;
  try {
    await fn();
  } finally {
    ytDlpService.listChannelVideos = original;
  }
}

const bossFalso = { send: async () => {} };

test('falha na checagem fica registrada no canal, não só no log', async () => {
  const cliente = await createClient();
  const canal = await createYoutubeChannel(cliente.id);

  await comListagem(
    async () => {
      throw new Error('yt-dlp saiu com codigo 1: Sign in to confirm you are not a bot');
    },
    () => channelCheckJob.run(bossFalso)
  );

  const depois = await lerCanal(canal.id);
  assert.equal(depois.last_check_ok, false);
  assert.ok(depois.last_check_at, 'a hora da TENTATIVA precisa ser gravada mesmo com erro');
  assert.match(depois.last_check_error, /not a bot/);
  assert.equal(depois.check_fail_count, 1);
});

test('a data de "conseguimos ler o canal" NÃO avança numa falha', async () => {
  const cliente = await createClient();
  const canal = await createYoutubeChannel(cliente.id);
  await pool.query("UPDATE youtube_channels SET last_polled_at = now() - interval '3 days' WHERE id = $1", [
    canal.id,
  ]);
  const antes = await lerCanal(canal.id);

  await comListagem(
    async () => {
      throw new Error('falhou de novo');
    },
    () => channelCheckJob.run(bossFalso)
  );

  const depois = await lerCanal(canal.id);
  // Se o erro empurrasse last_polled_at, a tela diria "checado agora" enquanto
  // nenhum vídeo novo é detectado há dias - mentira pior que a data velha.
  assert.deepEqual(depois.last_polled_at, antes.last_polled_at);
  assert.equal(depois.last_check_ok, false);
});

test('falhas seguidas somam, e um sucesso zera tudo', async () => {
  const cliente = await createClient();
  const canal = await createYoutubeChannel(cliente.id);

  await comListagem(
    async () => {
      throw new Error('primeira falha');
    },
    () => channelCheckJob.run(bossFalso)
  );
  await comListagem(
    async () => {
      throw new Error('segunda falha');
    },
    () => channelCheckJob.run(bossFalso)
  );
  assert.equal((await lerCanal(canal.id)).check_fail_count, 2);

  await comListagem(
    async () => [{ videoId: 'abc12345678', title: 'Vídeo', thumbnailUrl: null, publishedAt: null, durationSeconds: 600 }],
    () => channelCheckJob.run(bossFalso)
  );

  const depois = await lerCanal(canal.id);
  assert.equal(depois.check_fail_count, 0);
  assert.equal(depois.last_check_ok, true);
  assert.equal(depois.last_check_error, null);
  assert.ok(depois.last_polled_at, 'sucesso avança a data de leitura de verdade');
});

test('canal que não devolve vídeo nenhum também registra a tentativa', async () => {
  const cliente = await createClient();
  const canal = await createYoutubeChannel(cliente.id);

  await comListagem(async () => [], () => channelCheckJob.run(bossFalso));

  const depois = await lerCanal(canal.id);
  assert.ok(depois.last_check_at, 'sem isso a data congela e parece que o agendamento parou');
  assert.equal(depois.last_check_ok, false);
});

// A listagem rapida (--flat-playlist) nunca traz data de upload (sempre
// null) - so a consulta individual de metadados (getVideoMetadata, feita por
// video NOVO pra pegar o titulo original) traz a data de verdade. Achado
// numa investigacao real (13/08/2026): essa data ja era buscada mas jogada
// fora na hora de gravar, entao NENHUM video detectado automaticamente
// aparecia com data na tela "Videos & Cortes".
test('a data de publicacao do video novo vem da consulta individual, nao da listagem (que e sempre null)', async () => {
  const cliente = await createClient();
  const canal = await createYoutubeChannel(cliente.id);
  const dataReal = new Date('2026-08-13T11:52:58.000Z');
  // Sem isso o canal fica no caso "primeira checagem" (last_video_id nulo),
  // que so estabelece o marco d'agua e nunca enfileira nada - ver
  // channelCheckJob.run().
  await pool.query('UPDATE youtube_channels SET last_video_id = $2 WHERE id = $1', [canal.id, 'video_marco_dagua']);

  const originalGetMetadata = ytDlpService.getVideoMetadata;
  ytDlpService.getVideoMetadata = async () => ({
    videoId: 'abc12345678',
    title: 'Titulo original',
    thumbnailUrl: null,
    publishedAt: dataReal,
    durationSeconds: 600,
  });

  try {
    await comListagem(
      async () => [
        { videoId: 'abc12345678', title: 'Titulo traduzido', thumbnailUrl: null, publishedAt: null, durationSeconds: 600 },
      ],
      () => channelCheckJob.run(bossFalso)
    );
  } finally {
    ytDlpService.getVideoMetadata = originalGetMetadata;
  }

  const { rows } = await pool.query('SELECT published_at FROM source_videos WHERE youtube_video_id = $1', ['abc12345678']);
  assert.ok(rows[0].published_at, 'a data nao pode ficar em branco quando a consulta individual devolveu uma data valida');
  assert.equal(new Date(rows[0].published_at).getTime(), dataReal.getTime());
});

test('o erro guardado é cortado: mensagem do yt-dlp vem enorme', async () => {
  const cliente = await createClient();
  const canal = await createYoutubeChannel(cliente.id);

  await youtubeChannelsRepository.markCheckFailed(canal.id, 'x'.repeat(5000));

  const depois = await lerCanal(canal.id);
  assert.equal(depois.last_check_error.length, 500);
});
