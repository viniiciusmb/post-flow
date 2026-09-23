// Vídeo "somente para membros" — falha real de 31/08/2026, canal
// "Manual do Mundo" (conta risestyle43@gmail.com).
//
// O canal publicou um vídeo exclusivo de membros. Pro sistema ele chegou como
// um vídeo qualquer (a listagem não traz live_status nenhum), foi cadastrado,
// mandado processar, e o yt-dlp recusou com "Join this channel to get access to
// members-only content". O vídeo #1965 virou ERRO permanente e o cliente leu na
// tela "Não deu pra processar este vídeo" — sobre um vídeo que não tem defeito
// nenhum: ele só ainda não é público.
//
// O dano maior foi o mesmo da estreia: o marco d'água avançou por cima dele.
// Se o canal abrisse o vídeo depois, ninguém mais olharia para ele.
//
// O que está travado aqui:
//   1. o vídeo é CADASTRADO com selo próprio, e não enfileirado (diferente da
//      estreia, que é adiada sem cadastrar — pedido explícito do fundador);
//   2. nunca vira erro, nem entra no painel de erros do admin;
//   3. o marco d'água NÃO passa por cima dele;
//   4. quando abre pro público, entra na fila sozinho;
//   5. enquanto continuar fechado, checagem nenhuma muda nada.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const pool = require('../../src/db/pool');
const channelCheckJob = require('../../src/worker/videoJobs/channelCheckJob');
const ytDlpService = require('../../src/services/ytDlpService');
const erroDeProcessamento = require('../../src/lib/erroDeProcessamento');
const sourceVideosRepository = require('../../src/repositories/sourceVideosRepository');
const { ehPublico } = require('../../src/lib/disponibilidadeDoVideo');
const { createClient, createYoutubeChannel } = require('../helpers/db');

test.after(async () => {
  await pool.end();
});

let seq = 0;
const idDeVideo = () => `m${String(seq++).padStart(3, '0')}_${Date.now().toString(36)}`;

const bossFalso = () => {
  const enviados = [];
  return { enviados, send: async (_fila, dados) => enviados.push(dados) };
};

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

// --- 1. Ler o que o yt-dlp já entrega ---

test('só é público o que não tem trava de acesso', () => {
  assert.equal(ehPublico('subscriber_only'), false, 'exclusivo de membros do canal');
  assert.equal(ehPublico('premium_only'), false, 'exclusivo do YouTube Premium');
  assert.equal(ehPublico('needs_auth'), false, 'exige login, que a nossa saída não tem');
  assert.equal(ehPublico('public'), true);
  assert.equal(ehPublico('unlisted'), true, 'não listado continua baixável por link');
  // Vídeo comum nem traz o campo. Tratar ausente como fechado pararia o sistema
  // inteiro se o yt-dlp renomeasse o campo.
  assert.equal(ehPublico(null), true);
  assert.equal(ehPublico(undefined), true);
});

// --- 2. Checagem de canal ---

test('vídeo de membros é cadastrado com selo, sem entrar na fila', async () => {
  const marco = idDeVideo();
  const fechado = idDeVideo();
  const { cliente, canal } = await canalComMarco(marco);
  const boss = bossFalso();

  await comYtDlp(
    {
      listagem: async () => [
        { videoId: fechado, title: 'Exclusivo dos membros', availability: 'subscriber_only', liveStatus: null },
        { videoId: marco, title: 'Vídeo anterior', availability: null, liveStatus: null },
      ],
    },
    () => channelCheckJob.run(boss)
  );

  const salvo = await sourceVideosRepository.findByYoutubeVideoIdForOwner(fechado, cliente.id);
  assert.ok(salvo, 'o vídeo tinha que aparecer na tela — o fundador quer ver que ele existe');
  assert.equal(salvo.status, 'somente_membros');
  assert.deepEqual(boss.enviados, [], 'não pode entrar na fila: o download vai falhar de qualquer jeito');
  assert.equal(canal.id && (await lerMarco(canal.id)), marco, 'o marco d’água passou por cima do vídeo fechado');
});

test('nem sequer consulta o vídeo quando a listagem já disse que é fechado', async () => {
  // A listagem do canal já traz `availability` (confirmado no vídeo real). A
  // consulta individual é a cara — e num vídeo fechado ela é pura perda: sai
  // pelo proxy pago, tenta todos os clients e não devolve formato nenhum.
  const marco = idDeVideo();
  const fechado = idDeVideo();
  await canalComMarco(marco);
  let consultas = 0;

  await comYtDlp(
    {
      listagem: async () => [
        { videoId: fechado, title: 'Fechado', availability: 'subscriber_only', liveStatus: null },
        { videoId: marco, title: 'Anterior', availability: null, liveStatus: null },
      ],
      metadados: async () => {
        consultas += 1;
        return null;
      },
    },
    () => channelCheckJob.run(bossFalso())
  );

  assert.equal(consultas, 0, 'gastou consulta (e banda paga) num vídeo que a listagem já explicou');
});

test('checagens seguintes não mudam nada enquanto continuar fechado', async () => {
  const marco = idDeVideo();
  const fechado = idDeVideo();
  const { cliente } = await canalComMarco(marco);
  const listagem = async () => [
    { videoId: fechado, title: 'Fechado', availability: 'subscriber_only', liveStatus: null },
    { videoId: marco, title: 'Anterior', availability: null, liveStatus: null },
  ];

  const boss = bossFalso();
  await comYtDlp({ listagem }, () => channelCheckJob.run(boss));
  await comYtDlp({ listagem }, () => channelCheckJob.run(boss));
  await comYtDlp({ listagem }, () => channelCheckJob.run(boss));

  const salvo = await sourceVideosRepository.findByYoutubeVideoIdForOwner(fechado, cliente.id);
  assert.equal(salvo.status, 'somente_membros', 'três checagens depois ele continua com o selo');
  assert.deepEqual(boss.enviados, [], 'alguma checagem enfileirou um vídeo que continua fechado');
});

test('quando abre pro público, entra na fila sozinho', async () => {
  const marco = idDeVideo();
  const video = idDeVideo();
  const { cliente } = await canalComMarco(marco);
  const boss = bossFalso();

  // 1ª volta: fechado.
  await comYtDlp(
    {
      listagem: async () => [
        { videoId: video, title: 'Exclusivo', availability: 'subscriber_only', liveStatus: null },
        { videoId: marco, title: 'Anterior', availability: null, liveStatus: null },
      ],
    },
    () => channelCheckJob.run(boss)
  );
  const fechado = await sourceVideosRepository.findByYoutubeVideoIdForOwner(video, cliente.id);
  assert.equal(fechado.status, 'somente_membros');

  // 2ª volta: o canal abriu o vídeo.
  await comYtDlp(
    {
      listagem: async () => [
        { videoId: video, title: 'Título de verdade', availability: null, liveStatus: null },
        { videoId: marco, title: 'Anterior', availability: null, liveStatus: null },
      ],
    },
    () => channelCheckJob.run(boss)
  );

  const aberto = await sourceVideosRepository.findByYoutubeVideoIdForOwner(video, cliente.id);
  assert.equal(aberto.status, 'detected', 'abriu e continuou parado com o selo');
  // O id vem do Postgres como STRING (BIGINT), e é assim que ele já é enviado
  // pra fila no resto do arquivo — comparar com número aqui daria um falso
  // negativo em cima de um comportamento certo.
  assert.deepEqual(boss.enviados, [{ sourceVideoId: aberto.id }], 'abriu e não entrou na fila');
  assert.equal(aberto.title, 'Título de verdade', 'ficou com o título antigo, de quando era fechado');
});

test('depois de abrir, o marco d’água finalmente avança', async () => {
  const marco = idDeVideo();
  const video = idDeVideo();
  const { canal } = await canalComMarco(marco);

  const fechada = async () => [
    { videoId: video, title: 'Exclusivo', availability: 'subscriber_only', liveStatus: null },
    { videoId: marco, title: 'Anterior', availability: null, liveStatus: null },
  ];
  const aberta = async () => [
    { videoId: video, title: 'Exclusivo', availability: null, liveStatus: null },
    { videoId: marco, title: 'Anterior', availability: null, liveStatus: null },
  ];

  await comYtDlp({ listagem: fechada }, () => channelCheckJob.run(bossFalso()));
  assert.equal(await lerMarco(canal.id), marco, 'o marco andou enquanto o vídeo ainda estava fechado');

  await comYtDlp({ listagem: aberta }, () => channelCheckJob.run(bossFalso()));
  assert.equal(await lerMarco(canal.id), video, 'o marco não avançou depois que o vídeo abriu');
});

test('canal novo cujo vídeo mais recente é de membros não perde esse vídeo', async () => {
  // A primeira checagem não passa pelo loop: ela só estabelece o marco. Se ele
  // nascesse em cima do vídeo fechado, o cliente nunca o veria — e o primeiro
  // vídeo dele seria o SEGUNDO do canal.
  await pool.query('UPDATE youtube_channels SET is_active = false');
  const cliente = await createClient();
  const canal = await createYoutubeChannel(cliente.id);
  const fechado = idDeVideo();
  const publico = idDeVideo();

  await comYtDlp(
    {
      listagem: async () => [
        { videoId: fechado, title: 'Exclusivo', availability: 'subscriber_only', liveStatus: null },
        { videoId: publico, title: 'Público', availability: null, liveStatus: null },
      ],
    },
    () => channelCheckJob.run(bossFalso())
  );

  assert.equal(await lerMarco(canal.id), publico, 'o marco nasceu em cima do vídeo fechado');
});

// --- 2b. "É o mais recente?" quando o vídeo abre ---
//
// Falha real de 22/09/2026, canal "Manual do Mundo": no minuto em que o
// exclusivo abriu, a listagem do YouTube veio com um vídeo ANTIGO (processado
// em 17/09, antes do exclusivo existir) na frente dele. O exclusivo foi marcado
// como "o canal pegou um mais novo" e ficou parado com a fila vazia.

// Um cenário com um vídeo antigo já processado (cadastrado há 5 dias) e um
// exclusivo cadastrado depois dele (há 4 dias), ainda fechado.
async function exclusivoDepoisDeUmAntigo({ maxVideoMinutes = null, duracaoDoExclusivo = 600 } = {}) {
  const antigo = idDeVideo();
  const exclusivo = idDeVideo();
  const { cliente, canal } = await canalComMarco(antigo);
  if (maxVideoMinutes) {
    await pool.query('UPDATE youtube_channels SET max_video_minutes = $2 WHERE id = $1', [canal.id, maxVideoMinutes]);
  }

  const jaProcessado = await sourceVideosRepository.createIfNotExists({
    youtubeChannelId: canal.id,
    ownerClientUserId: cliente.id,
    youtubeVideoId: antigo,
    title: 'Antigo',
  });
  await pool.query(`UPDATE source_videos SET status = 'ready', created_at = now() - interval '5 days' WHERE id = $1`, [
    jaProcessado.id,
  ]);

  await comYtDlp(
    {
      listagem: async () => [
        {
          videoId: exclusivo,
          title: 'Exclusivo',
          availability: 'subscriber_only',
          liveStatus: null,
          durationSeconds: duracaoDoExclusivo,
        },
        { videoId: antigo, title: 'Antigo', availability: null, liveStatus: null },
      ],
    },
    () => channelCheckJob.run(bossFalso())
  );
  const fechado = await sourceVideosRepository.findByYoutubeVideoIdForOwner(exclusivo, cliente.id);
  assert.equal(fechado.status, 'somente_membros');
  await pool.query(`UPDATE source_videos SET created_at = now() - interval '4 days' WHERE id = $1`, [fechado.id]);

  return { cliente, canal, antigo, exclusivo, duracaoDoExclusivo };
}

test('abre com a listagem fora de ordem (antigo na frente) e mesmo assim entra na fila', async () => {
  const { cliente, antigo, exclusivo } = await exclusivoDepoisDeUmAntigo();
  const boss = bossFalso();

  // Exatamente a listagem de 22/09 20:00: o antigo, já processado, na frente.
  await comYtDlp(
    {
      listagem: async () => [
        { videoId: antigo, title: 'Antigo', availability: null, liveStatus: null },
        { videoId: exclusivo, title: 'Exclusivo aberto', availability: null, liveStatus: null },
      ],
    },
    () => channelCheckJob.run(boss)
  );

  const aberto = await sourceVideosRepository.findByYoutubeVideoIdForOwner(exclusivo, cliente.id);
  assert.equal(aberto.auto_skipped_reason, null, 'ficou marcado como "o canal pegou um mais novo" sem ter pego nada');
  assert.deepEqual(boss.enviados, [{ sourceVideoId: aberto.id }], 'abriu, era o mais recente e ficou parado');
});

test('abre, mas o canal já publicou um vídeo público mais novo: entra o mais novo', async () => {
  const { cliente, antigo, exclusivo } = await exclusivoDepoisDeUmAntigo();
  const novo = idDeVideo();
  const boss = bossFalso();

  await comYtDlp(
    {
      listagem: async () => [
        { videoId: novo, title: 'Novo', availability: null, liveStatus: null },
        { videoId: exclusivo, title: 'Exclusivo aberto', availability: null, liveStatus: null },
        { videoId: antigo, title: 'Antigo', availability: null, liveStatus: null },
      ],
    },
    () => channelCheckJob.run(boss)
  );

  const aberto = await sourceVideosRepository.findByYoutubeVideoIdForOwner(exclusivo, cliente.id);
  const doNovo = await sourceVideosRepository.findByYoutubeVideoIdForOwner(novo, cliente.id);
  assert.equal(aberto.auto_skipped_reason, 'mais_recente', 'o exclusivo, já velho, entrou na frente do novo');
  assert.deepEqual(boss.enviados, [{ sourceVideoId: doNovo.id }], 'era pra entrar só o vídeo novo');
});

test('abre, mas um vídeo mais novo já foi cadastrado depois dele: não entra', async () => {
  const { cliente, canal, exclusivo } = await exclusivoDepoisDeUmAntigo();
  const novo = idDeVideo();
  await sourceVideosRepository.createIfNotExists({
    youtubeChannelId: canal.id,
    ownerClientUserId: cliente.id,
    youtubeVideoId: novo,
    title: 'Novo, já processado',
  });
  await pool.query(`UPDATE source_videos SET status = 'ready' WHERE youtube_video_id = $1`, [novo]);
  const boss = bossFalso();

  // Mesmo com a listagem pondo o novo ATRÁS do exclusivo, o histórico manda.
  await comYtDlp(
    {
      listagem: async () => [
        { videoId: novo, title: 'Novo', availability: null, liveStatus: null },
        { videoId: exclusivo, title: 'Exclusivo aberto', availability: null, liveStatus: null },
      ],
    },
    () => channelCheckJob.run(boss)
  );

  const aberto = await sourceVideosRepository.findByYoutubeVideoIdForOwner(exclusivo, cliente.id);
  assert.equal(aberto.auto_skipped_reason, 'mais_recente');
  assert.deepEqual(boss.enviados, [], 'o canal já tinha seguido em frente');
});

test('abre acima do limite de duração do canal: fica parado pelo limite, não entra', async () => {
  const { cliente, antigo, exclusivo } = await exclusivoDepoisDeUmAntigo({
    maxVideoMinutes: 30,
    duracaoDoExclusivo: 45 * 60,
  });
  const boss = bossFalso();

  await comYtDlp(
    {
      listagem: async () => [
        { videoId: exclusivo, title: 'Longo', availability: null, liveStatus: null, durationSeconds: 45 * 60 },
        { videoId: antigo, title: 'Antigo', availability: null, liveStatus: null },
      ],
    },
    () => channelCheckJob.run(boss)
  );

  const aberto = await sourceVideosRepository.findByYoutubeVideoIdForOwner(exclusivo, cliente.id);
  assert.equal(aberto.auto_skipped_reason, 'duracao');
  assert.deepEqual(boss.enviados, [], 'vídeo acima do limite do canal entrou na fila');
});

// --- 3. Classificação do erro (rede de segurança) ---

test('a mensagem real do YouTube é reconhecida como "só para membros"', () => {
  // Copiada literalmente do system_errors de produção (vídeo #1965).
  const real =
    'yt-dlp saiu com codigo 1: ERROR: [youtube] QQodK3SMsFA: Join this channel to get access to ' +
    'members-only content like this video, and other exclusive perks.';
  assert.equal(erroDeProcessamento.ehSoParaMembros(new Error(real)), true);
});

test('vídeo de membros não conta como erro permanente', () => {
  // Até 01/09/2026 'members-only' morava na lista de PERMANENTES: o vídeo virava
  // erro definitivo e o cliente lia "Não deu pra processar este vídeo".
  const err = new Error('ERROR: Join this channel to get access to members-only content like this video.');
  assert.equal(erroDeProcessamento.ehSoParaMembros(err), true, 'precisa ser reconhecido pelo caminho próprio');
});

test('erro comum continua sendo erro', () => {
  assert.equal(erroDeProcessamento.ehSoParaMembros(new Error('Private video')), false);
  assert.equal(erroDeProcessamento.ehSoParaMembros(new Error('HTTP Error 429')), false);
  assert.equal(erroDeProcessamento.ehSoParaMembros(null), false);
});
