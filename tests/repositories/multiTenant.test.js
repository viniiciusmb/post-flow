// Isolamento entre clientes (multi-tenant). O sistema tem um admin e varios
// clientes, cada um com seus canais, videos, cortes e contas TikTok. O erro
// mais caro possivel aqui e um cliente conseguir ler ou apagar dado de outro
// so por chutar um numero de ID na URL (IDOR).
//
// Estes testes atacam a camada de repositorio, que e onde a regra de posse
// mora de verdade: mesmo que um controller esqueca de checar, a query tem que
// filtrar pelo dono.
'use strict';

const test = require('node:test');
const assert = require('node:assert');

const sourceVideosRepository = require('../../src/repositories/sourceVideosRepository');
const youtubeChannelsRepository = require('../../src/repositories/youtubeChannelsRepository');
const clipsRepository = require('../../src/repositories/clipsRepository');
const { pool, createClient, createSourceVideo, createYoutubeChannel, closePool } = require('../helpers/db');

test.after(() => closePool());

test('cliente nao consegue ler video de outro cliente pelo ID', async () => {
  const dono = await createClient({ businessName: 'Dono' });
  const invasor = await createClient({ businessName: 'Invasor' });
  const video = await createSourceVideo(dono.id);

  const comoDono = await sourceVideosRepository.findByIdOwnedByClient(video.id, dono.id);
  const comoInvasor = await sourceVideosRepository.findByIdOwnedByClient(video.id, invasor.id);

  assert.ok(comoDono, 'o dono precisa conseguir ler o proprio video');
  assert.strictEqual(comoInvasor, null, 'o invasor NAO pode ler o video do outro');
});

test('cliente nao consegue apagar video de outro cliente', async () => {
  const dono = await createClient();
  const invasor = await createClient();
  const video = await createSourceVideo(dono.id);

  const apagouComoInvasor = await sourceVideosRepository.deleteByIdOwnedByClient(video.id, invasor.id);
  assert.strictEqual(apagouComoInvasor, false, 'a exclusao alheia tem que ser recusada');

  const aindaExiste = await sourceVideosRepository.findById(video.id);
  assert.ok(aindaExiste, 'o video do dono nao pode ter sumido');

  const apagouComoDono = await sourceVideosRepository.deleteByIdOwnedByClient(video.id, dono.id);
  assert.strictEqual(apagouComoDono, true, 'o dono precisa conseguir apagar o proprio video');
});

test('a posse de video de CANAL vem do dono do canal, nao da coluna direta', async () => {
  // Video vindo de canal tem client_user_id NULL - o dono e o dono do canal.
  // E o caso onde uma checagem ingenua (WHERE client_user_id = $1) falharia
  // silenciosamente e deixaria o video sem dono nenhum.
  const dono = await createClient();
  const invasor = await createClient();
  const canal = await createYoutubeChannel(dono.id);

  const { rows: [video] } = await pool.query(
    `INSERT INTO source_videos (title, status, input_type, youtube_channel_id, owner_client_user_id, youtube_video_id)
     VALUES ('Video de canal', 'ready', 'channel', $1, $2, $3) RETURNING *`,
    [canal.id, dono.id, `vid_${Date.now()}`]
  );

  assert.strictEqual(video.client_user_id, null, 'video de canal nao guarda o cliente direto');

  const comoDono = await sourceVideosRepository.findByIdOwnedByClient(video.id, dono.id);
  const comoInvasor = await sourceVideosRepository.findByIdOwnedByClient(video.id, invasor.id);

  assert.ok(comoDono, 'o dono do canal precisa alcancar o video do canal dele');
  assert.strictEqual(comoInvasor, null, 'ninguem mais pode alcancar');
});

test('cliente nao consegue apagar nem desativar canal de outro cliente', async () => {
  const dono = await createClient();
  const invasor = await createClient();
  const canal = await createYoutubeChannel(dono.id);

  await youtubeChannelsRepository.remove(canal.id, invasor.id);
  const { rows: aindaLa } = await pool.query('SELECT * FROM youtube_channels WHERE id = $1', [canal.id]);
  assert.strictEqual(aindaLa.length, 1, 'o canal do dono nao pode ter sido apagado pelo invasor');

  const desativado = await youtubeChannelsRepository.setActive(canal.id, invasor.id, false);
  assert.ok(!desativado, 'o invasor nao pode desativar canal alheio');
});

test('listagem de canais so devolve os do proprio cliente', async () => {
  const clienteA = await createClient();
  const clienteB = await createClient();
  await createYoutubeChannel(clienteA.id, { name: 'Canal do A' });
  await createYoutubeChannel(clienteA.id, { name: 'Outro do A' });
  await createYoutubeChannel(clienteB.id, { name: 'Canal do B' });

  const doA = await youtubeChannelsRepository.listByClientId(clienteA.id);
  const doB = await youtubeChannelsRepository.listByClientId(clienteB.id);

  assert.strictEqual(doA.length, 2);
  assert.strictEqual(doB.length, 1);
  assert.ok(
    doA.every((c) => String(c.client_user_id) === String(clienteA.id)),
    'nenhum canal de outro cliente pode vazar na lista'
  );
});

test('cliente nao consegue ler corte de outro cliente pelo ID', async () => {
  const dono = await createClient();
  const invasor = await createClient();
  const video = await createSourceVideo(dono.id, { status: 'ready' });
  const [corte] = await clipsRepository.createMany(video.id, [
    { title: 'Corte de teste', startSeconds: 0, endSeconds: 30, description: null },
  ]);

  const comoDono = await clipsRepository.findByIdOwnedByClient(corte.id, dono.id);
  const comoInvasor = await clipsRepository.findByIdOwnedByClient(corte.id, invasor.id);

  assert.ok(comoDono, 'o dono precisa conseguir ler o proprio corte');
  assert.strictEqual(comoInvasor, null, 'o invasor NAO pode ler o corte do outro');
});
