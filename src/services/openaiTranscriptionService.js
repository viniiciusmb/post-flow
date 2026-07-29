// Transcricao de audio via API da OpenAI (Whisper), com timestamp por
// palavra - usado pra gerar a legenda estilo TikTok e pra IA escolher cortes.
// https://developers.openai.com/api/docs/guides/speech-to-text
'use strict';

const fs = require('fs');
const path = require('path');
const config = require('../config');

const TRANSCRIPTION_URL = 'https://api.openai.com/v1/audio/transcriptions';

async function transcribeAudio(audioFilePath, { language } = {}) {
  const fileBuffer = fs.readFileSync(audioFilePath);
  const form = new FormData();
  form.append('file', new Blob([fileBuffer]), path.basename(audioFilePath));
  form.append('model', 'whisper-1');
  form.append('response_format', 'verbose_json');
  form.append('timestamp_granularities[]', 'word');
  if (language) form.append('language', language);

  const response = await fetch(TRANSCRIPTION_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.openai.apiKey}` },
    body: form,
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(`Falha na transcricao (OpenAI): ${data.error?.message || response.statusText}`);
  }

  return {
    text: data.text,
    words: (data.words || []).map((w) => ({ word: w.word, start: w.start, end: w.end })),
  };
}

module.exports = { transcribeAudio };
