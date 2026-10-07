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

// Transcricao principal desde 07/10/2026: whisper-large-v3-turbo na DeepInfra.
// O cadastro do modelo diz "cents_per_input_sec: 0.000333" - US$ 0,0002 por
// minuto, 30x menos que o whisper-1 da OpenAI. Conferido no painel de consumo
// da propria DeepInfra: 14.255 s de audio custaram 5 centavos de dolar.
const DEEPINFRA_WHISPER_USD_PER_MINUTE = 0.0002;
// Groq (reserva): o Post Flow usa o plano GRATUITO dela, entao o custo real e
// zero. Se um dia virar o plano pago, o preco e US$ 0,04/h = 0,000667/min.
const GROQ_WHISPER_USD_PER_MINUTE = 0;

function transcricaoCostUsd(provedor, audioSeconds) {
  if (!audioSeconds) return 0;
  if (provedor === 'deepinfra') return (audioSeconds / 60) * DEEPINFRA_WHISPER_USD_PER_MINUTE;
  if (provedor === 'groq') return (audioSeconds / 60) * GROQ_WHISPER_USD_PER_MINUTE;
  return whisperCostUsd(audioSeconds);
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

// ---------------------------------------------------------------------------
// Cortes de lives (Twitch). Precos conferidos na tabela oficial da OpenAI em
// 28/09/2026 (developers.openai.com/api/docs/pricing).
// ---------------------------------------------------------------------------

// gpt-4o-mini-transcribe: metade do Whisper. Nao da tempo por palavra, por
// isso so e usado na transcricao corrida da live; a legenda do corte
// escolhido continua no whisper-1 (openaiTranscriptionService).
const MINI_TRANSCRIBE_USD_PER_MINUTE = 0.003;

// gpt-5-nano, o modelo de texto mais barato da tabela. Com reasoning_effort
// 'minimal' ele nao gasta token de raciocinio (medido: 0), entao a saida e so
// o JSON pedido.
const GPT5_NANO_USD_PER_MTOK_INPUT = 0.05;
const GPT5_NANO_USD_PER_MTOK_OUTPUT = 0.4;

// gpt-5-mini: o "juiz" que da a nota final aos momentos, o ajuste fino do
// corte e a deteccao da camera. Entrou depois do primeiro teste real, em que o
// nano sozinho escolheu momentos fracos. 5x o preco do nano, mas e usado em
// poucas chamadas por hora (centavos).
const GPT5_MINI_USD_PER_MTOK_INPUT = 0.25;
const GPT5_MINI_USD_PER_MTOK_OUTPUT = 2.0;

// Entrada repetida (o mesmo comeco de prompt em chamadas seguidas) a OpenAI
// cobra a 10% - conferido na tabela em 04/10/2026 (mini 0,025 / nano 0,005).
const FRACAO_ENTRADA_EM_CACHE = 0.1;
// Flex ("service_tier": "flex"): preco do Batch, metade do normal, em troca de
// resposta mais lenta e de um 429 ocasional (que nao e cobrado).
const FRACAO_FLEX = 0.5;

// gpt-4o-mini-transcribe e cobrado por TOKEN, nao por minuto: US$ 1,25 por
// milhao de tokens de audio e US$ 5 por milhao de texto devolvido. Medido em
// 04/10/2026 com a resposta da propria API: ~US$ 0,0014 por minuto real - a
// conta antiga (0,003/min, a "estimativa" da tabela) mostrava mais que o
// dobro do que de fato se paga.
const MINI_TRANSCRIBE_USD_PER_MTOK_AUDIO = 1.25;
const MINI_TRANSCRIBE_USD_PER_MTOK_OUTPUT = 5.0;

function miniTranscribeCostFromUsage(usage, audioSeconds) {
  if (usage && usage.type === 'tokens' && Number.isFinite(usage.input_tokens)) {
    return ((usage.input_tokens || 0) / 1_000_000) * MINI_TRANSCRIBE_USD_PER_MTOK_AUDIO
      + ((usage.output_tokens || 0) / 1_000_000) * MINI_TRANSCRIBE_USD_PER_MTOK_OUTPUT;
  }
  return miniTranscribeCostUsd(audioSeconds);
}

// Custo de uma chamada de texto pelo que a resposta diz: tokens em cache saem
// a 10%, e Flex sai pela metade.
function textoCostFromUsage({ precoEntrada, precoSaida, entrada = 0, emCache = 0, saida = 0, flex = false }) {
  const normal = Math.max(0, entrada - emCache);
  const usd = (normal / 1_000_000) * precoEntrada
    + (emCache / 1_000_000) * precoEntrada * FRACAO_ENTRADA_EM_CACHE
    + (saida / 1_000_000) * precoSaida;
  return flex ? usd * FRACAO_FLEX : usd;
}

function gpt5MiniCostUsd(inputTokens, outputTokens) {
  return ((inputTokens || 0) / 1_000_000) * GPT5_MINI_USD_PER_MTOK_INPUT
    + ((outputTokens || 0) / 1_000_000) * GPT5_MINI_USD_PER_MTOK_OUTPUT;
}

function miniTranscribeCostUsd(audioSeconds) {
  if (!audioSeconds) return 0;
  return (audioSeconds / 60) * MINI_TRANSCRIBE_USD_PER_MINUTE;
}

function gpt5NanoCostUsd(inputTokens, outputTokens) {
  return ((inputTokens || 0) / 1_000_000) * GPT5_NANO_USD_PER_MTOK_INPUT
    + ((outputTokens || 0) / 1_000_000) * GPT5_NANO_USD_PER_MTOK_OUTPUT;
}

module.exports = {
  whisperCostUsd,
  transcricaoCostUsd,
  DEEPINFRA_WHISPER_USD_PER_MINUTE,
  GROQ_WHISPER_USD_PER_MINUTE,
  miniTranscribeCostFromUsage,
  textoCostFromUsage,
  FRACAO_FLEX,
  FRACAO_ENTRADA_EM_CACHE,
  miniTranscribeCostUsd,
  gpt5NanoCostUsd,
  gpt5MiniCostUsd,
  GPT5_MINI_USD_PER_MTOK_INPUT,
  GPT5_MINI_USD_PER_MTOK_OUTPUT,
  MINI_TRANSCRIBE_USD_PER_MINUTE,
  GPT5_NANO_USD_PER_MTOK_INPUT,
  GPT5_NANO_USD_PER_MTOK_OUTPUT,
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
