// Desenha a imagem de uma cena quando o acervo nao serve.
//
// Nao e recurso de luxo: medido contra a API real antes de existir este
// arquivo, um tema moderno e abstrato ("artificial intelligence replacing
// jobs") devolveu 4 resultados inuteis no acervo, e 3 das 6 buscas da amostra
// vieram vazias. Sem este caminho, o video teria buracos.
//
// E tambem o item que MAIS pesa no custo quando o modo "qualidade" esta
// ligado: a ~US$ 0,011 por imagem e ~10 imagens por minuto de video, ele passa
// a narracao com folga. Por isso a politica de imagem e uma escolha por video,
// feita na tela.
'use strict';

const fs = require('fs');
const config = require('../config');
const { imagemIaCostUsd } = require('../lib/apiCost');

const URL_GERACAO = 'https://api.openai.com/v1/images/generations';
const MODELO = 'gpt-image-1-mini';

// A imagem ja sai na proporcao do video para nao depender do corte depois:
// cortar uma imagem quadrada para 16:9 joga fora um terco do que foi desenhado
// (em geral o topo e o pe da composicao, que e onde o modelo poe o contexto).
const TAMANHOS = {
  '16:9': '1536x1024',
  '9:16': '1024x1536',
};

const TIMEOUT_MS = 120_000;

// O estilo e fixado aqui, e nao deixado a cargo de cada prompt, porque o que
// faz um video parecer profissional e a COERENCIA entre as cenas. Sem isso
// cada imagem sai de uma escola diferente e o resultado parece colagem.
const ESTILO = 'Cinematic illustration, rich depth, dramatic lighting, muted natural palette, '
  + 'painterly texture, no text or lettering anywhere in the image, no watermarks, no borders.';

async function gerar(prompt, destino, { aspect = '16:9' } = {}) {
  const descricao = String(prompt || '').trim();
  if (!descricao) throw new Error('Não há descrição para gerar a imagem.');
  if (!config.openai.apiKey) throw new Error('A geração de imagem precisa da chave da OpenAI.');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let response;
  try {
    response = await fetch(URL_GERACAO, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.openai.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODELO,
        prompt: `${descricao}\n\n${ESTILO}`,
        size: TAMANHOS[aspect] || TAMANHOS['16:9'],
        quality: 'medium',
        n: 1,
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  const data = await response.json();
  if (!response.ok) {
    throw new Error(`Falha ao gerar a imagem (OpenAI): ${data.error?.message || response.statusText}`);
  }

  // gpt-image-* sempre devolve base64, nunca URL - diferente do dall-e-3.
  const b64 = data.data?.[0]?.b64_json;
  if (!b64) throw new Error('A OpenAI não devolveu nenhuma imagem.');

  fs.writeFileSync(destino, Buffer.from(b64, 'base64'));

  return {
    path: destino,
    custoUsd: imagemIaCostUsd(1),
    // Imagem desenhada nao tem questao de licenca: e obra gerada sob demanda.
    license: 'Gerada por IA',
    credit: 'Imagem gerada por inteligência artificial',
    source: 'ia',
  };
}

module.exports = { gerar, TAMANHOS, ESTILO };
