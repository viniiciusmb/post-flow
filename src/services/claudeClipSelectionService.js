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

// O Whisper devolve o codigo ISO; a instrucao pro modelo fica bem mais firme
// com o nome do idioma escrito por extenso do que com "pt".
const NOMES_DE_IDIOMA = {
  pt: 'português',
  en: 'inglês',
  es: 'espanhol',
  fr: 'francês',
  it: 'italiano',
  de: 'alemão',
  ja: 'japonês',
  ko: 'coreano',
  zh: 'chinês',
  ru: 'russo',
  ar: 'árabe',
  hi: 'híndi',
  nl: 'holandês',
  pl: 'polonês',
  tr: 'turco',
};

function instrucaoDeIdioma(language) {
  const nome = NOMES_DE_IDIOMA[String(language || '').slice(0, 2).toLowerCase()];
  // Sem idioma detectado (video transcrito antes desta mudanca), o melhor
  // palpite e a propria transcricao que esta no prompt.
  if (!nome) {
    return 'IMPORTANTE: escreva o titulo e a legenda NO MESMO IDIOMA da transcricao acima. Nao traduza para outro idioma.';
  }
  return `IMPORTANTE: o video e falado em ${nome}. Escreva o titulo e a legenda em ${nome}, nunca em outro idioma. Nao traduza.`;
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
            title: { type: 'string', description: 'Titulo curto e chamativo pro corte, estilo TikTok, NO MESMO IDIOMA falado no video.' },
            description: { type: 'string', description: 'Legenda curta pra usar na postagem (1-2 frases), com 2-4 hashtags relevantes ao final, NO MESMO IDIOMA falado no video.' },
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
async function selectClips(transcriptWords, { maxClips = 4, minDuration = 25, maxDuration = 90, exact = false, language = null } = {}) {
  const transcript = formatTranscriptForPrompt(transcriptWords);
  if (!transcript) {
    throw new Error('Transcrição vazia. Não há o que analisar.');
  }

  const countInstruction = exact
    ? `Escolha exatamente ${maxClips} trechos`
    : `Escolha quantos trechos bons voce encontrar (sem numero fixo - nao force conteudo fraco so pra preencher, mas tambem nao deixe passar um momento forte). No maximo ${maxClips}`;

  const prompt = `Aqui esta a transcricao de um video do YouTube, com marcacoes de tempo a cada poucos segundos:

${transcript}

${countInstruction} que funcionariam bem como cortes verticais pro TikTok: momentos com potencial viral, respostas completas, historias com gancho, ou insights fortes - cada um durando entre ${minDuration} e ${maxDuration} segundos. Cada corte precisa comecar e terminar em um ponto que faca sentido sozinho (nunca no meio de uma frase). Sugira um titulo curto e chamativo, e uma legenda pronta pra postar (com hashtags) pra cada um. Use a ferramenta select_clips pra registrar sua escolha.

${instrucaoDeIdioma(language)}`;

  const response = await fetch(MESSAGES_URL, {
    method: 'POST',
    headers: {
      'x-api-key': config.anthropic.apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 4096,
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
    throw new Error('Claude não retornou uma seleção de cortes válida.');
  }
  if (data.stop_reason === 'max_tokens') {
    throw new Error('A resposta da IA foi cortada antes de terminar (vídeo com muitos cortes selecionados). Tente de novo.');
  }
  if (!Array.isArray(toolUse.input.clips)) {
    throw new Error('Claude retornou uma seleção de cortes incompleta ou inválida.');
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

// Titulos pras partes do modo "cortar o video inteiro em partes".
//
// Ali a IA nao escolhe TRECHO (as fronteiras vem da conta de duracao), mas
// continua sendo ela quem escreve o titulo: sem isso, as 8 partes saiam todas
// com o titulo do video do YouTube - identico em todas e no idioma em que o
// canal titulou, que nem sempre e o idioma falado. Foi o que aconteceu em
// 23/08/2026: 8 cortes de um video falado em portugues sairam com o mesmo
// titulo em ingles queimado na tela.
const TITLE_PARTS_TOOL = {
  name: 'title_parts',
  description: 'Registra um titulo e uma legenda para cada parte do video.',
  input_schema: {
    type: 'object',
    properties: {
      parts: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            index: { type: 'number', description: 'Numero da parte, comecando em 1.' },
            title: { type: 'string', description: 'Titulo curto e chamativo pra ESTA parte, estilo TikTok, NO MESMO IDIOMA falado no video.' },
            description: { type: 'string', description: 'Legenda curta pra postagem (1-2 frases) com 2-4 hashtags, NO MESMO IDIOMA falado no video.' },
          },
          required: ['index', 'title', 'description'],
        },
      },
    },
    required: ['parts'],
  },
};

async function titleParts(transcriptWords, partes, { language = null } = {}) {
  const transcript = formatTranscriptForPrompt(transcriptWords);
  if (!transcript) throw new Error('Transcrição vazia. Não há o que analisar.');

  const listaDePartes = partes
    .map((p, i) => `Parte ${i + 1}: de ${formatTimestamp(p.startSeconds)} ate ${formatTimestamp(p.endSeconds)}`)
    .join('\n');

  const prompt = `Aqui esta a transcricao de um video, com marcacoes de tempo a cada poucos segundos:

${transcript}

Esse video foi dividido em ${partes.length} partes seguidas, que juntas cobrem o video inteiro:

${listaDePartes}

Escreva um titulo curto e chamativo e uma legenda pronta pra postar (com hashtags) para CADA uma dessas ${partes.length} partes, olhando o que e falado dentro do intervalo de tempo daquela parte especifica.

Regras:
- Cada parte precisa de um titulo DIFERENTE das outras, sobre o que acontece nela. Nunca repita o mesmo titulo em duas partes.
- Nao escreva "Parte 1", "Parte 2" nem numero nenhum no titulo: a numeracao ja e colocada separadamente pelo sistema.
- Titulo curto, no maximo 60 caracteres.
- Devolva exatamente ${partes.length} itens, com index de 1 a ${partes.length}.

${instrucaoDeIdioma(language)}`;

  const response = await fetch(MESSAGES_URL, {
    method: 'POST',
    headers: {
      'x-api-key': config.anthropic.apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 4096,
      tools: [TITLE_PARTS_TOOL],
      tool_choice: { type: 'tool', name: 'title_parts' },
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(`Falha ao titular as partes (Claude): ${data.error?.message || response.statusText}`);
  }
  const toolUse = data.content.find((block) => block.type === 'tool_use');
  if (!toolUse || !Array.isArray(toolUse.input.parts)) {
    throw new Error('Claude não retornou títulos válidos para as partes.');
  }

  const inputTokens = data.usage?.input_tokens || 0;
  const outputTokens = data.usage?.output_tokens || 0;
  return {
    parts: toolUse.input.parts,
    inputTokens,
    outputTokens,
    costUsd: claudeCostUsd(inputTokens, outputTokens),
  };
}

module.exports = { selectClips, titleParts, formatTranscriptForPrompt };
