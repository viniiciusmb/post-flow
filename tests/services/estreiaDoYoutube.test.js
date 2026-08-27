// Estreia do YouTube ("premiere") — falha real de 27/08/2026, conta
// risestyle43@gmail.com.
//
// O canal publicou uma ESTREIA marcada para ~1h depois. Pro YouTube ela já é
// um vídeo: aparece na aba /videos, tem página, tem título. A checagem de
// canal cadastrou e mandou processar na hora; o yt-dlp recusou com
// "Premieres in 58 minutes"; o vídeo virou erro PERMANENTE (a mensagem não
// batia com nenhum sinal conhecido, e desconhecido conta como permanente).
//
// O pior nem foi o erro: o marco d'água do canal avançou por cima dela. Quando
// a estreia foi ao ar de verdade, ela já estava "abaixo" do marco e ninguém
// mais olhou. O vídeo foi perdido em silêncio.
//
// O que está travado aqui:
//   1. estreia/live não é nem cadastrada — fica pra próxima checagem;
//   2. o marco d'água NÃO passa por cima do que ficou pra depois (é isso que
//      transforma "perdido" em "adiado");
//   3. se mesmo assim escapar, o erro conta como passageiro e o retry tem
//      fôlego (espera crescente) pra alcançar a hora da estreia.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const pool = require('../../src/db/pool');
const channelCheckJob = require('../../src/worker/videoJobs/channelCheckJob');
const ytDlpService = require('../../src/services/ytDlpService');
const erroDeProcessamento = require('../../src/lib/erroDeProcessamento');
const sourceVideosRepository = require('../../src/repositories/sourceVideosRepository');
const { podeBaixarAgora } = require('../../src/lib/disponibilidadeDoVideo');
const { createClient, createYoutubeChannel } = require('../helpers/db');

test.after(async () => {
  await pool.end();
});

let seq = 0;
const idDeVideo = () => `v${String(seq++).padStart(3, '0')}_${Date.now().toString(36)}`;

const bossFalso = () => {
  const enviados = [];
  return { enviados, send: async (_fila, dados) => enviados.push(dados) };
};

// Troca listagem e consulta individual por versões de mentira: bater no
// YouTube aqui deixaria o teste refém da rede e do humor da plataforma.
async function comYtDlp({ listagem, metadados }, fn) {
  const oList = ytDlpService.listChannelVideos;
  const oMeta = ytDlpService.getVideoMetadata;
  ytDlpService.listChannelVideos = listagem;
  ytDlpService.getVideoMetadata = metadados || (async () => null);
  try {
    return await fn();
  } finally {
    ytDlpService.listChannelVideos = oList;
    ytDlpService.getVideoMetadata = oMeta;
  }
}

// channelCheckJob.run() varre TODOS os canais ativos do banco, inclusive os
// que outros testes deixaram pra tras - e a listagem falsa valeria pra todos.
// Desligar os anteriores deixa cada teste sozinho com o proprio canal.
async function canalSozinho() {
  await pool.query('UPDATE youtube_channels SET is_active = false');
  const cliente = await createClient();
  const canal = await createYoutubeChannel(cliente.id);
  return { cliente, canal };
}

async function canalComMarco(marco) {
  const { cliente, canal } = await canalSozinho();
  // Sem marco d'água o canal cai no caso "primeira checagem", que só estabelece
  // o marco e nunca enfileira nada.
  await pool.query('UPDATE youtube_channels SET last_video_id = $2 WHERE id = $1', [canal.id, marco]);
  return { cliente, canal };
}

async function lerMarco(canalId) {
  const { rows } = await pool.query('SELECT last_video_id FROM youtube_channels WHERE id = $1', [canalId]);
  return rows[0].last_video_id;
}

// --- 1. O que o yt-dlp diz vs. o que dá pra baixar ---

test('só é baixável o que já virou arquivo', () => {
  assert.equal(podeBaixarAgora('is_upcoming'), false, 'estreia marcada ainda não existe como arquivo');
  assert.equal(podeBaixarAgora('is_live'), false, 'baixar uma live em andamento grava até estourar o tempo limite');
  assert.equal(podeBaixarAgora('post_live'), false, 'gravação ainda sendo processada sai truncada');
  assert.equal(podeBaixarAgora('was_live'), true, 'live que já acabou e virou gravação é vídeo normal');
  assert.equal(podeBaixarAgora('not_live'), true);
  // Vídeo comum nem traz o campo. Tratar ausente como indisponível pararia o
  // sistema inteiro se o yt-dlp renomeasse o campo.
  assert.equal(podeBaixarAgora(null), true);
  assert.equal(podeBaixarAgora(undefined), true);
});

// --- 2. Checagem de canal ---

test('estreia marcada não é cadastrada e o marco d’água NÃO passa por cima dela', async () => {
  const marco = idDeVideo();
  const estreia = idDeVideo();
  const { canal } = await canalComMarco(marco);
  const boss = bossFalso();

  await comYtDlp(
    {
      listagem: async () => [
        { videoId: estreia, title: 'ESTREIA às 15h', thumbnailUrl: null, publishedAt: null, durationSeconds: null, liveStatus: 'is_upcoming' },
        { videoId: marco, title: 'vídeo antigo', thumbnailUrl: null, publishedAt: null, durationSeconds: 600, liveStatus: null },
      ],
    },
    () => channelCheckJob.run(boss)
  );

  const { rows } = await pool.query('SELECT * FROM source_videos WHERE youtube_video_id = $1', [estreia]);
  assert.equal(rows.length, 0, 'a estreia não pode ser cadastrada: não há arquivo pra baixar');
  assert.equal(boss.enviados.length, 0, 'nada pode ir pra fila de processamento');
  assert.equal(
    await lerMarco(canal.id),
    marco,
    'se o marco avançasse, a estreia ficaria pra trás e NUNCA mais seria vista quando fosse ao ar'
  );
});

test('a estreia é pega na checagem seguinte, depois de ir ao ar', async () => {
  const marco = idDeVideo();
  const estreia = idDeVideo();
  const { canal } = await canalComMarco(marco);

  const listagem = (liveStatus) => async () => [
    { videoId: estreia, title: 'ESTREIA às 15h', thumbnailUrl: null, publishedAt: null, durationSeconds: null, liveStatus },
    { videoId: marco, title: 'vídeo antigo', thumbnailUrl: null, publishedAt: null, durationSeconds: 600, liveStatus: null },
  ];

  const primeira = bossFalso();
  await comYtDlp({ listagem: listagem('is_upcoming') }, () => channelCheckJob.run(primeira));
  assert.equal(primeira.enviados.length, 0);

  // Foi ao ar: agora é um vídeo comum.
  const segunda = bossFalso();
  await comYtDlp(
    {
      listagem: listagem(null),
      metadados: async () => ({ videoId: estreia, title: 'Título original', thumbnailUrl: null, publishedAt: new Date(), durationSeconds: 900, liveStatus: null, releaseAt: null, temFormatos: true }),
    },
    () => channelCheckJob.run(segunda)
  );

  const { rows } = await pool.query('SELECT * FROM source_videos WHERE youtube_video_id = $1', [estreia]);
  assert.equal(rows.length, 1, 'depois da estreia ir ao ar o vídeo tem que entrar normalmente');
  assert.equal(rows[0].title, 'Título original');
  assert.equal(segunda.enviados.length, 1, 'e tem que ir pra fila de processamento');
  assert.equal(await lerMarco(canal.id), estreia, 'agora sim o marco pode avançar');
});

test('estreia que a listagem não marcou ainda é pega na consulta individual', async () => {
  // A listagem do canal tira o live_status de um selo visual da página e às
  // vezes não traz nada; a consulta ao vídeo em si sempre traz.
  const marco = idDeVideo();
  const estreia = idDeVideo();
  const { canal } = await canalComMarco(marco);
  const boss = bossFalso();

  await comYtDlp(
    {
      listagem: async () => [
        { videoId: estreia, title: 'ESTREIA', thumbnailUrl: null, publishedAt: null, durationSeconds: null, liveStatus: null },
        { videoId: marco, title: 'antigo', thumbnailUrl: null, publishedAt: null, durationSeconds: 600, liveStatus: null },
      ],
      metadados: async () => ({
        videoId: estreia,
        title: 'ESTREIA',
        thumbnailUrl: null,
        publishedAt: null,
        durationSeconds: null,
        liveStatus: 'is_upcoming',
        releaseAt: new Date(Date.now() + 58 * 60 * 1000),
        temFormatos: false,
      }),
    },
    () => channelCheckJob.run(boss)
  );

  const { rows } = await pool.query('SELECT * FROM source_videos WHERE youtube_video_id = $1', [estreia]);
  assert.equal(rows.length, 0);
  assert.equal(boss.enviados.length, 0);
  assert.equal(await lerMarco(canal.id), marco);
});

test('vídeo comum continua entrando normalmente (a proteção não pode barrar todo mundo)', async () => {
  const marco = idDeVideo();
  const novo = idDeVideo();
  const { canal } = await canalComMarco(marco);
  const boss = bossFalso();

  await comYtDlp(
    {
      listagem: async () => [
        { videoId: novo, title: 'Vídeo normal', thumbnailUrl: null, publishedAt: null, durationSeconds: 700, liveStatus: null },
        { videoId: marco, title: 'antigo', thumbnailUrl: null, publishedAt: null, durationSeconds: 600, liveStatus: null },
      ],
      metadados: async () => ({ videoId: novo, title: 'Vídeo normal', thumbnailUrl: null, publishedAt: new Date(), durationSeconds: 700, liveStatus: null, releaseAt: null, temFormatos: true }),
    },
    () => channelCheckJob.run(boss)
  );

  const { rows } = await pool.query('SELECT * FROM source_videos WHERE youtube_video_id = $1', [novo]);
  assert.equal(rows.length, 1);
  assert.equal(boss.enviados.length, 1);
  assert.equal(await lerMarco(canal.id), novo);
});

test('vídeo mais novo que a estreia continua sendo processado — o adiamento segura só a estreia', async () => {
  // O caso que decide se o freio é "adiar uma coisa" ou "travar o canal".
  const marco = idDeVideo();
  const estreia = idDeVideo();
  const publicado = idDeVideo();
  const { canal } = await canalComMarco(marco);
  const boss = bossFalso();

  await comYtDlp(
    {
      listagem: async () => [
        { videoId: estreia, title: 'ESTREIA de amanhã', thumbnailUrl: null, publishedAt: null, durationSeconds: null, liveStatus: 'is_upcoming' },
        { videoId: publicado, title: 'Publicado hoje', thumbnailUrl: null, publishedAt: null, durationSeconds: 800, liveStatus: null },
        { videoId: marco, title: 'antigo', thumbnailUrl: null, publishedAt: null, durationSeconds: 600, liveStatus: null },
      ],
      metadados: async () => ({ videoId: publicado, title: 'Publicado hoje', thumbnailUrl: null, publishedAt: new Date(), durationSeconds: 800, liveStatus: null, releaseAt: null, temFormatos: true }),
    },
    () => channelCheckJob.run(boss)
  );

  const { rows } = await pool.query('SELECT youtube_video_id FROM source_videos WHERE youtube_video_id = ANY($1)', [
    [estreia, publicado],
  ]);
  assert.deepEqual(rows.map((r) => r.youtube_video_id), [publicado]);
  assert.equal(
    await lerMarco(canal.id),
    publicado,
    'o marco para no vídeo publicado — nem fica parado no antigo, nem pula a estreia'
  );
});

test('vídeo já conhecido não gasta consulta nova a cada checagem', async () => {
  // Com o marco segurado por uma estreia, os vídeos entre o marco e o topo são
  // reapresentados a cada 20 minutos. Sem esta guarda, cada um deles custaria
  // uma consulta ao yt-dlp pra sempre.
  const marco = idDeVideo();
  const conhecido = idDeVideo();
  const estreia = idDeVideo();
  const { canal } = await canalComMarco(marco);

  const listagem = async () => [
    { videoId: estreia, title: 'ESTREIA', thumbnailUrl: null, publishedAt: null, durationSeconds: null, liveStatus: 'is_upcoming' },
    { videoId: conhecido, title: 'Já processado', thumbnailUrl: null, publishedAt: null, durationSeconds: 600, liveStatus: null },
    { videoId: marco, title: 'antigo', thumbnailUrl: null, publishedAt: null, durationSeconds: 600, liveStatus: null },
  ];

  let consultas = 0;
  const metadados = async () => {
    consultas += 1;
    return { videoId: conhecido, title: 'Já processado', thumbnailUrl: null, publishedAt: new Date(), durationSeconds: 600, liveStatus: null, releaseAt: null, temFormatos: true };
  };

  await comYtDlp({ listagem, metadados }, () => channelCheckJob.run(bossFalso()));
  assert.equal(consultas, 1, 'na primeira vez o vídeo é novo e a consulta se justifica');

  await comYtDlp({ listagem, metadados }, () => channelCheckJob.run(bossFalso()));
  assert.equal(consultas, 1, 'na segunda ele já está no banco — não pode custar consulta nenhuma');
  assert.equal(await lerMarco(canal.id), conhecido);
});

// --- 3. Rede de segurança: se mesmo assim escapar ---

test('"Premieres in 58 minutes" conta como passageiro, não como erro definitivo', () => {
  // A mensagem EXATA que matou o vídeo 1960 em produção.
  const real = new Error('yt-dlp saiu com codigo 1: ERROR: [youtube] 7xzhk7Rjx9Y: Premieres in 58 minutes\n');
  assert.equal(erroDeProcessamento.ehPassageiro(real), true);
  assert.equal(
    erroDeProcessamento.ehPassageiro(new Error('This live event will begin in 7 hours.')),
    true,
    'estava na lista de PERMANENTES, que é o contrário da verdade: esse vídeo vai existir daqui a pouco'
  );
  // E o que continua permanente segue permanente.
  assert.equal(erroDeProcessamento.ehPassageiro(new Error('Private video')), false);
  assert.equal(erroDeProcessamento.ehPassageiro(new Error('Video unavailable')), false);
});

test('a espera entre tentativas cresce, pra alcançar uma estreia que só vai ao ar daqui a uma hora', async () => {
  const { cliente, canal } = await canalSozinho();

  async function videoEmErro(tentativas, minutosAtras) {
    const { rows } = await pool.query(
      `INSERT INTO source_videos (youtube_channel_id, owner_client_user_id, youtube_video_id, title, status, error_transient, auto_retry_count, updated_at)
       VALUES ($1, $2, $3, 'x', 'error', true, $4, now() - ($5 || ' minutes')::interval) RETURNING id`,
      [canal.id, cliente.id, idDeVideo(), tentativas, String(minutosAtras)]
    );
    return String(rows[0].id);
  }

  const primeira = await videoEmErro(0, 15); // 1ª tentativa: espera 10 min
  const segundaCedo = await videoEmErro(1, 20); // 2ª: espera 40 min — ainda não
  const segundaNaHora = await videoEmErro(1, 50);
  const terceiraCedo = await videoEmErro(2, 100); // 3ª: espera 160 min — ainda não
  const terceiraNaHora = await videoEmErro(2, 200);
  const esgotado = await videoEmErro(3, 999); // acabaram as tentativas

  const ids = (await sourceVideosRepository.findTransientErrorsForAutoRetry()).map((v) => String(v.id));

  assert.ok(ids.includes(primeira));
  assert.ok(!ids.includes(segundaCedo), '20 min não bastam pra 2ª tentativa — a espera cresce');
  assert.ok(ids.includes(segundaNaHora));
  assert.ok(!ids.includes(terceiraCedo));
  assert.ok(
    ids.includes(terceiraNaHora),
    'as 3 tentativas precisam se espalhar por horas: uma estreia de 1h nunca seria alcançada em 30 min'
  );
  assert.ok(!ids.includes(esgotado));
});

// --- 4. O efeito colateral da flag nova ---
//
// `--ignore-no-formats-error` é o que faz o yt-dlp devolver os dados de uma
// estreia em vez de abortar a leitura. Só que ela também ENGOLE o bloqueio do
// YouTube: "Sign in to confirm you're not a bot" passa a sair com código 0 e um
// JSON sem nenhum formato. Sem uma checagem explícita, um bloqueio viraria
// "metadado válido" — e o rodízio de proxy/túnel nem tentaria a saída seguinte,
// porque pra ele a primeira teria dado certo. Foi visto de verdade na VPS
// durante esta correção.
test('bloqueio do YouTube disfarçado de "sem formatos" NÃO passa por metadado válido', async () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ytdlp-falso-'));
  const falso = path.join(dir, 'yt-dlp');
  // Imita exatamente o que a VPS devolveu: código 0, JSON completo, formats
  // vazio e live_status nulo (nada explicando o vazio).
  fs.writeFileSync(
    falso,
    '#!/bin/sh\necho \'{"id":"abc","title":"Video bloqueado","formats":[],"live_status":null}\'\nexit 0\n'
  );
  fs.chmodSync(falso, 0o755);

  const config = require('../../src/config');
  const original = config.ytdlpPath;
  const originalPot = config.youtube.potProviderUrl;
  config.ytdlpPath = falso;
  // Sem alguma forma de autenticacao o yt-dlp nem chega a ser chamado.
  config.youtube.potProviderUrl = 'http://pot-de-teste.local';
  try {
    await assert.rejects(
      () => ytDlpService.getVideoMetadata('https://www.youtube.com/watch?v=abc'),
      /sem nenhum formato/,
      'aceitar isso em silêncio faria o sistema tratar bloqueio como vídeo pronto'
    );
  } finally {
    config.ytdlpPath = original;
    config.youtube.potProviderUrl = originalPot;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('estreia SEM formato continua sendo lida (é justamente o caso que a flag existe pra resolver)', async () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ytdlp-falso-'));
  const falso = path.join(dir, 'yt-dlp');
  fs.writeFileSync(
    falso,
    '#!/bin/sh\necho \'{"id":"abc","title":"ESTREIA","formats":[],"live_status":"is_upcoming","release_timestamp":1787873400}\'\nexit 0\n'
  );
  fs.chmodSync(falso, 0o755);

  const config = require('../../src/config');
  const original = config.ytdlpPath;
  const originalPot = config.youtube.potProviderUrl;
  config.ytdlpPath = falso;
  // Sem alguma forma de autenticacao o yt-dlp nem chega a ser chamado.
  config.youtube.potProviderUrl = 'http://pot-de-teste.local';
  try {
    const meta = await ytDlpService.getVideoMetadata('https://www.youtube.com/watch?v=abc');
    assert.equal(meta.liveStatus, 'is_upcoming');
    assert.equal(meta.temFormatos, false);
    assert.equal(meta.releaseAt.getTime(), 1787873400 * 1000, 'a hora da estreia vem do próprio YouTube');
  } finally {
    config.ytdlpPath = original;
    config.youtube.potProviderUrl = originalPot;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('canal cadastrado durante uma estreia não nasce com o marco em cima dela', async () => {
  // A primeira checagem não passa pelo loop de vídeos novos — ela só finca o
  // marco d'água no vídeo mais recente de agora. Se esse "mais recente" for uma
  // estreia, ela já nasceria vencida: quando fosse ao ar estaria abaixo do
  // marco, e o primeiro vídeo que o cliente veria seria o segundo do canal.
  await pool.query('UPDATE youtube_channels SET is_active = false');
  const cliente = await createClient();
  const canal = await createYoutubeChannel(cliente.id);
  const estreia = idDeVideo();
  const ultimoPublicado = idDeVideo();

  await comYtDlp(
    {
      listagem: async () => [
        { videoId: estreia, title: 'ESTREIA', thumbnailUrl: null, publishedAt: null, durationSeconds: null, liveStatus: 'is_upcoming' },
        { videoId: ultimoPublicado, title: 'Último publicado', thumbnailUrl: null, publishedAt: null, durationSeconds: 600, liveStatus: null },
      ],
    },
    () => channelCheckJob.run(bossFalso())
  );

  assert.equal(await lerMarco(canal.id), ultimoPublicado);
});
