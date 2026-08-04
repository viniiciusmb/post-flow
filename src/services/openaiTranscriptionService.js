// Transcricao de audio via API da OpenAI (Whisper), com timestamp por
// palavra - usado pra gerar a legenda estilo TikTok e pra IA escolher cortes.
// https://developers.openai.com/api/docs/guides/speech-to-text
'use strict';

const fs = require('fs');
const path = require('path');
const config = require('../config');
const { whisperCostUsd } = require('../lib/apiCost');
const { PausedError } = require('../lib/errors');

const TRANSCRIPTION_URL = 'https://api.openai.com/v1/audio/transcriptions';

async function transcribeAudio(audioFilePath, { language, checkCancelled } = {}) {
  const fileBuffer = fs.readFileSync(audioFilePath);
  const form = new FormData();
  form.append('file', new Blob([fileBuffer]), path.basename(audioFilePath));
  form.append('model', 'whisper-1');
  form.append('response_format', 'verbose_json');
  form.append('timestamp_granularities[]', 'word');
  if (language) form.append('language', language);

  // Confere pausa a cada 2s enquanto espera a OpenAI responder - sem isso,
  // pausar so tinha efeito depois que a transcricao inteira terminasse.
  const controller = new AbortController();
  let cancelled = false;
  const cancelPoll = checkCancelled
    ? setInterval(async () => {
        if (await checkCancelled()) {
          cancelled = true;
          controller.abort();
        }
      }, 2000)
    : null;

  let response;
  try {
    response = await fetch(TRANSCRIPTION_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.openai.apiKey}` },
      body: form,
      signal: controller.signal,
    });
  } catch (err) {
    if (cancelled) throw new PausedError('Transcrição interrompida pelo cliente.');
    throw err;
  } finally {
    if (cancelPoll) clearInterval(cancelPoll);
  }

  const data = await response.json();
  if (!response.ok) {
    throw new Error(`Falha na transcricao (OpenAI): ${data.error?.message || response.statusText}`);
  }

  return {
    text: data.text,
    // O Whisper detecta o idioma e devolve o codigo ISO ('pt', 'en', 'es'...).
    // E o que impede a IA de escrever titulo em ingles pra video em portugues.
    language: data.language || null,
    words: (data.words || []).map((w) => ({ word: w.word, start: w.start, end: w.end })),
    durationSeconds: data.duration || 0,
    costUsd: whisperCostUsd(data.duration),
  };
}

module.exports = { transcribeAudio };
