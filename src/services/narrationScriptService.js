// A IA (Claude) le o roteiro ja dividido em cenas e decide COMO ilustrar cada
// uma: que termo buscar no acervo, ou que imagem mandar desenhar.
//
// Ela NAO reescreve o texto. A divisao em cenas e deterministica
// (src/lib/roteiroEmCenas.js) e o texto e o que o usuario colou - se a IA
// pudesse mexer nele, o roteiro voltaria diferente do que foi escrito, e o
// roteiro e justamente o produto de quem esta usando.
'use strict';

const config = require('../config');
const { claudeCostUsd } = require('../lib/apiCost');

const MESSAGES_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-sonnet-5';

// Teto de seguranca: um roteiro de 30 minutos daria ~90 cenas, e mandar todas
// num prompt so cabe folgado. O teto existe para o caso patologico (roteiro
// colado com megabytes), que estouraria o max_tokens da resposta.
const MAX_CENAS_POR_CHAMADA = 120;

const ILUSTRAR_TOOL = {
  name: 'ilustrar_cenas',
  description: 'Registra como cada cena da narracao deve ser ilustrada.',
  input_schema: {
    type: 'object',
    properties: {
      cenas: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            index: {
              type: 'number',
              description: 'Numero da cena, exatamente como veio na lista. Comeca em 0.',
            },
            imageQuery: {
              type: 'string',
              description:
                'Termo de busca EM INGLES para procurar uma imagem real em acervos (Wikimedia Commons, bancos de foto). '
                + '2 a 6 palavras, concretas e especificas. Prefira nomes proprios, epocas e objetos ("Triumph of Death Bruegel painting", '
                + '"plague doctor mask engraving") em vez de conceitos abstratos ("fear", "sadness"), que nao existem como foto.',
            },
            imagePrompt: {
              type: 'string',
              description:
                'Descricao EM INGLES da imagem a ser DESENHADA por IA, caso o acervo nao sirva. Uma frase visual e concreta, '
                + 'com estilo coerente com o tema (ex: "dark medieval oil painting of a deserted plague-stricken city street, '
                + 'muted earth tones, dramatic light"). Nunca peca texto escrito dentro da imagem, nem rosto de pessoa real e identificavel.',
            },
            preferir: {
              type: 'string',
              enum: ['acervo', 'ia'],
              description:
                'Onde esta imagem fica MELHOR. Use "acervo" quando existe registro real do assunto (fatos historicos, obras de arte, '
                + 'lugares, animais, objetos, pessoas historicas) - a gravura original sempre vence um desenho. Use "ia" quando o assunto '
                + 'e abstrato, conceitual, hipotetico ou moderno demais para ter registro (sentimentos, metaforas, cenarios futuros).',
            },
          },
          required: ['index', 'imageQuery', 'imagePrompt', 'preferir'],
        },
      },
      musicMood: {
        type: 'string',
        description:
          'Clima da musica de fundo que combina com o roteiro inteiro. Um de: sombrio, epico, misterioso, calmo, tenso, inspirador.',
      },
    },
    required: ['cenas'],
  },
};

// O termo de busca sai em INGLES mesmo quando o roteiro esta em portugues, e
// isso foi MEDIDO contra a API real antes de virar regra: "Black Death plague
// 1348" devolve as gravuras originais da Peste de Florenca em altissima
// resolucao; a busca equivalente em portugues devolve muito menos. Os acervos
// (Wikimedia, bancos de foto) sao indexados majoritariamente em ingles.
//
// Isso nao afeta a narracao, que continua no idioma do roteiro - so a busca
// muda de idioma.
function montarPrompt(cenas, { titulo }) {
  const lista = cenas.map((c) => `[cena ${c.idx}] ${c.text}`).join('\n\n');

  return `Voce esta ajudando a ilustrar um video narrado chamado "${titulo}".

O roteiro ja esta dividido em cenas. Cada cena vira um trecho de narracao com UMA imagem na tela enquanto ela e falada.

${lista}

Para CADA cena acima, decida como ilustra-la. Duas fontes estao disponiveis:

1. ACERVO - imagens reais (Wikimedia Commons, bancos de foto). Imbativel para o que existe de verdade: obras de arte, fatos historicos, lugares, objetos, animais, documentos, pessoas historicas. Uma gravura original de 1656 sempre vence um desenho de IA dela.

2. IA - imagem desenhada na hora. Necessaria quando nao existe registro real: ideias abstratas, metaforas, cenarios hipoteticos, situacoes modernas genericas.

Regras importantes:
- O termo de busca (imageQuery) tem que estar EM INGLES e ser CONCRETO. Acervo nao indexa sentimento: "medieval mass grave burial" encontra alguma coisa, "despair" nao encontra nada util.
- Escreva SEMPRE os dois campos (imageQuery e imagePrompt), mesmo quando tiver certeza de qual fonte e melhor: se a busca falhar, o desenho e o plano B, e vice-versa.
- Cenas vizinhas nao podem pedir a mesma imagem. Varie o angulo, o objeto ou o momento retratado, senao o video repete a mesma tela.
- Mantenha um estilo visual coerente entre as cenas desenhadas por IA (mesma tecnica, mesma paleta), senao o video parece uma colagem de fontes diferentes.

Devolva uma entrada para CADA uma das ${cenas.length} cenas, usando o campo index para dizer a qual cena cada entrada corresponde. Use a ferramenta ilustrar_cenas.`;
}

async function planejarIlustracoes(cenas, { titulo = 'video' } = {}) {
  if (!Array.isArray(cenas) || cenas.length === 0) {
    throw new Error('Não há cenas para ilustrar.');
  }
  if (cenas.length > MAX_CENAS_POR_CHAMADA) {
    throw new Error(
      `Roteiro grande demais: ${cenas.length} cenas (máximo ${MAX_CENAS_POR_CHAMADA}). Divida em vídeos menores.`
    );
  }

  const response = await fetch(MESSAGES_URL, {
    method: 'POST',
    headers: {
      'x-api-key': config.anthropic.apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 8192,
      tools: [ILUSTRAR_TOOL],
      tool_choice: { type: 'tool', name: 'ilustrar_cenas' },
      messages: [{ role: 'user', content: montarPrompt(cenas, { titulo }) }],
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(`Falha ao planejar as imagens (Claude): ${data.error?.message || response.statusText}`);
  }
  if (data.stop_reason === 'max_tokens') {
    throw new Error('A resposta da IA foi cortada antes de terminar (roteiro muito longo). Divida em vídeos menores.');
  }

  const toolUse = (data.content || []).find((bloco) => bloco.type === 'tool_use');
  if (!toolUse || !Array.isArray(toolUse.input?.cenas)) {
    throw new Error('A IA não devolveu um plano de imagens válido.');
  }

  const inputTokens = data.usage?.input_tokens || 0;
  const outputTokens = data.usage?.output_tokens || 0;

  return {
    cenas: casarPorIndice(cenas, toolUse.input.cenas),
    musicMood: toolUse.input.musicMood || null,
    inputTokens,
    outputTokens,
    costUsd: claudeCostUsd(inputTokens, outputTokens),
  };
}

// Casa a resposta da IA com as cenas pelo campo `index`, NUNCA pela posicao no
// array. A ordem da resposta nao e garantida, e trocar a imagem da cena 1 com
// a da cena 7 e um erro que so aparece assistindo o video pronto - mesma
// licao do titleParts no pipeline de cortes.
//
// Cena sem resposta nao quebra o video: ela cai num plano derivado do proprio
// texto. Imagem e acabamento; perder o video inteiro porque a IA esqueceu uma
// entrada seria desproporcional.
function casarPorIndice(cenas, respostas) {
  const porIndice = new Map();
  for (const r of respostas) {
    if (r && Number.isFinite(Number(r.index))) porIndice.set(Number(r.index), r);
  }

  return cenas.map((cena) => {
    const r = porIndice.get(cena.idx);
    return {
      ...cena,
      imageQuery: (r?.imageQuery || '').trim() || palavrasChave(cena.text),
      imagePrompt: (r?.imagePrompt || '').trim() || cena.text.slice(0, 300),
      preferir: r?.preferir === 'ia' ? 'ia' : 'acervo',
    };
  });
}

// Plano B quando a IA nao respondeu por aquela cena: as palavras mais longas
// do trecho. E pior que o termo da IA (e nao esta em ingles), mas e melhor que
// nao buscar nada - e so acontece em cena solta, nao no video todo.
function palavrasChave(texto) {
  return String(texto || '')
    .split(/\s+/)
    .filter((p) => p.length > 5)
    .slice(0, 4)
    .join(' ')
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .trim();
}

module.exports = { planejarIlustracoes, MAX_CENAS_POR_CHAMADA };
