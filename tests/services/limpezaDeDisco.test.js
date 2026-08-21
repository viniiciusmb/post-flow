// As duas limpezas automáticas que mantêm o disco da VPS sob controle.
//
// Em 21/08/2026 os cortes ocupavam 33 GB (55% do disco) sem ninguém perceber:
// a retenção era escolha do cliente com padrão de 7 dias, e o job só varria
// contas que tinham linha em posting_schedule_settings. Agora a retenção é
// única e fixa (3 dias) e a varredura é do sistema inteiro.
//
// O segundo job é novo: o vídeo-fonte compartilhado entre clientes que
// monitoram o mesmo canal não pode mais ser apagado pelo pipeline no fim do
// processamento (outro cliente ainda vai usá-lo), então alguém precisa
// assumir essa responsabilidade — senão o compartilhamento troca um problema
// de banda por um problema de disco.
//
// O que estes testes travam:
//   - corte postado há mais de 3 dias some; há menos de 3 dias fica;
//   - a limpeza NÃO leva junto o arquivo compartilhado de outro cliente;
//   - o arquivo compartilhado só é apagado quando ninguém mais precisa dele;
//   - o teto de horas apaga mesmo com pendente (rede de segurança contra
//     vídeo esquecido em 'error' pra sempre);
//   - a transcrição sobrevive ao arquivo, sempre.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const pool = require('../../src/db/pool');
const config = require('../../src/config');
const postingCleanupJob = require('../../src/worker/jobs/postingCleanupJob');
const sharedAssetsCleanupJob = require('../../src/worker/jobs/sharedAssetsCleanupJob');
const sharedVideoAssetsRepository = require('../../src/repositories/sharedVideoAssetsRepository');
const sourceVideosRepository = require('../../src/repositories/sourceVideosRepository');
const clipsRepository = require('../../src/repositories/clipsRepository');
const videosRepository = require('../../src/repositories/videosRepository');
const postingsRepository = require('../../src/repositories/postingsRepository');
const sharedVideoFiles = require('../../src/lib/sharedVideoFiles');
const { RETENCAO_CORTE_POSTADO_HORAS } = require('../../src/config/constants');
const { createClient, createYoutubeChannel } = require('../helpers/db');

const workDirOriginal = config.videoProcessing.workDir;
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'postflow-limpeza-'));
config.videoProcessing.workDir = workDir;

test.after(async () => {
  config.videoProcessing.workDir = workDirOriginal;
  fs.rmSync(workDir, { recursive: true, force: true });
  await pool.end();
});

let contador = 0;

async function contaTiktok(clientUserId) {
  contador += 1;
  const { rows } = await pool.query(
    `INSERT INTO tiktok_accounts (client_user_id, tiktok_open_id, display_name, is_active,
       access_token_encrypted, access_token_iv, refresh_token_encrypted, refresh_token_iv,
       scopes, token_expires_at, connected_at)
     VALUES ($1, $2, 'Conta de teste', true, 'x','x','x','x',
       ARRAY['video.publish'], now() + interval '30 days', now()) RETURNING *`,
    [clientUserId, `open_${contador}_${Date.now()}`]
  );
  return rows[0];
}

// Um corte já publicado, com arquivos de verdade em disco, publicado há N horas.
async function cortePostadoHa(horas, { youtubeVideoId = null, localVideoPath = null } = {}) {
  contador += 1;
  const cliente = await createClient();
  const conta = await contaTiktok(cliente.id);

  const { rows: sv } = await pool.query(
    `INSERT INTO source_videos
       (client_user_id, owner_client_user_id, input_type, title, status, duration_seconds, youtube_video_id, local_video_path)
     VALUES ($1, $1, 'manual', 'Video', 'ready', 600, $2, $3) RETURNING *`,
    [cliente.id, youtubeVideoId, localVideoPath]
  );
  const sourceVideo = sv[0];

  const clipPath = path.join(workDir, `corte-${contador}.mp4`);
  const thumbPath = path.join(workDir, `capa-${contador}.jpg`);
  fs.writeFileSync(clipPath, 'corte');
  fs.writeFileSync(thumbPath, 'capa');

  const { rows: cl } = await pool.query(
    `INSERT INTO clips (source_video_id, title, start_seconds, end_seconds, status, local_clip_path, thumbnail_path)
     VALUES ($1, 'Corte', 0, 30, 'ready', $2, $3) RETURNING *`,
    [sourceVideo.id, clipPath, thumbPath]
  );
  const clip = cl[0];

  // Passa pelos repositórios de verdade em vez de SQL cru: o formato de
  // videos/postings é assunto deles, e teste que reimplementa o INSERT quebra
  // sozinho a cada migration.
  const video = await videosRepository.createFromClip({ clipId: clip.id, filename: 'corte.mp4', fileSizeBytes: 10 });
  const posting = await postingsRepository.createIfNotExists({
    videoId: video.id,
    tiktokAccountId: conta.id,
    caption: null,
  });
  const { rows: pt } = await pool.query(
    `UPDATE postings SET status = 'posted', posted_at = now() - ($2 || ' hours')::interval
      WHERE id = $1 RETURNING *`,
    [posting.id, horas]
  );

  return { cliente, sourceVideo, clip, posting: pt[0], clipPath, thumbPath };
}

// Os testes abaixo usam a constante, então passariam com qualquer valor. Este
// trava o valor em si: o pedido foi 3 dias, e mudá-lo é uma decisão de produto
// (custo de disco), não um detalhe de implementação que se altera de passagem.
test('a retenção é de 3 dias', () => {
  assert.equal(RETENCAO_CORTE_POSTADO_HORAS, 72);
});

test(`corte postado há mais de ${RETENCAO_CORTE_POSTADO_HORAS}h é apagado do disco e do banco`, async () => {
  const velho = await cortePostadoHa(RETENCAO_CORTE_POSTADO_HORAS + 1);

  await postingCleanupJob.run();

  assert.equal(fs.existsSync(velho.clipPath), false, 'o arquivo do corte tinha que sumir');
  assert.equal(fs.existsSync(velho.thumbPath), false, 'a capa tinha que sumir');
  assert.equal(await clipsRepository.findById(velho.clip.id), null);
  // Era o último corte daquele vídeo, então o vídeo-fonte vai junto.
  assert.equal(await sourceVideosRepository.findById(velho.sourceVideo.id), null);
});

test(`corte postado há menos de ${RETENCAO_CORTE_POSTADO_HORAS}h continua intacto`, async () => {
  const novo = await cortePostadoHa(RETENCAO_CORTE_POSTADO_HORAS - 2);

  await postingCleanupJob.run();

  assert.equal(fs.existsSync(novo.clipPath), true);
  assert.ok(await clipsRepository.findById(novo.clip.id));
  assert.ok(await sourceVideosRepository.findById(novo.sourceVideo.id));
});

test('a retenção não leva junto o vídeo compartilhado com outro cliente', async () => {
  const youtubeVideoId = `vid_ret_${Date.now()}`;
  const arquivo = sharedVideoFiles.pathFor(youtubeVideoId);
  fs.mkdirSync(sharedVideoFiles.dir(), { recursive: true });
  fs.writeFileSync(arquivo, 'video compartilhado');
  await sharedVideoAssetsRepository.saveDownload(youtubeVideoId, { localVideoPath: arquivo, bytes: 19 });

  // Cliente A já publicou e passou do prazo: o vídeo-fonte dele vai sumir.
  const a = await cortePostadoHa(RETENCAO_CORTE_POSTADO_HORAS + 1, { youtubeVideoId, localVideoPath: arquivo });
  // Cliente B ainda está esperando processar o MESMO vídeo do YouTube.
  const b = await createClient();
  const canalB = await createYoutubeChannel(b.id);
  await pool.query(
    `INSERT INTO source_videos (youtube_channel_id, owner_client_user_id, youtube_video_id, title, status, input_type, duration_seconds)
     VALUES ($1, $2, $3, 'Video', 'detected', 'channel', 600)`,
    [canalB.id, b.id, youtubeVideoId]
  );

  await postingCleanupJob.run();

  assert.equal(await sourceVideosRepository.findById(a.sourceVideo.id), null, 'o vídeo do cliente A some');
  assert.equal(
    fs.existsSync(arquivo),
    true,
    'mas o arquivo compartilhado fica: o cliente B ainda vai usá-lo'
  );
});

test('vídeo compartilhado só é apagado quando ninguém mais precisa dele', async () => {
  const youtubeVideoId = `vid_cln_${Date.now()}`;
  const arquivo = sharedVideoFiles.pathFor(youtubeVideoId);
  fs.mkdirSync(sharedVideoFiles.dir(), { recursive: true });
  fs.writeFileSync(arquivo, 'video');
  await sharedVideoAssetsRepository.saveDownload(youtubeVideoId, { localVideoPath: arquivo, bytes: 5 });
  await sharedVideoAssetsRepository.saveTranscript(youtubeVideoId, {
    transcriptText: 'ola',
    transcriptWords: [{ word: 'ola', start: 0, end: 1 }],
    whisperAudioSeconds: 600,
    whisperCostUsd: 0.36,
    language: 'pt',
  });

  const cliente = await createClient();
  const canal = await createYoutubeChannel(cliente.id);
  const { rows } = await pool.query(
    `INSERT INTO source_videos (youtube_channel_id, owner_client_user_id, youtube_video_id, title, status, input_type, duration_seconds)
     VALUES ($1, $2, $3, 'Video', 'detected', 'channel', 600) RETURNING *`,
    [canal.id, cliente.id, youtubeVideoId]
  );
  const pendente = rows[0];

  await sharedAssetsCleanupJob.run();
  assert.equal(fs.existsSync(arquivo), true, 'tem um vídeo pendente: não pode apagar');

  // O pendente terminou.
  await sourceVideosRepository.updateStatus(pendente.id, 'ready');
  await sharedAssetsCleanupJob.run();

  assert.equal(fs.existsSync(arquivo), false, 'ninguém mais precisa: agora apaga');

  const asset = await sharedVideoAssetsRepository.findByYoutubeVideoId(youtubeVideoId);
  assert.equal(asset.local_video_path, null, 'a linha tem que refletir que o arquivo não existe mais');
  assert.deepEqual(
    asset.transcript_words,
    [{ word: 'ola', start: 0, end: 1 }],
    'a transcrição NUNCA é apagada aqui: é minúscula e é a parte cara de refazer'
  );
});

test('teto de horas apaga mesmo com vídeo pendente esquecido em erro', async () => {
  const youtubeVideoId = `vid_velho_${Date.now()}`;
  const arquivo = sharedVideoFiles.pathFor(youtubeVideoId);
  fs.mkdirSync(sharedVideoFiles.dir(), { recursive: true });
  fs.writeFileSync(arquivo, 'video');
  await sharedVideoAssetsRepository.saveDownload(youtubeVideoId, { localVideoPath: arquivo, bytes: 5 });
  // Baixado há mais tempo que o teto.
  await pool.query(
    `UPDATE shared_video_assets SET downloaded_at = now() - ($2 || ' hours')::interval WHERE youtube_video_id = $1`,
    [youtubeVideoId, sharedAssetsCleanupJob.MAX_HORAS_EM_DISCO + 1]
  );

  // Um vídeo travado em 'error' que ninguém nunca vai reprocessar - sem o teto
  // ele prenderia centenas de MB para sempre.
  const cliente = await createClient();
  const canal = await createYoutubeChannel(cliente.id);
  await pool.query(
    `INSERT INTO source_videos (youtube_channel_id, owner_client_user_id, youtube_video_id, title, status, input_type, duration_seconds)
     VALUES ($1, $2, $3, 'Video', 'error', 'channel', 600)`,
    [canal.id, cliente.id, youtubeVideoId]
  );

  await sharedAssetsCleanupJob.run();
  assert.equal(fs.existsSync(arquivo), false, 'passou do teto de horas: apaga mesmo com pendente');
});

test('linha aponta pra arquivo que não existe mais: a linha é corrigida', async () => {
  const youtubeVideoId = `vid_fantasma_${Date.now()}`;
  const arquivo = sharedVideoFiles.pathFor(youtubeVideoId);
  await sharedVideoAssetsRepository.saveDownload(youtubeVideoId, { localVideoPath: arquivo, bytes: 5 });
  // O arquivo nunca chegou a existir (volume perdido num deploy, por exemplo).

  const cliente = await createClient();
  const canal = await createYoutubeChannel(cliente.id);
  await pool.query(
    `INSERT INTO source_videos (youtube_channel_id, owner_client_user_id, youtube_video_id, title, status, input_type, duration_seconds)
     VALUES ($1, $2, $3, 'Video', 'detected', 'channel', 600)`,
    [canal.id, cliente.id, youtubeVideoId]
  );

  await sharedAssetsCleanupJob.run();

  const asset = await sharedVideoAssetsRepository.findByYoutubeVideoId(youtubeVideoId);
  assert.equal(
    asset.local_video_path,
    null,
    'sem isso o pipeline acharia que dá pra reaproveitar e quebraria na hora de cortar'
  );
});

test('arquivo órfão na pasta compartilhada é varrido, mas só depois de esfriar', async () => {
  fs.mkdirSync(sharedVideoFiles.dir(), { recursive: true });
  const recem = path.join(sharedVideoFiles.dir(), `orfao_novo_${Date.now()}.mp4`);
  const antigo = path.join(sharedVideoFiles.dir(), `orfao_velho_${Date.now()}.mp4`);
  fs.writeFileSync(recem, 'acabou de chegar');
  fs.writeFileSync(antigo, 'esquecido');
  const horasAtras = new Date(Date.now() - (sharedAssetsCleanupJob.IDADE_MINIMA_ORFAO_HORAS + 1) * 3_600_000);
  fs.utimesSync(antigo, horasAtras, horasAtras);

  await sharedAssetsCleanupJob.run();

  assert.equal(
    fs.existsSync(recem),
    true,
    'arquivo recém-movido pode ainda não ter linha no banco - apagar aqui mataria um download que acabou de acontecer'
  );
  assert.equal(fs.existsSync(antigo), false, 'órfão frio some');
});
