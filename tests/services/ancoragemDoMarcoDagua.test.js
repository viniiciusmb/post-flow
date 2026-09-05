// Canal recém-cadastrado tem que ancorar o marco d'água NA HORA.
//
// Falha real de 04/09/2026, canal "Davy Jones GTA 6" (conta risestyle43):
// o canal publicou um vídeo novo e o sistema não puxou. Nenhum erro em lugar
// nenhum — o canal simplesmente parou de trazer vídeo.
//
// A sequência:
//   04/09 01:00  canal cadastrado, last_video_id NULL
//   04/09 01:00  o pop-up processou o vídeo mais recente -> 15 cortes na fila
//   04/09 ...    freio de engarrafamento LIGADO (fila cheia), a cada 20 min,
//                por mais de um dia — e o freio devolvia o marco como NULL
//   (no meio disso o canal publicou um vídeo novo)
//   05/09        a fila esvaziou; a ancoragem finalmente rodou e fixou o marco
//                NO VÍDEO NOVO, engolindo ele sem nunca cadastrar
//
// A causa é a ORDEM: a ancoragem inicial estava DEPOIS do freio. Ancorar não
// custa nada (a listagem já está em mãos, não há download nem IA), então o
// freio — que existe para não PEGAR vídeo novo — não tinha motivo para segurá-la.
//
// É a mesma família da estreia, do vídeo de membros e da rajada de 14: o marco
// d'água avançando por cima de um vídeo que nunca foi tratado.
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
const idDeVideo = () => `a${String(seq++).padStart(3, '0')}_${Date.now().toString(36)}`;

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

// Canal SEM marco d'água — o estado de quem acabou de ser cadastrado.
async function canalNovo({ comFreio = false } = {}) {
  await pool.query('UPDATE youtube_channels SET is_active = false');
  const cliente = await createClient();
  const canal = await createYoutubeChannel(cliente.id);
  await pool.query(
    'UPDATE youtube_channels SET last_video_id = NULL, process_only_when_queue_clear = $2 WHERE id = $1',
    [canal.id, comFreio]
  );
  return { cliente, canal };
}

async function lerMarco(canalId) {
  const { rows } = await pool.query('SELECT last_video_id FROM youtube_channels WHERE id = $1', [canalId]);
  return rows[0].last_video_id;
}

const publico = (id, title = 'v') => ({ videoId: id, title, availability: null, liveStatus: null });

// --- O caso que custou o vídeo ---

test('o freio de engarrafamento NÃO adia a ancoragem do marco d’água', async () => {
  // Com o freio ligado e a fila cheia, o canal ficava em "primeira checagem"
  // indefinidamente — e ancorava tarde, em cima de um vídeo publicado no meio
  // do caminho.
  const primeiro = idDeVideo();
  const { canal } = await canalNovo({ comFreio: true });

  // Freio LIGADO: canal com conta do TikTok e fila cheia. Sem conta vinculada
  // o freio nunca segura (não há fila para engarrafar), então o teste precisa
  // de uma conta e de postagens pendentes de verdade.
  const { rows: [dono] } = await pool.query('SELECT client_user_id FROM youtube_channels WHERE id = $1', [canal.id]);
  const { rows: [conta] } = await pool.query(
    `INSERT INTO tiktok_accounts (client_user_id, tiktok_open_id, display_name, is_active,
       access_token_encrypted, access_token_iv, refresh_token_encrypted, refresh_token_iv,
       scopes, token_expires_at, connected_at)
     VALUES ($1, $2, 'Conta', true, 'x','x','x','x',
       ARRAY['video.publish'], now() + interval '30 days', now()) RETURNING *`,
    [dono.client_user_id, `open_${canal.id}_${Date.now()}`]
  );
  await pool.query('UPDATE youtube_channels SET tiktok_account_id = $2 WHERE id = $1', [canal.id, conta.id]);

  // Fila cheia de verdade: várias postagens pendentes na conta desse canal.
  //
  // A cadeia é a real do produto: vídeo-fonte -> corte -> arquivo -> postagem.
  // A contagem do freio só olha conta + status, mas as chaves estrangeiras e o
  // CHECK de consistência de `videos` exigem a cadeia inteira.
  const fonte = await sourceVideosRepository.createIfNotExists({
    youtubeChannelId: canal.id,
    ownerClientUserId: dono.client_user_id,
    youtubeVideoId: idDeVideo(),
    title: 'ja processado',
    thumbnailUrl: null,
    publishedAt: null,
    durationSeconds: 60,
  });
  for (let i = 0; i < 5; i += 1) {
    const { rows: [corte] } = await pool.query(
      `INSERT INTO clips (source_video_id, title, start_seconds, end_seconds, status)
       VALUES ($1, 'corte', 0, 30, 'ready') RETURNING id`,
      [fonte.id]
    );
    const { rows: [arquivo] } = await pool.query(
      `INSERT INTO videos (filename, discovered_at, source_type, clip_id)
       VALUES ('corte.mp4', now(), 'youtube_clip', $1) RETURNING id`,
      [corte.id]
    );
    await pool.query(
      `INSERT INTO postings (video_id, tiktok_account_id, status, queued_at)
       VALUES ($1, $2, 'pending', now())`,
      [arquivo.id, conta.id]
    );
  }

  await comListagem(async () => [publico(primeiro, 'o mais recente de agora')], () => channelCheckJob.run(bossFalso()));

  assert.equal(
    await lerMarco(canal.id),
    primeiro,
    'o freio segurou a ancoragem — é isso que deixa o canal em "primeira checagem" por horas e engole o vídeo seguinte'
  );
});

test('depois de ancorar, o vídeo publicado em seguida É pego', async () => {
  // A prova de que a ancoragem não engole o vídeo novo: ela fixa no que existe
  // AGORA, e o que vier depois é novidade de verdade.
  const primeiro = idDeVideo();
  const { cliente, canal } = await canalNovo();
  const boss = bossFalso();

  await comListagem(async () => [publico(primeiro)], () => channelCheckJob.run(boss));
  assert.equal(await lerMarco(canal.id), primeiro);
  assert.deepEqual(boss.enviados, [], 'canal recém-cadastrado não processa histórico');

  const novo = idDeVideo();
  await comListagem(async () => [publico(novo, 'video novo'), publico(primeiro)], () => channelCheckJob.run(boss));

  const salvo = await sourceVideosRepository.findByYoutubeVideoIdForOwner(novo, cliente.id);
  assert.ok(salvo, 'o vídeo publicado depois da ancoragem tinha que ser cadastrado');
  assert.equal(boss.enviados.length, 1, 'e tinha que entrar na fila');
  assert.equal(await lerMarco(canal.id), novo);
});

test('a ancoragem não processa nada do histórico', async () => {
  // O canal pode ter 15 vídeos antigos. Nenhum deles é novidade.
  const videos = Array.from({ length: 15 }, () => publico(idDeVideo()));
  const { cliente, canal } = await canalNovo();
  const boss = bossFalso();

  await comListagem(async () => videos, () => channelCheckJob.run(boss));

  assert.deepEqual(boss.enviados, [], `enfileirou ${boss.enviados.length} vídeos antigos`);
  for (const v of videos) {
    assert.equal(
      await sourceVideosRepository.findByYoutubeVideoIdForOwner(v.videoId, cliente.id),
      null,
      `o vídeo ${v.videoId} foi cadastrado sem ser novidade`
    );
  }
  assert.equal(await lerMarco(canal.id), videos[0].videoId, 'o marco tem que ficar no mais recente');
});

// --- A âncora não pode ser um vídeo que ainda não é nosso ---

test('estreia não vira âncora', async () => {
  // Se o marco nascesse em cima da estreia, ela se perderia quando fosse ao ar:
  // já estaria "abaixo" do marco e ninguém mais olharia.
  const estreia = idDeVideo();
  const publicado = idDeVideo();
  const { canal } = await canalNovo();

  await comListagem(
    async () => [
      { videoId: estreia, title: 'estreia', availability: null, liveStatus: 'is_upcoming' },
      publico(publicado),
    ],
    () => channelCheckJob.run(bossFalso())
  );

  assert.equal(await lerMarco(canal.id), publicado, 'o marco ancorou na estreia e ela se perderia ao ir ao ar');
});

test('vídeo exclusivo de membros não vira âncora', async () => {
  const membros = idDeVideo();
  const publicado = idDeVideo();
  const { canal } = await canalNovo();

  await comListagem(
    async () => [
      { videoId: membros, title: 'so membros', availability: 'subscriber_only', liveStatus: null },
      publico(publicado),
    ],
    () => channelCheckJob.run(bossFalso())
  );

  assert.equal(await lerMarco(canal.id), publicado);
});

test('sem nenhum vídeo disponível, o marco fica nulo e tenta de novo depois', async () => {
  // Canal em que TUDO no topo é estreia/membros. Ancorar em qualquer um deles
  // seria perdê-lo; o certo é não ancorar e tentar na próxima checagem.
  const { canal } = await canalNovo();

  await comListagem(
    async () => [
      { videoId: idDeVideo(), title: 'estreia', availability: null, liveStatus: 'is_upcoming' },
      { videoId: idDeVideo(), title: 'membros', availability: 'subscriber_only', liveStatus: null },
    ],
    () => channelCheckJob.run(bossFalso())
  );

  assert.equal(await lerMarco(canal.id), null, 'ancorar num vídeo indisponível o perderia para sempre');
});

// ---------------------------------------------------------------------------
// A outra metade: ancorar já no CADASTRO do canal
// ---------------------------------------------------------------------------
//
// Ancorar na primeira checagem periódica ainda deixa uma janela: entre o
// cadastro e a checagem (até 20 minutos, ou horas se algo a atrasar) o canal
// pode publicar, e esse vídeo é engolido pela ancoragem.
//
// O cadastro já busca o vídeo mais recente para o pop-up "quer processar esse
// já?" — o id está em mãos, então ancorar ali fecha a janela de vez: qualquer
// coisa publicada depois daquele instante é novidade de verdade.

const { startServer, stopServer, createLoginableClient, createAgent } = require('../helpers/http');
const youtubeChannelService = require('../../src/services/youtubeChannelService');
const subscriptionPlansRepository = require('../../src/repositories/subscriptionPlansRepository');
const clientSubscriptionsRepository = require('../../src/repositories/clientSubscriptionsRepository');

async function cadastrarCanal({ maisRecente }) {
  const url = await startServer();
  const user = await createLoginableClient();
  const agent = createAgent(url);
  await agent.login(user.email, user.password);

  // Sem plano ativo o cadastro é barrado antes de chegar na ancoragem.
  const planos = await subscriptionPlansRepository.listActive();
  await clientSubscriptionsRepository.setPlan(user.id, planos[planos.length - 1].id);

  const oResolve = youtubeChannelService.resolveChannel;
  const oList = ytDlpService.listChannelVideos;
  const oMeta = ytDlpService.getVideoMetadata;
  youtubeChannelService.resolveChannel = async () => ({
    channelId: `UC_${Date.now()}_${seq++}`,
    channelName: 'Canal de teste',
    channelUrl: 'https://youtube.com/@teste',
    avatarUrl: null,
  });
  ytDlpService.listChannelVideos = async () => [maisRecente];
  ytDlpService.getVideoMetadata = async () => null;
  try {
    const r = await agent.post('/api/client/youtube-channels', { channelUrl: 'https://youtube.com/@teste' });
    assert.equal(r.status, 201, `o cadastro tinha que dar certo: ${JSON.stringify(r.body)}`);
    return r.body.channel.id;
  } finally {
    youtubeChannelService.resolveChannel = oResolve;
    ytDlpService.listChannelVideos = oList;
    ytDlpService.getVideoMetadata = oMeta;
  }
}

test('cadastrar o canal já ancora o marco d’água', async () => {
  const maisRecente = publico(idDeVideo(), 'o mais recente na hora do cadastro');
  const canalId = await cadastrarCanal({ maisRecente });

  assert.equal(
    await lerMarco(canalId),
    maisRecente.videoId,
    'o canal nasceu sem marco — o vídeo publicado antes da primeira checagem seria engolido'
  );
});

test('cadastro com estreia no topo NÃO ancora nela', async () => {
  // Ancorar na estreia a perderia quando ela fosse ao ar. Melhor nascer sem
  // marco: a checagem periódica ancora depois, já com essa mesma regra.
  const canalId = await cadastrarCanal({
    maisRecente: { videoId: idDeVideo(), title: 'estreia', availability: null, liveStatus: 'is_upcoming' },
  });

  assert.equal(await lerMarco(canalId), null);
});

test.after(async () => {
  await stopServer();
});
