// Idioma do título e da legenda do corte.
//
// O prompt nunca dizia em que idioma escrever. A IA recebia uma transcrição em
// português e devolvia título em inglês — o corte certo, com o texto na língua
// errada, e o criador tendo que reescrever tudo à mão.
//
// O que estes testes travam: a instrução de idioma existe, é explícita, e
// sobrevive à retomada de um vídeo pausado (que é quando ela se perderia, já
// que a transcrição vem do banco e a etapa de transcrever não roda de novo).
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const pool = require('../../src/db/pool');
const claude = require('../../src/services/claudeClipSelectionService');
const sourceVideosRepository = require('../../src/repositories/sourceVideosRepository');
const { createClient, createSourceVideo } = require('../helpers/db');

test.after(async () => {
  await pool.end();
});

const PALAVRAS = [
  { word: 'olá', start: 0, end: 0.5 },
  { word: 'pessoal', start: 0.5, end: 1.2 },
  { word: 'tudo', start: 1.2, end: 1.6 },
  { word: 'bem', start: 1.6, end: 2.0 },
];

// Intercepta a chamada à Anthropic e devolve o prompt que teria sido enviado.
async function promptEnviado(opcoes) {
  const fetchOriginal = global.fetch;
  let capturado = null;
  global.fetch = async (url, init) => {
    capturado = JSON.parse(init.body);
    return {
      ok: true,
      json: async () => ({
        content: [{ type: 'tool_use', name: 'select_clips', input: { clips: [] } }],
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    };
  };
  try {
    await claude.selectClips(PALAVRAS, opcoes);
  } finally {
    global.fetch = fetchOriginal;
  }
  return capturado;
}

test('vídeo em português: a IA é mandada escrever em português', async () => {
  const corpo = await promptEnviado({ language: 'pt' });
  const prompt = corpo.messages[0].content;

  assert.match(prompt, /falado em português/);
  assert.match(prompt, /Escreva o titulo e a legenda em português/);
  assert.match(prompt, /Nao traduza/);
});

test('inglês e espanhol também são nomeados por extenso', async () => {
  // O nome escrito por extenso é uma instrução bem mais firme que o código
  // "pt"/"en" solto no meio do texto.
  assert.match((await promptEnviado({ language: 'en' })).messages[0].content, /falado em inglês/);
  assert.match((await promptEnviado({ language: 'es' })).messages[0].content, /falado em espanhol/);
});

test('o código do Whisper com região ainda é reconhecido', async () => {
  // O Whisper pode devolver "pt-BR" em vez de "pt".
  const prompt = (await promptEnviado({ language: 'pt-BR' })).messages[0].content;
  assert.match(prompt, /falado em português/);
});

test('sem idioma detectado, manda seguir a transcrição — nunca traduzir', async () => {
  // É o caso dos vídeos transcritos antes desta mudança: o idioma não foi
  // guardado, mas a transcrição está no próprio prompt.
  const prompt = (await promptEnviado({ language: null })).messages[0].content;
  assert.match(prompt, /MESMO IDIOMA da transcricao/);
  assert.match(prompt, /Nao traduza/);
});

test('idioma desconhecido não inventa nome de língua', async () => {
  const prompt = (await promptEnviado({ language: 'xx' })).messages[0].content;
  assert.match(prompt, /MESMO IDIOMA da transcricao/);
});

test('a descrição dos campos também exige o idioma do vídeo', async () => {
  // O modelo lê a descrição de cada campo da ferramenta, não só o prompt.
  // Reforçar nos dois lugares é o que faz a instrução pegar de verdade.
  const corpo = await promptEnviado({ language: 'pt' });
  const campos = corpo.tools[0].input_schema.properties.clips.items.properties;
  assert.match(campos.title.description, /MESMO IDIOMA/);
  assert.match(campos.description.description, /MESMO IDIOMA/);
});

test('o idioma é guardado no banco e sobrevive à retomada', async () => {
  const cliente = await createClient();
  const video = await createSourceVideo(cliente.id);

  await sourceVideosRepository.saveTranscript(video.id, {
    transcriptText: 'olá pessoal tudo bem',
    transcriptWords: PALAVRAS,
    whisperAudioSeconds: 2,
    whisperCostUsd: 0.01,
    language: 'pt',
  });

  // Retomar um vídeo pausado NÃO roda a transcrição de novo: o pipeline lê
  // tudo do banco. Se o idioma vivesse só na memória, ele se perderia
  // justamente aqui, e o corte voltaria a sair em inglês.
  const depois = await sourceVideosRepository.findById(video.id);
  assert.equal(depois.transcript_language, 'pt');
});
