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

module.exports = {
  whisperCostUsd,
  claudeCostUsd,
  WHISPER_USD_PER_MINUTE,
  CLAUDE_SONNET_USD_PER_MTOK_INPUT,
  CLAUDE_SONNET_USD_PER_MTOK_OUTPUT,
};
