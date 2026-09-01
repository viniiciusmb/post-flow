// Cortar em português um canal gringo dublado (01/09/2026).
//
// O caso concreto: "MrBeast Gaming" é falado em inglês, mas o YouTube entrega
// o MESMO vídeo com 13 trilhas de áudio dubladas — inclusive português.
// Verificado com yt-dlp num vídeo real do canal antes de escrever isto:
//   ar bn en es hi id it pl pt ru th tr vi
//
// Escolher a trilha certa no DOWNLOAD resolve o pipeline inteiro, porque o
// Whisper transcreve o áudio que recebeu e o Claude já escreve título e legenda
// no idioma da transcrição. Não há tradutor em lugar nenhum.
//
// O risco que estes testes existem para travar não é a escolha em si — é o
// CACHE. shared_video_assets guardava "o arquivo deste vídeo do YouTube", com a
// premissa de que o mesmo vídeo dá sempre o mesmo arquivo. Com trilhas
// dubladas essa premissa acabou: sem o idioma na identidade, quem pediu
// português receberia o arquivo em inglês que outro cliente baixou antes — e
// nada, em lugar nenhum, daria erro.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const config = require('../../src/config');
const pool = require('../../src/db/pool');
const processVideoJob = require('../../src/worker/videoJobs/processVideoJob');
const sourceVideosRepository = require('../../src/repositories/sourceVideosRepository');
const sharedVideoAssetsRepository = require('../../src/repositories/sharedVideoAssetsRepository');
const clientVideoSettingsRepository = require('../../src/repositories/clientVideoSettingsRepository');
const sharedVideoFiles = require('../../src/lib/sharedVideoFiles');
const idiomaDoAudio = require('../../src/lib/idiomaDoAudio');
const ytDlpService = require('../../src/services/ytDlpService');
const videoEditingService = require('../../src/services/videoEditingService');
const openaiTranscriptionService = require('../../src/services/openaiTranscriptionService');
const claudeClipSelectionService = require('../../src/services/claudeClipSelectionService');
const { createClient, createYoutubeChannel, giveCredits } = require('../helpers/db');

const workDirOriginal = config.videoProcessing.workDir;
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'postflow-idioma-'));
config.videoProcessing.workDir = workDir;

test.after(async () => {
  config.videoProcessing.workDir = workDirOriginal;
  fs.rmSync(workDir, { recursive: true, force: true });
  await pool.end();
});

// ---------------------------------------------------------------------------
// O seletor de formato do yt-dlp
// ---------------------------------------------------------------------------

test('pedir um idioma vira um filtro de trilha, com o original como alternativa', () => {
  const seletor = idiomaDoAudio.seletorDeFormato('pt', 480);
  assert.match(seletor, /bestaudio\[language\^=pt\]/, 'não pediu a trilha em português');
  assert.match(
    seletor,
    /\/bestvideo\[height<=480\]\+bestaudio\/best\[height<=480\]$/,
    'sem a alternativa no fim, um vídeo sem a trilha pedida viraria ERRO em vez de cair no original'
  );
});

test('"original" não filtra trilha nenhuma', () => {
  // É o comportamento de sempre. Um filtro aqui mudaria o resultado de todo
  // cliente que nunca escolheu nada.
  assert.equal(
    idiomaDoAudio.seletorDeFormato('original', 480),
    'bestvideo[height<=480]+bestaudio/best[height<=480]'
  );
  assert.equal(idiomaDoAudio.seletorDeFormato(null, 480), idiomaDoAudio.seletorDeFormato('original', 480));
});

test('vídeo de uma trilha só conta como "original"', () => {
  // O yt-dlp imprime "NA" quando o formato de áudio não declara idioma, que é
  // o caso da maioria dos canais. Tratar isso como um idioma qualquer criaria
  // duas chaves para o mesmo arquivo e quebraria o reaproveitamento em quase
  // todo canal do sistema.
  assert.equal(idiomaDoAudio.normalizar('NA'), 'original');
  assert.equal(idiomaDoAudio.normalizar(''), 'original');
  assert.equal(idiomaDoAudio.normalizar(undefined), 'original');
});

test('código regional cai na raiz', () => {
  // pt-BR e pt são a mesma dublagem para o que o sistema faz com ela; separá-las
  // faria o mesmo áudio ser baixado duas vezes.
  assert.equal(idiomaDoAudio.normalizar('pt-BR'), 'pt');
  assert.equal(idiomaDoAudio.normalizar('en-US'), 'en');
});

test('o yt-dlp devolve qual trilha ele realmente escolheu', () => {
  // Sem essa resposta, o arquivo em inglês seria guardado como se fosse a
  // versão em português, e o próximo cliente que pedisse português receberia
  // inglês em silêncio.
  assert.equal(ytDlpService.lerIdiomaDaSaida('[youtube] x\nPOSTFLOW_IDIOMA_AUDIO=pt\n[download] 100%'), 'pt');
  assert.equal(ytDlpService.lerIdiomaDaSaida('POSTFLOW_IDIOMA_AUDIO=NA'), 'original');
  assert.equal(ytDlpService.lerIdiomaDaSaida('saída sem o marcador'), 'original');
});

// ---------------------------------------------------------------------------
// O arquivo compartilhado
// ---------------------------------------------------------------------------

test('o mesmo vídeo em idiomas diferentes são dois arquivos', () => {
  const pt = sharedVideoFiles.pathFor('abc123', '.mp4', 'pt');
  const en = sharedVideoFiles.pathFor('abc123', '.mp4', 'en');
  assert.notEqual(pt, en, 'os dois idiomas iam parar no MESMO arquivo — o segundo download sobrescreveria o primeiro');
});

test('"original" continua sem sufixo, para não perder o que já está em disco', () => {
  assert.equal(sharedVideoFiles.pathFor('abc123', '.mp4', 'original'), sharedVideoFiles.pathFor('abc123', '.mp4'));
});

test('duas trilhas do mesmo vídeo convivem no banco', async () => {
  const video = `vid_idioma_${Date.now()}`;
  await sharedVideoAssetsRepository.saveDownload(video, { localVideoPath: '/tmp/a.mp4', audioLanguage: 'pt' });
  await sharedVideoAssetsRepository.saveDownload(video, { localVideoPath: '/tmp/b.mp4', audioLanguage: 'en' });

  const pt = await sharedVideoAssetsRepository.findByYoutubeVideoId(video, 'pt');
  const en = await sharedVideoAssetsRepository.findByYoutubeVideoId(video, 'en');
  assert.equal(pt.local_video_path, '/tmp/a.mp4');
  assert.equal(en.local_video_path, '/tmp/b.mp4', 'o segundo idioma sobrescreveu a linha do primeiro');
});

test('a transcrição também é por idioma', async () => {
  const video = `vid_transc_${Date.now()}`;
  await sharedVideoAssetsRepository.saveTranscript(video, {
    transcriptText: 'hello world',
    transcriptWords: [{ word: 'hello', start: 0, end: 1 }],
    language: 'en',
    audioLanguage: 'en',
  });
  await sharedVideoAssetsRepository.saveTranscript(video, {
    transcriptText: 'ola mundo',
    transcriptWords: [{ word: 'ola', start: 0, end: 1 }],
    language: 'pt',
    audioLanguage: 'pt',
  });

  const pt = await sharedVideoAssetsRepository.findByYoutubeVideoId(video, 'pt');
  assert.equal(pt.transcript_text, 'ola mundo', 'a transcrição em português veio com o texto em inglês');
});

test('apagar o arquivo de um idioma não desfaz o registro do outro', async () => {
  // Sem o idioma no clearFile, a linha do arquivo em disco perderia a
  // referência, ele viraria órfão e seria varrido uma hora depois — no meio de
  // um processamento que ainda ia usá-lo.
  const video = `vid_clear_${Date.now()}`;
  await sharedVideoAssetsRepository.saveDownload(video, { localVideoPath: '/tmp/pt.mp4', audioLanguage: 'pt' });
  await sharedVideoAssetsRepository.saveDownload(video, { localVideoPath: '/tmp/en.mp4', audioLanguage: 'en' });

  await sharedVideoAssetsRepository.clearFile(video, 'pt');

  assert.equal((await sharedVideoAssetsRepository.findByYoutubeVideoId(video, 'pt')).local_video_path, null);
  assert.equal(
    (await sharedVideoAssetsRepository.findByYoutubeVideoId(video, 'en')).local_video_path,
    '/tmp/en.mp4',
    'limpar um idioma levou o outro junto'
  );
});

// ---------------------------------------------------------------------------
// O pipeline inteiro
// ---------------------------------------------------------------------------

const PALAVRAS_PT = [{ word: 'ola', start: 0, end: 0.5 }, { word: 'mundo', start: 0.5, end: 1.2 }];

// Um YouTube de mentira que se comporta como o de verdade: tem as trilhas que
// `trilhas` disser, e cai no original quando pedem uma que não existe.
function comYoutubeFalso(trilhas, fn) {
  const originais = {
    downloadVideo: ytDlpService.downloadVideo,
    extractAudio: videoEditingService.extractAudio,
    renderClip: videoEditingService.renderClip,
    extractThumbnail: videoEditingService.extractThumbnail,
    transcribeAudio: openaiTranscriptionService.transcribeAudio,
    selectClips: claudeClipSelectionService.selectClips,
  };
  const chamadas = { download: 0, whisper: 0, pedidos: [], idiomasDoWhisper: [] };

  ytDlpService.downloadVideo = async (videoId, outputDir, { audioLanguage } = {}) => {
    chamadas.download += 1;
    chamadas.pedidos.push(audioLanguage);
    fs.mkdirSync(outputDir, { recursive: true });
    const filePath = path.join(outputDir, `${videoId}.mp4`);
    fs.writeFileSync(filePath, Buffer.alloc(2048, 3));
    // A regra de verdade do yt-dlp: a trilha pedida se ela existir, senão a
    // primeira da lista (o original).
    const escolhida = trilhas.includes(audioLanguage) ? audioLanguage : trilhas[0];
    return { filePath, egressType: 'founder_tunnel', tunnelId: null, audioLanguage: escolhida };
  };
  videoEditingService.extractAudio = async (_v, audioPath) => fs.writeFileSync(audioPath, 'audio');
  openaiTranscriptionService.transcribeAudio = async (_p, { language } = {}) => {
    chamadas.whisper += 1;
    chamadas.idiomasDoWhisper.push(language ?? null);
    return { text: 'ola mundo', words: PALAVRAS_PT, durationSeconds: 60, costUsd: 0.01, language: language || 'en' };
  };
  claudeClipSelectionService.selectClips = async () => ({
    clips: [{ title: 'Corte', description: 'd', startSeconds: 0, endSeconds: 30 }],
    inputTokens: 1, outputTokens: 1, costUsd: 0.001,
  });
  videoEditingService.renderClip = async ({ videoPath, outputPath }) => {
    assert.ok(fs.existsSync(videoPath), `renderClip recebeu um caminho que não existe: ${videoPath}`);
    fs.writeFileSync(outputPath, 'corte');
  };
  videoEditingService.extractThumbnail = async (_o, thumbPath) => fs.writeFileSync(thumbPath, 'capa');

  return fn(chamadas).finally(() => {
    Object.assign(ytDlpService, { downloadVideo: originais.downloadVideo });
    Object.assign(videoEditingService, {
      extractAudio: originais.extractAudio,
      renderClip: originais.renderClip,
      extractThumbnail: originais.extractThumbnail,
    });
    Object.assign(openaiTranscriptionService, { transcribeAudio: originais.transcribeAudio });
    Object.assign(claudeClipSelectionService, { selectClips: originais.selectClips });
  });
}

let contador = 0;
async function videoDeCanal(clienteId, canalId, youtubeVideoId) {
  contador += 1;
  const { rows } = await pool.query(
    `INSERT INTO source_videos
       (youtube_channel_id, owner_client_user_id, youtube_video_id, title, status, input_type, duration_seconds)
     VALUES ($1, $2, $3, $4, 'detected', 'channel', 60) RETURNING *`,
    [canalId, clienteId, youtubeVideoId, `Video ${contador}`]
  );
  return rows[0];
}

async function clienteQuerendo(idioma, youtubeChannelId) {
  const cliente = await createClient();
  await giveCredits(cliente.id, { quotaNormal: 5000 });
  const canal = await createYoutubeChannel(cliente.id, { channelId: youtubeChannelId });
  await clientVideoSettingsRepository.upsert(cliente.id, {
    clipLength: 'balanced', clipMode: 'ai_choice', maxClips: 1,
    showTitle: false, titleSeconds: 3, descriptionMode: 'auto',
    cropStyleMode: 'auto', cropZoomPercent: 100, showPartLabel: false,
    partLabelPosition: 'top_right', titleStyle: 'classic', captionStyle: 'classic',
    audioLanguage: idioma,
  });
  return { cliente, canal };
}

test('cliente que pede português baixa a trilha em português', async () => {
  const canal = `UC_mrbeast_${Date.now()}`;
  const video = `vid_mb_${Date.now()}`;
  const { cliente, canal: c } = await clienteQuerendo('pt', canal);
  const sv = await videoDeCanal(cliente.id, c.id, video);

  await comYoutubeFalso(['en', 'pt', 'es'], async (chamadas) => {
    await processVideoJob.run(sv.id);
    assert.deepEqual(chamadas.pedidos, ['pt'], 'o pedido de português não chegou no yt-dlp');
    assert.deepEqual(chamadas.idiomasDoWhisper, ['pt'], 'o Whisper não recebeu a dica de idioma da trilha baixada');
  });

  const depois = await sourceVideosRepository.findById(sv.id);
  assert.equal(depois.status, 'ready');
  assert.equal(depois.audio_language, 'pt');
});

test('dois clientes, dois idiomas: cada um baixa e transcreve o SEU', async () => {
  // É o coração do problema. Sem o idioma na identidade do cache, o segundo
  // cliente receberia o arquivo (e a transcrição) do primeiro.
  const canal = `UC_dublado_${Date.now()}`;
  const video = `vid_dub_${Date.now()}`;
  const emIngles = await clienteQuerendo('original', canal);
  const emPortugues = await clienteQuerendo('pt', canal);

  const svEn = await videoDeCanal(emIngles.cliente.id, emIngles.canal.id, video);
  const svPt = await videoDeCanal(emPortugues.cliente.id, emPortugues.canal.id, video);

  await comYoutubeFalso(['en', 'pt'], async (chamadas) => {
    await processVideoJob.run(svEn.id);
    await processVideoJob.run(svPt.id);

    assert.equal(chamadas.download, 2, 'trilhas diferentes são arquivos diferentes — não dá para reaproveitar');
    assert.equal(chamadas.whisper, 2, 'áudios diferentes são transcrições diferentes');
  });

  const en = await sourceVideosRepository.findById(svEn.id);
  const pt = await sourceVideosRepository.findById(svPt.id);
  assert.equal(en.audio_language, 'en');
  assert.equal(pt.audio_language, 'pt');
  assert.notEqual(en.local_video_path, pt.local_video_path, 'os dois idiomas apontaram para o MESMO arquivo');
});

test('dois clientes no MESMO idioma continuam compartilhando tudo', async () => {
  // A economia que já existia não pode ter sido perdida no caminho.
  const canal = `UC_mesmo_${Date.now()}`;
  const video = `vid_mesmo_${Date.now()}`;
  const a = await clienteQuerendo('pt', canal);
  const b = await clienteQuerendo('pt', canal);
  const svA = await videoDeCanal(a.cliente.id, a.canal.id, video);
  const svB = await videoDeCanal(b.cliente.id, b.canal.id, video);

  await comYoutubeFalso(['en', 'pt'], async (chamadas) => {
    await processVideoJob.run(svA.id);
    await processVideoJob.run(svB.id);
    assert.equal(chamadas.download, 1, 'o segundo cliente baixou de novo o mesmo idioma');
    assert.equal(chamadas.whisper, 1, 'o segundo cliente pagou o Whisper de novo pelo mesmo áudio');
  });

  assert.equal((await sourceVideosRepository.findById(svB.id)).download_egress_type, 'reuse');
});

test('pedir um idioma que o vídeo não tem cai no original, sem falhar', async () => {
  const canal = `UC_sodub_${Date.now()}`;
  const video = `vid_sodub_${Date.now()}`;
  const { cliente, canal: c } = await clienteQuerendo('pt', canal);
  const sv = await videoDeCanal(cliente.id, c.id, video);

  // Canal brasileiro comum: uma trilha só, que o yt-dlp reporta sem idioma.
  await comYoutubeFalso(['original'], async () => {
    await processVideoJob.run(sv.id);
  });

  const depois = await sourceVideosRepository.findById(sv.id);
  assert.equal(depois.status, 'ready', 'pedir um idioma inexistente não pode virar erro');
  assert.equal(depois.audio_language, 'original');
  assert.equal(depois.requested_audio_language, 'pt', 'o pedido tinha que ficar gravado ao lado do resultado');
});

test('pedido que caiu no original ainda reaproveita o download', async () => {
  // O caso mais comum de todos: alguém marca "português" num canal que já é em
  // português. O cache é indexado pelo idioma REAL ('original'), e a consulta
  // chega com 'pt' — sem a memória da tradução, o vídeo seria baixado de novo
  // para cada cliente, para sempre.
  const canal = `UC_fallback_${Date.now()}`;
  const video = `vid_fallback_${Date.now()}`;
  const a = await clienteQuerendo('pt', canal);
  const b = await clienteQuerendo('pt', canal);
  const svA = await videoDeCanal(a.cliente.id, a.canal.id, video);
  const svB = await videoDeCanal(b.cliente.id, b.canal.id, video);

  await comYoutubeFalso(['original'], async (chamadas) => {
    await processVideoJob.run(svA.id);
    await processVideoJob.run(svB.id);
    assert.equal(chamadas.download, 1, 'o segundo cliente baixou de novo o mesmo arquivo');
    assert.equal(chamadas.whisper, 1, 'o segundo cliente pagou o Whisper de novo');
  });

  assert.equal((await sourceVideosRepository.findById(svB.id)).download_egress_type, 'reuse');
});

test('sem escolher nada, tudo se comporta como antes', async () => {
  const canal = `UC_padrao_${Date.now()}`;
  const video = `vid_padrao_${Date.now()}`;
  const cliente = await createClient();
  await giveCredits(cliente.id, { quotaNormal: 5000 });
  const c = await createYoutubeChannel(cliente.id, { channelId: canal });
  const sv = await videoDeCanal(cliente.id, c.id, video);

  await comYoutubeFalso(['original'], async (chamadas) => {
    await processVideoJob.run(sv.id);
    assert.deepEqual(chamadas.pedidos, ['original'], 'cliente que nunca configurou nada não pode pedir trilha nenhuma');
    assert.deepEqual(chamadas.idiomasDoWhisper, [null], 'sem trilha declarada não há dica a dar ao Whisper');
  });

  const depois = await sourceVideosRepository.findById(sv.id);
  assert.equal(depois.status, 'ready');
  assert.ok(sharedVideoFiles.isShared(depois.local_video_path));
});

// ---------------------------------------------------------------------------
// A armadilha do --print
// ---------------------------------------------------------------------------

test('pedir o idioma de volta NÃO transforma o download numa simulação', async () => {
  // No yt-dlp, `--print` implica `--simulate`. Sozinho, ele imprime o idioma
  // certinho, sai com código 0 e não grava arquivo nenhum — e TODO vídeo do
  // sistema passaria a morrer em "Download concluído mas o arquivo esperado
  // não foi encontrado em disco", sem nenhuma pista do motivo.
  //
  // Foi visto de verdade na VPS antes deste código ser implantado, com o
  // yt-dlp real. Este teste é a rede que impede a flag de sumir depois.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ytdlp-falso-'));
  const falso = path.join(dir, 'yt-dlp');
  const argsPath = path.join(dir, 'args.txt');
  const saida = path.join(dir, 'saida');

  // Um yt-dlp de mentira que anota os argumentos e só cria o arquivo se lhe
  // mandarem baixar de verdade — igual ao de verdade.
  fs.writeFileSync(
    falso,
    `#!/bin/sh\nprintf '%s\\n' "$@" > ${argsPath}\n` +
      `echo "POSTFLOW_IDIOMA_AUDIO=pt"\n` +
      `for a in "$@"; do if [ "$a" = "--no-simulate" ]; then mkdir -p ${saida}; : > ${saida}/vid1.mp4; fi; done\nexit 0\n`
  );
  fs.chmodSync(falso, 0o755);

  const originalPath = config.ytdlpPath;
  const originalPot = config.youtube.potProviderUrl;
  const esperaMin = config.youtube.downloadWaitMinMs;
  const esperaMax = config.youtube.downloadWaitMaxMs;
  config.ytdlpPath = falso;
  config.youtube.potProviderUrl = 'http://pot-de-teste.local';
  // O download de verdade espera 10-40s de propósito (disfarce anti-bloqueio).
  // Aqui não há YouTube nenhum para despistar.
  config.youtube.downloadWaitMinMs = 0;
  config.youtube.downloadWaitMaxMs = 0;
  try {
    const r = await ytDlpService.downloadVideo('vid1', saida, { audioLanguage: 'pt' });
    assert.ok(fs.existsSync(r.filePath), 'o arquivo não foi baixado — o --print virou simulação');
    assert.equal(r.audioLanguage, 'pt');

    const args = fs.readFileSync(argsPath, 'utf8').split('\n');
    assert.ok(args.includes('--print'), 'guarda de sanidade: o teste precisa do --print para valer alguma coisa');
    assert.ok(args.includes('--no-simulate'), 'sem --no-simulate o yt-dlp não baixa nada');
  } finally {
    config.ytdlpPath = originalPath;
    config.youtube.potProviderUrl = originalPot;
    config.youtube.downloadWaitMinMs = esperaMin;
    config.youtube.downloadWaitMaxMs = esperaMax;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
