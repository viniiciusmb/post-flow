// Duas coisas que apareceram juntas em 25/08/2026, quando um vídeo novo de um
// canal monitorado não entrou em processamento:
//
//   1. O vídeo FOI detectado e falhou no download com "The page needs to be
//      reloaded" (bloqueio momentâneo do YouTube). Devia ter sido reprocessado
//      sozinho — e não foi, porque o retry automático classificava o erro
//      lendo `source_videos.error_message`, coluna que virou sempre NULL
//      quando a mensagem técnica saiu da tela do cliente. 3 de 3 vídeos em
//      erro na produção, nenhum reprocessado, e nenhum sinal de que a
//      recuperação tinha parado de existir.
//
//   2. Freio de engarrafamento: canal que publica todo dia gera cortes mais
//      rápido do que a fila publica.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const erroDeProcessamento = require('../../src/lib/erroDeProcessamento');
const sourceVideosRepository = require('../../src/repositories/sourceVideosRepository');
const youtubeChannelsRepository = require('../../src/repositories/youtubeChannelsRepository');
const pool = require('../../src/db/pool');
const db = require('../helpers/db');

test.after(async () => {
  await pool.end();
});

let seq = 0;
const unico = () => `${Date.now()}${seq++}`;

// --- 1. Classificação do erro ---

test('bloqueio momentâneo do YouTube conta como passageiro', () => {
  // O erro REAL que parou o vídeo 1959 em produção.
  const real = new Error('yt-dlp saiu com codigo 1: ERROR: [youtube] 7TSKLipIQsA: The page needs to be reloaded.');
  assert.equal(erroDeProcessamento.ehPassageiro(real), true);

  for (const m of [
    'Sign in to confirm you are not a bot',
    'connect ETIMEDOUT 1.2.3.4:443',
    'proxy connection failed',
    'HTTP Error 429: Too Many Requests',
    'fetch failed',
  ]) {
    assert.equal(erroDeProcessamento.ehPassageiro(new Error(m)), true, `"${m}" devia ser passageiro`);
  }
});

test('erro que não muda sozinho NÃO fica reprocessando', () => {
  // Reprocessar refaz download, Whisper e render - repetir um erro de verdade
  // três vezes gasta dinheiro de API a cada volta.
  for (const m of [
    'You have no credits remaining',
    'ERROR: [youtube] abc: Private video',
    'ERROR: [youtube] abc: Video unavailable',
    'insufficient_quota',
  ]) {
    assert.equal(erroDeProcessamento.ehPassageiro(new Error(m)), false, `"${m}" não devia ser repetido`);
  }

  // "This live event will begin in 3 hours" ficava AQUI até 27/08/2026, e era
  // o contrário da verdade: esse vídeo vai existir daqui a pouco - só não
  // existe agora. Tratar como definitivo custou um vídeo perdido em produção
  // (ver tests/services/estreiaDoYoutube.test.js).
  assert.equal(erroDeProcessamento.ehPassageiro(new Error('This live event will begin in 3 hours')), true);
});

test('erro desconhecido não vira reprocessamento infinito', () => {
  assert.equal(erroDeProcessamento.ehPassageiro(new Error('coisa nunca vista')), false);
  assert.equal(erroDeProcessamento.ehPassageiro(null), false);
});

// --- 2. O veredito sobrevive no banco e alimenta o retry ---

async function videoEmErro({ passageiro }) {
  const cliente = await db.createClient();
  const video = await db.createSourceVideo(cliente.id);
  await sourceVideosRepository.updateStatus(video.id, 'error', {
    errorMessage: null,
    errorTransient: passageiro,
  });
  // O retry só pega o que está parado há 10+ minutos, pra não brigar com um
  // clique manual do cliente.
  await pool.query("UPDATE source_videos SET updated_at = now() - interval '20 minutes' WHERE id = $1", [video.id]);
  return video;
}

test('vídeo com erro passageiro é encontrado pelo retry automático', async () => {
  const video = await videoEmErro({ passageiro: true });
  const achados = await sourceVideosRepository.findTransientErrorsForAutoRetry();
  assert.ok(
    achados.some((v) => String(v.id) === String(video.id)),
    'o vídeo não seria reprocessado sozinho - foi exatamente o que aconteceu em produção'
  );
});

test('vídeo com erro definitivo NÃO é reprocessado sozinho', async () => {
  const video = await videoEmErro({ passageiro: false });
  const achados = await sourceVideosRepository.findTransientErrorsForAutoRetry();
  assert.ok(!achados.some((v) => String(v.id) === String(video.id)));
});

test('o retry NÃO depende da mensagem de erro guardada', async () => {
  // Este é o coração do defeito: a mensagem técnica não vai mais pra tela do
  // cliente e é gravada como NULL. Se a busca voltar a depender dela, o retry
  // desliga em silêncio de novo.
  const video = await videoEmErro({ passageiro: true });
  const { rows } = await pool.query('SELECT error_message FROM source_videos WHERE id = $1', [video.id]);
  assert.equal(rows[0].error_message, null, 'a mensagem é nula, como em produção');

  const achados = await sourceVideosRepository.findTransientErrorsForAutoRetry();
  assert.ok(achados.some((v) => String(v.id) === String(video.id)));
});

test('vídeo que voltou a rodar perde a marca de erro passageiro', async () => {
  const video = await videoEmErro({ passageiro: true });
  await sourceVideosRepository.updateStatus(video.id, 'downloading');
  const { rows } = await pool.query('SELECT error_transient FROM source_videos WHERE id = $1', [video.id]);
  assert.equal(rows[0].error_transient, null, 'marca velha faria o retry pegar um vídeo que está rodando');
});

test('depois de 3 tentativas o vídeo para de ser reprocessado', async () => {
  const video = await videoEmErro({ passageiro: true });
  await pool.query('UPDATE source_videos SET auto_retry_count = 3 WHERE id = $1', [video.id]);
  const achados = await sourceVideosRepository.findTransientErrorsForAutoRetry();
  assert.ok(!achados.some((v) => String(v.id) === String(video.id)));
});

// --- 3. Freio de engarrafamento ---

test('a opção vem LIGADA por padrão em canal novo', async () => {
  const cliente = await db.createClient();
  const canal = await db.createYoutubeChannel(cliente.id);
  const { rows } = await pool.query('SELECT process_only_when_queue_clear FROM youtube_channels WHERE id = $1', [canal.id]);
  assert.equal(rows[0].process_only_when_queue_clear, true, 'o padrão é evitar engarrafamento');
});

test('dá pra desligar e ligar de novo', async () => {
  const cliente = await db.createClient();
  const canal = await db.createYoutubeChannel(cliente.id);

  const desligado = await youtubeChannelsRepository.setProcessOnlyWhenQueueClear(canal.id, cliente.id, false);
  assert.equal(desligado.process_only_when_queue_clear, false);

  const ligado = await youtubeChannelsRepository.setProcessOnlyWhenQueueClear(canal.id, cliente.id, true);
  assert.equal(ligado.process_only_when_queue_clear, true);
});

test('o canal de outro cliente não pode ser mexido', async () => {
  const dono = await db.createClient();
  const estranho = await db.createClient();
  const canal = await db.createYoutubeChannel(dono.id);

  const r = await youtubeChannelsRepository.setProcessOnlyWhenQueueClear(canal.id, estranho.id, false);
  assert.equal(r, null, 'um cliente conseguiu mudar a configuração do canal de outro');
});

// --- 4. O freio agindo dentro da checagem de canal ---

const channelCheckJob = require('../../src/worker/videoJobs/channelCheckJob');
const ytDlpService = require('../../src/services/ytDlpService');

async function comListagem(fake, fn) {
  const original = ytDlpService.listChannelVideos;
  const originalMeta = ytDlpService.getVideoMetadata;
  ytDlpService.listChannelVideos = fake;
  ytDlpService.getVideoMetadata = async () => ({ title: 'titulo', publishedAt: new Date() });
  try {
    await fn();
  } finally {
    ytDlpService.listChannelVideos = original;
    ytDlpService.getVideoMetadata = originalMeta;
  }
}

// Canal ativo, com conta do TikTok e marco d'água já estabelecido - é o estado
// em que uma checagem de verdade encontraria vídeo novo.
async function canalMonitorando({ freio, pendentes }) {
  const cliente = await db.createClient();
  const { rows: [conta] } = await pool.query(
    `INSERT INTO tiktok_accounts (client_user_id, tiktok_open_id, display_name, is_active,
       access_token_encrypted, access_token_iv, refresh_token_encrypted, refresh_token_iv,
       scopes, token_expires_at, connected_at)
     VALUES ($1,$2,'conta',true,'x','x','x','x',ARRAY['video.publish'], now()+interval '30 days', now())
     RETURNING *`,
    [cliente.id, `open-${unico()}`]
  );
  const canal = await db.createYoutubeChannel(cliente.id);
  await pool.query(
    `UPDATE youtube_channels
        SET is_active = true, tiktok_account_id = $2, last_video_id = 'JA_VISTO',
            process_only_when_queue_clear = $3
      WHERE id = $1`,
    [canal.id, conta.id, freio]
  );

  // Enche a fila de postagens pendentes.
  for (let i = 0; i < pendentes; i++) {
    const { rows: [sv] } = await pool.query(
      `INSERT INTO source_videos (youtube_video_id, title, status, input_type, owner_client_user_id, client_user_id)
       VALUES ($1,'v','ready','upload',$2,$2) RETURNING *`, [`fila${unico()}`, cliente.id]
    );
    const { rows: [clip] } = await pool.query(
      `INSERT INTO clips (source_video_id, start_seconds, end_seconds, status, title)
       VALUES ($1,0,30,'ready','c') RETURNING *`, [sv.id]
    );
    const { rows: [v] } = await pool.query(
      `INSERT INTO videos (source_type, clip_id, filename, mime_type, file_size_bytes)
       VALUES ('youtube_clip',$1,'c.mp4','video/mp4',1000) RETURNING *`, [clip.id]
    );
    await pool.query(
      `INSERT INTO postings (video_id, tiktok_account_id, status, scheduled_for)
       VALUES ($1,$2,'pending', now() + interval '1 day')`, [v.id, conta.id]
    );
  }
  return { cliente, canal, conta };
}

async function videosDoCanal(canalId) {
  const { rows } = await pool.query('SELECT * FROM source_videos WHERE youtube_channel_id = $1', [canalId]);
  return rows;
}

const LISTAGEM = async () => [
  { videoId: `NOVO_${unico()}`, title: 'video novo', thumbnailUrl: null, durationSeconds: 600, publishedAt: null },
  { videoId: 'JA_VISTO', title: 'antigo', thumbnailUrl: null, durationSeconds: 600, publishedAt: null },
];

test('com a fila cheia, o canal NÃO pega vídeo novo', async () => {
  const { canal } = await canalMonitorando({ freio: true, pendentes: 5 });
  await comListagem(LISTAGEM, () => channelCheckJob.run({ send: async () => {} }));

  assert.equal((await videosDoCanal(canal.id)).length, 0, 'entrou vídeo mesmo com a fila cheia');
});

test('o marco d\'água NÃO avança quando o freio segura', async () => {
  // Se avançasse, o vídeo deixaria de ser "novo" e nunca mais seria pego -
  // o freio viraria perda de conteúdo em vez de adiamento.
  const { canal } = await canalMonitorando({ freio: true, pendentes: 5 });
  await comListagem(LISTAGEM, () => channelCheckJob.run({ send: async () => {} }));

  const { rows } = await pool.query('SELECT last_video_id, last_polled_at FROM youtube_channels WHERE id = $1', [canal.id]);
  assert.equal(rows[0].last_video_id, 'JA_VISTO', 'o marco avançou e o vídeo se perderia');
  assert.ok(rows[0].last_polled_at, 'a checagem tem que ficar registrada, senão a tela diz que o canal parou');
});

test('com a fila quase vazia, o vídeo novo entra', async () => {
  const { canal } = await canalMonitorando({ freio: true, pendentes: 1 });
  await comListagem(LISTAGEM, () => channelCheckJob.run({ send: async () => {} }));

  assert.equal((await videosDoCanal(canal.id)).length, 1, 'com 1 corte na fila o canal devia ter pegado o vídeo');
});

test('com o freio desligado, a fila cheia não segura nada', async () => {
  const { canal } = await canalMonitorando({ freio: false, pendentes: 9 });
  await comListagem(LISTAGEM, () => channelCheckJob.run({ send: async () => {} }));

  assert.equal((await videosDoCanal(canal.id)).length, 1, 'quem desligou o freio quer processar sempre');
});

test('canal sem conta do TikTok não é segurado', async () => {
  // Sem conta vinculada não há fila pra engarrafar: os cortes vão pro Drive ou
  // ficam prontos esperando. Segurar aqui pararia o cliente sem motivo.
  const { canal } = await canalMonitorando({ freio: true, pendentes: 0 });
  await pool.query('UPDATE youtube_channels SET tiktok_account_id = NULL WHERE id = $1', [canal.id]);
  await comListagem(LISTAGEM, () => channelCheckJob.run({ send: async () => {} }));

  assert.equal((await videosDoCanal(canal.id)).length, 1);
});
