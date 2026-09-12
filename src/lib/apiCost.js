// Precos das APIs externas usadas no pipeline de video - conferir
// periodicamente contra a tabela de precos oficial (OpenAI/Anthropic podem
// mudar sem aviso previo).
'use strict';

const WHISPER_USD_PER_MINUTE = 0.006;
const CLAUDE_SONNET_USD_PER_MTOK_INPUT = 3;
const CLAUDE_SONNET_USD_PER_MTOK_OUTPUT = 15;

function whisperCostUsd(audioSeconds) {
  if (!audioSeconds) return 0;
  return (audioSeconds / 60) * WHISPER_USD_PER_MINUTE;
}

function claudeCostUsd(inputTokens, outputTokens) {
  const input = (inputTokens || 0) / 1_000_000;
  const output = (outputTokens || 0) / 1_000_000;
  return input * CLAUDE_SONNET_USD_PER_MTOK_INPUT + output * CLAUDE_SONNET_USD_PER_MTOK_OUTPUT;
}

// ---------------------------------------------------------------------------
// Video narrado (gerado a partir de um roteiro).
// ---------------------------------------------------------------------------

// A OpenAI cobra o TTS por token de audio de SAIDA, nao por caractere de
// entrada - por isso o preco e modelado por minuto de audio gerado, que e o
// que a gente sabe medir com exatidao depois (ffprobe no arquivo). ~US$ 0,015
// por minuto de audio.
const OPENAI_TTS_USD_PER_AUDIO_MINUTE = 0.015;

// A ElevenLabs cobra por CARACTERE ENVIADO, independente da duracao do audio
// que sair - modelo de preco diferente, por isso as duas contas nao podem
// compartilhar formula. Flash/Turbo: US$ 0,05 por mil caracteres.
const ELEVENLABS_USD_PER_1K_CHARS = 0.05;

// gpt-image-1-mini em qualidade utilizavel para video 1080p. A faixa oficial
// vai de US$ 0,005 (baixa) a US$ 0,052 (alta); este e o meio, que e o que o
// pipeline pede. E o item que MAIS pesa quando o modo "qualidade" esta ligado:
// 10 imagens por minuto de video a este preco custam mais que a narracao.
const IMAGEM_IA_USD_POR_IMAGEM = 0.011;

function ttsCostUsd(provider, { chars = 0, audioSeconds = 0 } = {}) {
  if (provider === 'elevenlabs') {
    return (chars / 1000) * ELEVENLABS_USD_PER_1K_CHARS;
  }
  return (audioSeconds / 60) * OPENAI_TTS_USD_PER_AUDIO_MINUTE;
}

function imagemIaCostUsd(quantidade = 0) {
  return (quantidade || 0) * IMAGEM_IA_USD_POR_IMAGEM;
}

module.exports = {
  whisperCostUsd,
  claudeCostUsd,
  ttsCostUsd,
  imagemIaCostUsd,
  WHISPER_USD_PER_MINUTE,
  CLAUDE_SONNET_USD_PER_MTOK_INPUT,
  CLAUDE_SONNET_USD_PER_MTOK_OUTPUT,
  OPENAI_TTS_USD_PER_AUDIO_MINUTE,
  ELEVENLABS_USD_PER_1K_CHARS,
  IMAGEM_IA_USD_POR_IMAGEM,
};
