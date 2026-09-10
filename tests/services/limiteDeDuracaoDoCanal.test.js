// "Não processar vídeos acima de N minutos", por canal.
//
// Um canal que publica cortes de 2 minutos e lives de 3 horas fazia o sistema
// baixar a live inteira, mandar para o Whisper e gerar dezenas de cortes que
// ninguém pediu — sem nenhuma forma de dizer "esse canal só me interessa até
// X".
//
// A regra em si (passaDoLimite) é testada sozinha porque os casos que quebram
// são os de borda: duração desconhecida, sem limite configurado, e o vídeo
// exatamente no limite.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { passaDoLimite, normalizarLimite, MAX_MINUTOS } = require('../../src/lib/limiteDeDuracao');
const sourceVideosRepository = require('../../src/repositories/sourceVideosRepository');
const youtubeChannelsRepository = require('../../src/repositories/youtubeChannelsRepository');
const pool = require('../../src/db/pool');
const { createClient, createYoutubeChannel, closePool } = require('../helpers/db');

const { startServer, stopServer, createLoginableClient, createAgent } = require('../helpers/http');
const queueService = require('../../src/services/queueService');

let baseUrl;
test.before(async () => {
  baseUrl = await startServer();
});
test.after(async () => {
  await stopServer();
  // Mandar processar enfileira de verdade, e o pg-boss abre conexões próprias:
  // sem encerrá-lo o processo do teste fica vivo depois de todos passarem.
  await queueService.stopBoss();
  await closePool();
});

test('video mais longo que o limite e barrado; mais curto passa', () => {
  assert.equal(passaDoLimite(30 * 60, 20), true);
  assert.equal(passaDoLimite(10 * 60, 20), false);
});

test('video EXATAMENTE no limite passa', () => {
  // "Não processar acima de 20 minutos" quer dizer que 20 ainda serve - é
  // assim que a frase é lida, e o contrário obrigaria a explicar a regra.
  assert.equal(passaDoLimite(20 * 60, 20), false);
  assert.equal(passaDoLimite(20 * 60 + 1, 20), true);
});

test('sem limite configurado, nada e barrado', () => {
  assert.equal(passaDoLimite(5 * 60 * 60, null), false);
  assert.equal(passaDoLimite(5 * 60 * 60, 0), false);
  assert.equal(passaDoLimite(5 * 60 * 60, undefined), false);
});

test('duracao desconhecida NAO e barrada', () => {
  // A listagem do canal às vezes vem sem duração. Barrar por falta de
  // informação faria o canal parar de trazer vídeo por um motivo que o cliente
  // não configurou - errar aqui é para o lado de processar.
  assert.equal(passaDoLimite(null, 20), false);
  assert.equal(passaDoLimite(undefined, 20), false);
  assert.equal(passaDoLimite(0, 20), false);
  assert.equal(passaDoLimite('nao e numero', 20), false);
});

test('o limite digitado e normalizado, e valor sem sentido vira "sem limite"', () => {
  assert.equal(normalizarLimite('45'), 45);
  assert.equal(normalizarLimite(45.7), 45, 'minuto quebrado nao faz sentido na tela');
  assert.equal(normalizarLimite(''), null);
  assert.equal(normalizarLimite(null), null);
  assert.equal(normalizarLimite(0), null);
  assert.equal(normalizarLimite(-10), null);
  assert.equal(normalizarLimite('abc'), null);
  assert.equal(normalizarLimite(999999), MAX_MINUTOS, 'teto pra nao virar uma conta estranha na tela');
});

test('o video barrado FICA na lista como detectado, com o motivo gravado', async () => {
  // Descartar faria o canal simplesmente parar de trazer vídeo, sem nada em
  // tela explicando - o mesmo problema que o selo de "somente membros"
  // resolveu.
  const cliente = await createClient();
  const canal = await createYoutubeChannel(cliente.id);

  const criado = await sourceVideosRepository.createIfNotExists({
    youtubeChannelId: canal.id,
    ownerClientUserId: cliente.id,
    youtubeVideoId: `vid_lim_${process.pid}_${Date.now()}`,
    title: 'Live de 3 horas',
    thumbnailUrl: null,
    publishedAt: new Date(),
    durationSeconds: 3 * 60 * 60,
    autoSkippedReason: 'duracao',
  });

  assert.equal(criado.status, 'detected', 'ele PODE ser processado - foi escolha do cliente, nao impossibilidade');
  assert.equal(criado.auto_skipped_reason, 'duracao');
});

test('mandar processar apaga o motivo', async () => {
  // O aviso explica por que ele NÃO entrou. A partir do momento em que entrou,
  // deixá-lo na tela faria o cliente achar que o pedido foi ignorado.
  const cliente = await createClient();
  const canal = await createYoutubeChannel(cliente.id);
  const criado = await sourceVideosRepository.createIfNotExists({
    youtubeChannelId: canal.id,
    ownerClientUserId: cliente.id,
    youtubeVideoId: `vid_lim2_${process.pid}_${Date.now()}`,
    title: 'Live longa',
    thumbnailUrl: null,
    publishedAt: new Date(),
    durationSeconds: 7200,
    autoSkippedReason: 'duracao',
  });

  await sourceVideosRepository.clearAutoSkippedReason(criado.id);

  const depois = await sourceVideosRepository.findById(criado.id);
  assert.equal(depois.auto_skipped_reason, null);
});

test('a contagem por canal alimenta o aviso do cartao', async () => {
  const cliente = await createClient();
  const canal = await createYoutubeChannel(cliente.id);
  const outro = await createYoutubeChannel(cliente.id);

  for (let i = 0; i < 2; i++) {
    await sourceVideosRepository.createIfNotExists({
      youtubeChannelId: canal.id,
      ownerClientUserId: cliente.id,
      youtubeVideoId: `vid_c_${process.pid}_${i}_${Date.now()}`,
      title: `Longo ${i}`,
      thumbnailUrl: null,
      publishedAt: new Date(),
      durationSeconds: 9000,
      autoSkippedReason: 'duracao',
    });
  }
  // Um vídeo normal do mesmo canal não pode contar.
  await sourceVideosRepository.createIfNotExists({
    youtubeChannelId: canal.id,
    ownerClientUserId: cliente.id,
    youtubeVideoId: `vid_ok_${process.pid}_${Date.now()}`,
    title: 'Normal',
    thumbnailUrl: null,
    publishedAt: new Date(),
    durationSeconds: 300,
  });

  const contagem = await sourceVideosRepository.countAutoSkippedByChannelIds([canal.id, outro.id]);
  assert.equal(contagem.get(Number(canal.id)), 2);
  assert.equal(contagem.get(Number(outro.id)), undefined, 'canal sem video barrado nem aparece');
});

test('o limite e gravado e apagado no canal, sempre conferindo o dono', async () => {
  const dono = await createClient();
  const intruso = await createClient();
  const canal = await createYoutubeChannel(dono.id);

  const comLimite = await youtubeChannelsRepository.setMaxVideoMinutes(canal.id, dono.id, 20);
  assert.equal(comLimite.max_video_minutes, 20);

  assert.equal(
    await youtubeChannelsRepository.setMaxVideoMinutes(canal.id, intruso.id, 999),
    null,
    'canal de outro cliente nunca e alterado'
  );
  assert.equal((await youtubeChannelsRepository.findById(canal.id)).max_video_minutes, 20);

  const semLimite = await youtubeChannelsRepository.setMaxVideoMinutes(canal.id, dono.id, null);
  assert.equal(semLimite.max_video_minutes, null);
});

test('o banco recusa limite zero ou negativo', async () => {
  const cliente = await createClient();
  const canal = await createYoutubeChannel(cliente.id);
  await assert.rejects(
    () => pool.query('UPDATE youtube_channels SET max_video_minutes = 0 WHERE id = $1', [canal.id]),
    /max_video_minutes/
  );
});

// --- A regra agindo dentro da checagem do canal, que é onde ela vale ---

const channelCheckJob = require('../../src/worker/videoJobs/channelCheckJob');
const ytDlpService = require('../../src/services/ytDlpService');

// Troca as duas consultas ao YouTube por respostas fixas: bater na rede aqui
// deixaria o teste dependente do humor da plataforma.
//
// A listagem devolve o vídeo novo E o vídeo do marco d'água. O marco PRECISA
// estar nela: quando ele some, a checagem não processa nada e só reancora - é
// a proteção contra a rajada de 14 vídeos de 01/09/2026. Sem o marco na lista,
// estes testes estariam medindo aquela proteção, não o limite de duração.
async function comCanalDevolvendo(video, fn) {
  const listagem = ytDlpService.listChannelVideos;
  const metadados = ytDlpService.getVideoMetadata;
  ytDlpService.listChannelVideos = async () => [video, VIDEO_DO_MARCO];
  ytDlpService.getVideoMetadata = async () => ({
    videoId: video.videoId,
    title: video.title,
    durationSeconds: video.durationSeconds,
    publishedAt: video.publishedAt,
    liveStatus: 'not_live',
    availability: 'public',
  });
  try {
    return await fn();
  } finally {
    ytDlpService.listChannelVideos = listagem;
    ytDlpService.getVideoMetadata = metadados;
  }
}

const VIDEO_DO_MARCO = {
  videoId: 'MARCO_ANTIGO',
  title: 'Vídeo que já era conhecido',
  thumbnailUrl: null,
  durationSeconds: 300,
  publishedAt: new Date(Date.now() - 7 * 86400000),
  liveStatus: 'not_live',
  availability: 'public',
};

function videoDoCanal(minutos) {
  return {
    videoId: `vid_job_${process.pid}_${Math.random().toString(36).slice(2, 10)}`,
    title: `Vídeo de ${minutos} minutos`,
    thumbnailUrl: null,
    durationSeconds: minutos * 60,
    publishedAt: new Date(),
    liveStatus: 'not_live',
    availability: 'public',
  };
}

// Canal pronto para a checagem: ativo, com marco d'água já ancorado num vídeo
// antigo, e sem freio de fila (senão a checagem devolve sem olhar vídeo).
async function canalPronto(minutosDeLimite) {
  const cliente = await createClient();
  const canal = await createYoutubeChannel(cliente.id);
  await pool.query(
    `UPDATE youtube_channels
        SET is_active = true, last_video_id = 'MARCO_ANTIGO',
            process_only_when_queue_clear = false, max_video_minutes = $2
      WHERE id = $1`,
    [canal.id, minutosDeLimite]
  );
  return { cliente, canal };
}

test('JOB: video acima do limite e cadastrado mas NAO entra na fila', async () => {
  const { cliente, canal } = await canalPronto(20);
  const video = videoDoCanal(45);
  const enfileirados = [];

  await comCanalDevolvendo(video, () =>
    channelCheckJob.run({ send: async (fila, dados) => enfileirados.push(dados) })
  );

  const criado = await sourceVideosRepository.findByYoutubeVideoIdForOwner(video.videoId, cliente.id);
  assert.ok(criado, 'o video FICA na lista - descartar faria o canal parar de trazer video sem explicacao');
  assert.equal(criado.status, 'detected');
  assert.equal(criado.auto_skipped_reason, 'duracao');
  assert.equal(
    enfileirados.some((d) => Number(d.sourceVideoId) === Number(criado.id)),
    false,
    'nao pode entrar na fila sozinho'
  );
  assert.equal(Number(criado.youtube_channel_id), Number(canal.id));
});

test('JOB: video dentro do limite entra na fila normalmente', async () => {
  const { cliente } = await canalPronto(60);
  const video = videoDoCanal(12);
  const enfileirados = [];

  await comCanalDevolvendo(video, () =>
    channelCheckJob.run({ send: async (fila, dados) => enfileirados.push(dados) })
  );

  const criado = await sourceVideosRepository.findByYoutubeVideoIdForOwner(video.videoId, cliente.id);
  assert.equal(criado.auto_skipped_reason, null);
  assert.ok(
    enfileirados.some((d) => Number(d.sourceVideoId) === Number(criado.id)),
    'video dentro do limite tem que seguir o caminho de sempre'
  );
});

test('JOB: canal SEM limite continua processando qualquer duracao', async () => {
  const { cliente } = await canalPronto(null);
  const video = videoDoCanal(180);
  const enfileirados = [];

  await comCanalDevolvendo(video, () =>
    channelCheckJob.run({ send: async (fila, dados) => enfileirados.push(dados) })
  );

  const criado = await sourceVideosRepository.findByYoutubeVideoIdForOwner(video.videoId, cliente.id);
  assert.equal(criado.auto_skipped_reason, null);
  assert.ok(enfileirados.some((d) => Number(d.sourceVideoId) === Number(criado.id)));
});

test('JOB: o marco d agua AVANCA por cima do video barrado', async () => {
  // Ao contrário da estreia e do vídeo de membros, este foi TRATADO: está
  // cadastrado, visível e com botão de processar. Segurar o marco aqui faria a
  // checagem reapresentá-lo a cada 20 minutos para sempre.
  const { canal } = await canalPronto(20);
  const video = videoDoCanal(45);

  await comCanalDevolvendo(video, () => channelCheckJob.run({ send: async () => {} }));

  const { rows } = await pool.query('SELECT last_video_id FROM youtube_channels WHERE id = $1', [canal.id]);
  assert.equal(rows[0].last_video_id, video.videoId);
});

test('HTTP: mandar processar um video barrado apaga o aviso e o coloca na fila', async () => {
  // O aviso explica por que ele NÃO entrou. A partir daqui ele entrou - deixar
  // o aviso na tela faria o cliente achar que o pedido dele foi ignorado.
  //
  // Exercita o ENDPOINT, não o repositório: a versão anterior deste teste
  // chamava clearAutoSkippedReason direto e continuava passando com a linha
  // removida do controller.
  const user = await createLoginableClient();
  const agent = createAgent(baseUrl);
  await agent.login(user.email, user.password);
  const canal = await createYoutubeChannel(user.id);

  const criado = await sourceVideosRepository.createIfNotExists({
    youtubeChannelId: canal.id,
    ownerClientUserId: user.id,
    youtubeVideoId: `vid_http_${process.pid}_${Date.now()}`,
    title: 'Live longa',
    thumbnailUrl: null,
    publishedAt: new Date(),
    durationSeconds: 9000,
    autoSkippedReason: 'duracao',
  });

  const r = await agent.post(`/api/client/source-videos/${criado.id}/enqueue`, {});

  assert.equal(r.status, 200, r.text);
  const depois = await sourceVideosRepository.findById(criado.id);
  assert.equal(depois.auto_skipped_reason, null, 'o aviso tem que sumir quando o cliente manda processar');
});

test('HTTP: o cliente configura e tira o limite pela tela do canal', async () => {
  const user = await createLoginableClient();
  const agent = createAgent(baseUrl);
  await agent.login(user.email, user.password);
  const canal = await createYoutubeChannel(user.id);

  const posto = await agent.put(`/api/client/youtube-channels/${canal.id}/max-video-minutes`, {
    maxVideoMinutes: 25,
  });
  assert.equal(posto.status, 200, posto.text);
  assert.equal(posto.body.maxVideoMinutes, 25);

  // Campo esvaziado = sem limite.
  const tirado = await agent.put(`/api/client/youtube-channels/${canal.id}/max-video-minutes`, {
    maxVideoMinutes: null,
  });
  assert.equal(tirado.body.maxVideoMinutes, null);

  // Número sem sentido não vira limite maluco: cai em "sem limite".
  const bobagem = await agent.put(`/api/client/youtube-channels/${canal.id}/max-video-minutes`, {
    maxVideoMinutes: -5,
  });
  assert.equal(bobagem.body.maxVideoMinutes, null);
});

test('HTTP: um cliente nao configura o limite do canal de outro', async () => {
  const dono = await createLoginableClient();
  const canal = await createYoutubeChannel(dono.id);
  const intruso = await createLoginableClient();
  const agent = createAgent(baseUrl);
  await agent.login(intruso.email, intruso.password);

  const r = await agent.put(`/api/client/youtube-channels/${canal.id}/max-video-minutes`, { maxVideoMinutes: 5 });
  assert.equal(r.status, 404);
});

test('HTTP: a tela do canal recebe o limite e quantos videos ficaram parados', async () => {
  const user = await createLoginableClient();
  const agent = createAgent(baseUrl);
  await agent.login(user.email, user.password);
  const canal = await createYoutubeChannel(user.id);
  await youtubeChannelsRepository.setMaxVideoMinutes(canal.id, user.id, 30);
  await sourceVideosRepository.createIfNotExists({
    youtubeChannelId: canal.id,
    ownerClientUserId: user.id,
    youtubeVideoId: `vid_tela_${process.pid}_${Date.now()}`,
    title: 'Longo',
    thumbnailUrl: null,
    publishedAt: new Date(),
    durationSeconds: 9000,
    autoSkippedReason: 'duracao',
  });

  const { body } = await agent.get('/api/client/youtube-channels');
  const naTela = body.channels.find((c) => Number(c.id) === Number(canal.id));

  assert.equal(naTela.maxVideoMinutes, 30);
  assert.equal(naTela.skippedByDurationCount, 1, 'e o aviso do cartao sai daqui');
});
