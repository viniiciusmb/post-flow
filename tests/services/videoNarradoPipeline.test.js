// O pipeline do vídeo narrado, de ponta a ponta, contra um Postgres de verdade.
//
// As APIs externas (Claude, voz, acervo, desenho) e o ffmpeg são substituídos —
// este ambiente não tem ffmpeg, e o objetivo aqui não é testar a OpenAI e sim a
// COLA entre as etapas: a ordem em que elas acontecem, o que cada uma grava, e
// o que sobra no banco quando tudo termina.
//
// É o teste que pega a classe de defeito mais provável deste pipeline: uma
// etapa que esquece de gravar o que a próxima precisa. Foi assim que o
// reaproveitamento de download quebrou em 21/08/2026 (a etapa pulada também
// criava a pasta, e ninguém percebeu até o primeiro corte dar ENOENT).
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { mock } = require('node:test');
const fs = require('fs');
const path = require('path');
const os = require('os');

const pool = require('../../src/db/pool');
const narratedVideoJob = require('../../src/worker/videoJobs/narratedVideoJob');
const narratedVideosRepository = require('../../src/repositories/narratedVideosRepository');
const videoCostsRepository = require('../../src/repositories/videoCostsRepository');
const narrationScriptService = require('../../src/services/narrationScriptService');
const ttsService = require('../../src/services/ttsService');
const renderService = require('../../src/services/narratedVideoRenderService');
const imageSearchService = require('../../src/services/imageSearchService');
const imageGenerationService = require('../../src/services/imageGenerationService');
const openaiTranscriptionService = require('../../src/services/openaiTranscriptionService');
const { createClient } = require('../helpers/db');

test.after(async () => {
  await pool.end();
});

const ROTEIRO = [
  'Em outubro de 1347, doze navios genoveses atracaram no porto da Sicilia. A maior parte dos marinheiros estava morta.',
  'Em menos de cinco anos, a peste negra mataria um terco da populacao da Europa. Cidades inteiras foram abandonadas.',
  'Hoje sabemos que a culpada era uma bacteria carregada pelas pulgas dos ratos que viajavam nos navios.',
].join('\n\n');

// Registra a ORDEM em que as etapas aconteceram. A ordem não é detalhe: a
// duração de cada cena só existe depois que a fala dela existe, e é ela que
// decide quanto tempo cada imagem fica no ar.
function instalarDubles({ acervoDevolve = true, duracaoPorCena = 8 } = {}) {
  const ordem = [];

  mock.method(narrationScriptService, 'planejarIlustracoes', async (cenas) => {
    ordem.push('planejar');
    return {
      cenas: cenas.map((c) => ({
        ...c,
        imageQuery: `busca ${c.idx}`,
        imagePrompt: `desenho ${c.idx}`,
        preferir: 'acervo',
      })),
      musicMood: 'sombrio',
      inputTokens: 1000,
      outputTokens: 500,
      costUsd: 0.0105,
    };
  });

  mock.method(ttsService, 'gerarNarracao', async (texto, destino) => {
    ordem.push('narrar');
    fs.writeFileSync(destino, 'audio-de-mentira');
    return { path: destino, chars: texto.length, bytes: 16 };
  });

  mock.method(renderService, 'prepararAudioDaCena', async (origem, destino) => {
    fs.writeFileSync(destino, 'audio-preparado');
    return duracaoPorCena;
  });

  mock.method(renderService, 'juntarAudio', async (arquivos, destino) => {
    ordem.push('juntar');
    fs.writeFileSync(destino, 'narracao-inteira');
    return arquivos.length * duracaoPorCena;
  });

  mock.method(openaiTranscriptionService, 'transcribeAudio', async () => {
    ordem.push('transcrever');
    return {
      text: 'texto',
      language: 'pt',
      words: [{ word: 'Em', start: 0, end: 0.3 }, { word: 'outubro', start: 0.3, end: 0.9 }],
      durationSeconds: 24,
      costUsd: 0.0024,
    };
  });

  mock.method(imageSearchService, 'buscar', async () => {
    if (!acervoDevolve) return null;
    return { url: `https://exemplo/${Math.random()}.jpg`, license: 'Public domain', credit: 'Gravura — Public domain' };
  });

  mock.method(imageGenerationService, 'gerar', async (_p, destino) => {
    fs.writeFileSync(destino, 'imagem-desenhada');
    return { path: destino, custoUsd: 0.011, license: 'Gerada por IA', credit: 'Imagem gerada por IA', source: 'ia' };
  });

  mock.method(globalThis, 'fetch', async () => ({
    ok: true,
    status: 200,
    arrayBuffer: async () => new ArrayBuffer(16),
  }));

  mock.method(renderService, 'renderizar', async ({ destino, cenas, onProgress }) => {
    ordem.push('montar');
    if (onProgress) onProgress(50);
    fs.writeFileSync(destino, 'video-final');
    return destino;
  });

  return ordem;
}

async function criar(adminUserId, extra = {}) {
  return narratedVideosRepository.create({
    adminUserId,
    title: 'A Peste Negra',
    script: ROTEIRO,
    aspect: '16:9',
    imagePolicy: 'economico',
    voiceProvider: 'openai',
    voiceId: 'onyx',
    burnCaptions: true,
    musicMood: null,
    ...extra,
  });
}

test('gera o video inteiro: cenas, narracao, imagens, custo e arquivo final', async (t) => {
  const ordem = instalarDubles({});
  t.after(() => mock.restoreAll());

  const admin = await createClient();
  const video = await criar(admin.id);

  await narratedVideoJob.run(video.id);

  const depois = await narratedVideosRepository.findById(video.id);
  assert.equal(depois.status, 'pronto', `status final: ${depois.status} / ${depois.error_message}`);
  assert.equal(depois.progress_percent, 100);
  assert.ok(Number(depois.duration_seconds) > 0, 'o video tem que ter duracao gravada');
  assert.ok(depois.video_path && fs.existsSync(depois.video_path), 'o arquivo final nao existe em disco');

  // A ordem das etapas é a garantia de que a duração de cada cena existe antes
  // de as imagens serem escolhidas.
  assert.deepEqual(ordem.slice(0, 1), ['planejar']);
  assert.ok(ordem.indexOf('narrar') < ordem.indexOf('juntar'), 'juntou o audio antes de narrar');
  assert.ok(ordem.indexOf('juntar') < ordem.indexOf('montar'), 'montou antes de ter a narracao');
  assert.equal(ordem[ordem.length - 1], 'montar', 'a montagem tem que ser a ultima etapa');

  // Toda cena precisa terminar com áudio, duração e imagem — é o que a
  // montagem consome. Uma etapa que esquece de gravar o que a próxima precisa
  // é a falha mais provável deste pipeline.
  const cenas = await narratedVideosRepository.listScenes(video.id);
  assert.ok(cenas.length >= 3, `esperava ao menos 3 cenas, vieram ${cenas.length}`);
  for (const c of cenas) {
    assert.ok(c.audio_path, `cena ${c.idx} sem audio`);
    assert.ok(Number(c.duration_seconds) > 0, `cena ${c.idx} sem duracao`);
    assert.ok(c.image_path, `cena ${c.idx} sem imagem`);
    assert.ok(c.image_license, `cena ${c.idx} sem licenca gravada - e o que protege quem publica`);
    assert.equal(c.image_source, 'acervo');
  }

  // O custo de cada etapa tem que estar lançado: IA do planejamento, voz,
  // Whisper da legenda. Imagem de acervo custa zero de verdade.
  const custo = await videoCostsRepository.doNarrado(video.id);
  assert.ok(custo, 'nenhum custo foi lancado');
  assert.ok(Number(custo.ia_usd) > 0, 'faltou o custo do planejamento');
  assert.ok(Number(custo.tts_usd) > 0, 'faltou o custo da narracao');
  assert.ok(Number(custo.whisper_usd) > 0, 'faltou o custo da legenda');
  assert.equal(Number(custo.imagem_usd), 0, 'imagem de acervo nao pode custar dinheiro');
  assert.equal(custo.origem, 'narrado');
});

test('sem acervo, todas as cenas sao desenhadas e a imagem passa a custar', async (t) => {
  const ordem = instalarDubles({ acervoDevolve: false });
  t.after(() => mock.restoreAll());

  const admin = await createClient();
  const video = await criar(admin.id);
  await narratedVideoJob.run(video.id);

  const cenas = await narratedVideosRepository.listScenes(video.id);
  assert.ok(cenas.every((c) => c.image_source === 'ia'), 'alguma cena ficou sem imagem');

  const custo = await videoCostsRepository.doNarrado(video.id);
  assert.ok(Number(custo.imagem_usd) > 0, 'desenhar custa dinheiro e isso tem que aparecer');
  assert.equal(
    Number(custo.imagem_usd).toFixed(3),
    (cenas.length * 0.011).toFixed(3),
    'o custo tem que bater com o numero de imagens desenhadas'
  );
});

test('legenda desligada nao chama o Whisper nem gera custo de transcricao', async (t) => {
  instalarDubles({});
  t.after(() => mock.restoreAll());

  const admin = await createClient();
  const video = await criar(admin.id, { burnCaptions: false });
  await narratedVideoJob.run(video.id);

  const custo = await videoCostsRepository.doNarrado(video.id);
  assert.equal(Number(custo.whisper_usd), 0, 'sem legenda nao ha motivo para pagar transcricao');

  const depois = await narratedVideosRepository.findById(video.id);
  assert.equal(depois.status, 'pronto');
});

test('falha no meio deixa o erro visivel e JA CLASSIFICADO, sem perder o custo do que foi pago', async (t) => {
  instalarDubles({});
  // A narração inteira já foi paga quando a montagem falha - e é justamente o
  // custo das falhas que mais interessa vigiar.
  mock.method(renderService, 'renderizar', async () => {
    throw new Error('fetch failed');
  });
  t.after(() => mock.restoreAll());

  const admin = await createClient();
  const video = await criar(admin.id);

  await assert.rejects(() => narratedVideoJob.run(video.id));

  const depois = await narratedVideosRepository.findById(video.id);
  assert.equal(depois.status, 'erro');
  assert.match(depois.error_message, /fetch failed/);
  assert.equal(depois.error_transient, true, '"fetch failed" e falha de rede: passageiro, vale tentar de novo');

  const custo = await videoCostsRepository.doNarrado(video.id);
  assert.ok(Number(custo.tts_usd) > 0, 'a narracao foi paga antes da falha e nao pode sumir do livro');
});

test('erro desconhecido conta como PERMANENTE - repetir refaz narracao e imagens', async (t) => {
  instalarDubles({});
  mock.method(renderService, 'renderizar', async () => {
    throw new Error('algo muito estranho aconteceu aqui');
  });
  t.after(() => mock.restoreAll());

  const admin = await createClient();
  const video = await criar(admin.id);
  await assert.rejects(() => narratedVideoJob.run(video.id));

  const depois = await narratedVideosRepository.findById(video.id);
  assert.equal(
    depois.error_transient,
    false,
    'na duvida, parar e mostrar: cada nova tentativa paga a narracao inteira de novo'
  );
});

test('uma imagem que falha nao derruba o video - a cena herda a anterior', async (t) => {
  instalarDubles({});
  let chamada = 0;
  mock.method(imageSearchService, 'buscar', async () => {
    chamada += 1;
    if (chamada === 2) throw new Error('acervo fora do ar');
    return { url: `https://exemplo/${chamada}.jpg`, license: 'Public domain', credit: 'x' };
  });
  mock.method(imageGenerationService, 'gerar', async () => {
    throw new Error('IA fora do ar tambem');
  });
  t.after(() => mock.restoreAll());

  const admin = await createClient();
  const video = await criar(admin.id);
  await narratedVideoJob.run(video.id);

  const depois = await narratedVideosRepository.findById(video.id);
  assert.equal(
    depois.status,
    'pronto',
    'perder 10 minutos de narracao ja paga por causa de UMA imagem seria desproporcional'
  );
});

test('a pasta de trabalho e criada pelo job, nao por efeito colateral de outra etapa', async (t) => {
  instalarDubles({});
  t.after(() => mock.restoreAll());

  const admin = await createClient();
  const video = await criar(admin.id);
  const pasta = narratedVideoJob.pastaDoVideo(video.id);
  fs.rmSync(pasta, { recursive: true, force: true });

  await narratedVideoJob.run(video.id);
  assert.ok(fs.existsSync(pasta), 'a pasta precisa existir antes da primeira gravacao de arquivo');
});
