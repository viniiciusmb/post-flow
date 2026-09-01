// A checagem de canal nunca mais pode enfileirar uma rajada de vídeos.
//
// Aconteceu de verdade em 01/09/2026, no canal "Manual do Mundo", e custou
// dinheiro: 14 vídeos ANTIGOS foram baixados e transcritos em 80 segundos —
// 479 MB pelo proxy pago, US$ 1,05 de IA e 132 minutos da cota do cliente.
//
// A causa: o vídeo que era o marco d'água saiu da listagem do canal (era
// exclusivo de membros e o canal o tirou da aba /videos). O `findIndex`
// devolveu -1, e a linha era:
//
//     newVideos = knownIndex === -1 ? videos : videos.slice(0, knownIndex)
//
// ou seja, "perdi meu lugar" era tratado como "tudo é novidade". O comentário
// dizia que `createIfNotExists` protegia contra duplicar — e protege, mas só
// contra vídeo JÁ CADASTRADO. Num canal em que 3 dos últimos 15 tinham sido
// processados, os outros 12 eram todos novos.
//
// Duas trancas independentes, e este arquivo trava as duas:
//   1. marco d'água perdido = NÃO processa nada, só reancora;
//   2. teto de vídeos por checagem, valha o que valer o raciocínio acima.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const pool = require('../../src/db/pool');
const channelCheckJob = require('../../src/worker/videoJobs/channelCheckJob');
const ytDlpService = require('../../src/services/ytDlpService');
const sourceVideosRepository = require('../../src/repositories/sourceVideosRepository');
const { createClient, createYoutubeChannel } = require('../helpers/db');

test.after(async () => {
  await pool.end();
});

let seq = 0;
const idDeVideo = () => `r${String(seq++).padStart(3, '0')}_${Date.now().toString(36)}`;

const bossFalso = () => {
  const enviados = [];
  return { enviados, send: async (_fila, dados) => enviados.push(dados) };
};

async function comListagem(listagem, fn) {
  const oList = ytDlpService.listChannelVideos;
  const oMeta = ytDlpService.getVideoMetadata;
  ytDlpService.listChannelVideos = listagem;
  ytDlpService.getVideoMetadata = async () => null;
  try {
    return await fn();
  } finally {
    ytDlpService.listChannelVideos = oList;
    ytDlpService.getVideoMetadata = oMeta;
  }
}

async function canalComMarco(marco) {
  await pool.query('UPDATE youtube_channels SET is_active = false');
  const cliente = await createClient();
  const canal = await createYoutubeChannel(cliente.id);
  await pool.query('UPDATE youtube_channels SET last_video_id = $2 WHERE id = $1', [canal.id, marco]);
  return { cliente, canal };
}

async function lerMarco(canalId) {
  const { rows } = await pool.query('SELECT last_video_id FROM youtube_channels WHERE id = $1', [canalId]);
  return rows[0].last_video_id;
}

const listaDe = (n) => Array.from({ length: n }, () => ({ videoId: idDeVideo(), title: 'v', availability: null, liveStatus: null }));

// --- 1. Marco d'água perdido ---

test('marco d’água que sumiu da listagem NÃO faz a lista inteira virar novidade', async () => {
  // É a reprodução exata do prejuízo: o marco não está mais entre os vídeos.
  const { cliente, canal } = await canalComMarco('video_que_sumiu_do_canal');
  const videos = listaDe(15);
  const boss = bossFalso();

  await comListagem(async () => videos, () => channelCheckJob.run(boss));

  assert.deepEqual(boss.enviados, [], `enfileirou ${boss.enviados.length} vídeos — era exatamente isso que custou dinheiro`);
  for (const v of videos) {
    const salvo = await sourceVideosRepository.findByYoutubeVideoIdForOwner(v.videoId, cliente.id);
    assert.equal(salvo, null, `o vídeo ${v.videoId} foi cadastrado mesmo sem ser novidade`);
  }
  assert.equal(await lerMarco(canal.id), videos[0].videoId, 'precisa reancorar no mais recente, senão repete na próxima');
});

test('depois de reancorar, a vida segue normal', async () => {
  // A reancoragem não pode deixar o canal mudo: o próximo vídeo de verdade
  // tem que entrar.
  const { cliente, canal } = await canalComMarco('sumiu');
  const videos = listaDe(5);
  const boss = bossFalso();

  await comListagem(async () => videos, () => channelCheckJob.run(boss));
  assert.deepEqual(boss.enviados, []);

  const novo = { videoId: idDeVideo(), title: 'video novo de verdade', availability: null, liveStatus: null };
  await comListagem(async () => [novo, ...videos], () => channelCheckJob.run(boss));

  assert.equal(boss.enviados.length, 1, 'o vídeo novo de verdade tinha que entrar');
  const salvo = await sourceVideosRepository.findByYoutubeVideoIdForOwner(novo.videoId, cliente.id);
  assert.ok(salvo);
  assert.equal(await lerMarco(canal.id), novo.videoId);
});

// --- 2. O teto por checagem ---

test('uma checagem nunca enfileira mais que o teto', async () => {
  // Segunda tranca: mesmo que algum caminho futuro volte a achar que tem 15
  // vídeos novos, só o teto entra na fila.
  const marco = idDeVideo();
  const { canal } = await canalComMarco(marco);
  const novos = listaDe(10);
  const boss = bossFalso();

  await comListagem(async () => [...novos, { videoId: marco, title: 'marco', availability: null, liveStatus: null }],
    () => channelCheckJob.run(boss));

  assert.ok(
    boss.enviados.length <= channelCheckJob.MAX_VIDEOS_POR_CHECAGEM,
    `enfileirou ${boss.enviados.length}, acima do teto de ${channelCheckJob.MAX_VIDEOS_POR_CHECAGEM}`
  );
  assert.equal(boss.enviados.length, channelCheckJob.MAX_VIDEOS_POR_CHECAGEM);
  assert.notEqual(await lerMarco(canal.id), novos[0].videoId, 'o marco passou por cima do que não foi processado');
});

test('o que passa do teto é ADIADO, não perdido', async () => {
  const marco = idDeVideo();
  const { cliente, canal } = await canalComMarco(marco);
  const novos = listaDe(5);
  const listagem = async () => [...novos, { videoId: marco, title: 'marco', availability: null, liveStatus: null }];

  const boss = bossFalso();
  await comListagem(listagem, () => channelCheckJob.run(boss));
  const primeiraLeva = boss.enviados.length;

  // Checagens seguintes vão consumindo o resto, sem nunca estourar o teto.
  await comListagem(listagem, () => channelCheckJob.run(boss));
  await comListagem(listagem, () => channelCheckJob.run(boss));

  const cadastrados = [];
  for (const v of novos) {
    const salvo = await sourceVideosRepository.findByYoutubeVideoIdForOwner(v.videoId, cliente.id);
    if (salvo) cadastrados.push(v.videoId);
  }
  assert.equal(cadastrados.length, novos.length, 'algum vídeo se perdeu entre uma checagem e outra');
  assert.equal(primeiraLeva, channelCheckJob.MAX_VIDEOS_POR_CHECAGEM);
  assert.equal(await lerMarco(canal.id), novos[0].videoId, 'no fim, o marco tem que alcançar o mais recente');
});

test('o dia a dia normal não é afetado', async () => {
  // Um vídeo novo por checagem é o caso real, e ele não pode nem encostar no teto.
  const marco = idDeVideo();
  const { canal } = await canalComMarco(marco);
  const novo = { videoId: idDeVideo(), title: 'video do dia', availability: null, liveStatus: null };
  const boss = bossFalso();

  await comListagem(async () => [novo, { videoId: marco, title: 'marco', availability: null, liveStatus: null }],
    () => channelCheckJob.run(boss));

  assert.equal(boss.enviados.length, 1);
  assert.equal(await lerMarco(canal.id), novo.videoId);
});
