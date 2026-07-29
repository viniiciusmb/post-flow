// A IA (Claude) le a transcricao com timestamps e decide os melhores
// trechos pra virar corte vertical - devolve titulo + inicio/fim de cada um.
'use strict';

const config = require('../config');
const { claudeCostUsd } = require('../lib/apiCost');

const MESSAGES_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-sonnet-5';

function formatTimestamp(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// Agrupa as palavras em blocos de alguns segundos, com o timestamp na
// frente - da pro Claude ler o "roteiro" do video sem mandar um JSON gigante
// palavra por palavra (o corte fino por palavra so importa pra legenda).
function formatTranscriptForPrompt(words, windowSeconds = 8) {
  if (!words || words.length === 0) return '';
  const lines = [];
  let windowStart = words[0].start;
  let buffer = [];

  for (const word of words) {
    if (word.start - windowStart >= windowSeconds && buffer.length > 0) {
      lines.push(`[${formatTimestamp(windowStart)}] ${buffer.join(' ')}`);
      buffer = [];
      windowStart = word.start;
    }
    buffer.push(word.word.trim());
  }
  if (buffer.length > 0) {
    lines.push(`[${formatTimestamp(windowStart)}] ${buffer.join(' ')}`);
  }
  return lines.join('\n');
}

const SELECT_CLIPS_TOOL = {
  name: 'select_clips',
  description: 'Registra os melhores trechos do video pra virar cortes verticais de TikTok.',
  input_schema: {
    type: 'object',
    properties: {
      clips: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Titulo curto e chamativo pro corte, estilo TikTok.' },
            description: { type: 'string', description: 'Legenda curta pra usar na postagem (1-2 frases), com 2-4 hashtags relevantes ao final.' },
            startSeconds: { type: 'number' },
            endSeconds: { type: 'number' },
          },
          required: ['title', 'description', 'startSeconds', 'endSeconds'],
        },
      },
    },
    required: ['clips'],
  },
};

// exact=true (modo "escolher quantidade"): pede exatamente maxClips trechos.
// exact=false (modo "IA decide"): maxClips vira so um teto de seguranca, o
// prompt deixa claro que e a IA quem decide quantos fazem sentido.
async function selectClips(transcriptWords, { maxClips = 4, minDuration = 25, maxDuration = 90, exact = false } = {}) {
  const transcript = formatTranscriptForPrompt(transcriptWords);
  if (!transcript) {
    throw new Error('Transcricao vazia - nao ha o que analisar.');
  }

  const countInstruction = exact
    ? `Escolha exatamente ${maxClips} trechos`
    : `Escolha quantos trechos bons voce encontrar (sem numero fixo - nao force conteudo fraco so pra preencher, mas tambem nao deixe passar um momento forte). No maximo ${maxClips}`;

  const prompt = `Aqui esta a transcricao de um video do YouTube, com marcacoes de tempo a cada poucos segundos:

${transcript}

${countInstruction} que funcionariam bem como cortes verticais pro TikTok: momentos com potencial viral, respostas completas, historias com gancho, ou insights fortes - cada um durando entre ${minDuration} e ${maxDuration} segundos. Cada corte precisa comecar e terminar em um ponto que faca sentido sozinho (nunca no meio de uma frase). Sugira um titulo curto e chamativo, e uma legenda pronta pra postar (com hashtags) pra cada um. Use a ferramenta select_clips pra registrar sua escolha.`;

  const response = await fetch(MESSAGES_URL, {
    method: 'POST',
    headers: {
      'x-api-key': config.anthropic.apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 2048,
      tools: [SELECT_CLIPS_TOOL],
      tool_choice: { type: 'tool', name: 'select_clips' },
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(`Falha ao selecionar cortes (Claude): ${data.error?.message || response.statusText}`);
  }

  const toolUse = data.content.find((block) => block.type === 'tool_use');
  if (!toolUse) {
    throw new Error('Claude nao retornou uma selecao de cortes valida.');
  }

  const inputTokens = data.usage?.input_tokens || 0;
  const outputTokens = data.usage?.output_tokens || 0;

  return {
    clips: toolUse.input.clips,
    inputTokens,
    outputTokens,
    costUsd: claudeCostUsd(inputTokens, outputTokens),
  };
}

module.exports = { selectClips, formatTranscriptForPrompt };
