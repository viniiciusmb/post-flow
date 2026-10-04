// As duas chamadas a OpenAI que o modulo de lives faz, e so elas: transcrever
// um bloco de audio e pedir uma resposta em JSON. Decisao do fundador
// (28/09/2026): o fluxo das lives usa SO OpenAI, pra ter uma IA so. O fluxo
// do YouTube continua com o Claude e nao passa por aqui.
//
// Sem SDK, igual o resto do projeto: fetch direto com OPENAI_API_KEY.
'use strict';

const fs = require('fs');
const path = require('path');
const config = require('../../config');
const {
  miniTranscribeCostFromUsage,
  textoCostFromUsage,
  GPT5_MINI_USD_PER_MTOK_INPUT,
  GPT5_MINI_USD_PER_MTOK_OUTPUT,
  GPT5_NANO_USD_PER_MTOK_INPUT,
  GPT5_NANO_USD_PER_MTOK_OUTPUT,
} = require('../../lib/apiCost');

const TRANSCRICAO_URL = 'https://api.openai.com/v1/audio/transcriptions';
const CHAT_URL = 'https://api.openai.com/v1/chat/completions';
const MODELO_TRANSCRICAO = 'gpt-4o-mini-transcribe';
const MODELO_TEXTO = 'gpt-5-nano';
// O juiz, o ajuste fino e a camera usam o mini: no primeiro teste real o nano
// deu nota 7 pra quase todo trecho - nao distingue momento bom de conversa.
const MODELO_JUIZ = 'gpt-5-mini';
const PRECOS = {
  'gpt-5-nano': { precoEntrada: GPT5_NANO_USD_PER_MTOK_INPUT, precoSaida: GPT5_NANO_USD_PER_MTOK_OUTPUT },
  'gpt-5-mini': { precoEntrada: GPT5_MINI_USD_PER_MTOK_INPUT, precoSaida: GPT5_MINI_USD_PER_MTOK_OUTPUT },
};
const TIMEOUT_MS = 90_000;
// Flex responde mais devagar (fila da OpenAI). Teto maior; passou disso, a
// mesma pergunta vai no modo normal - nada do modulo espera um corte por
// causa de uma fila.
const TIMEOUT_FLEX_MS = 180_000;
// Flex nas chamadas de texto (pedido de 04/10/2026: "mais lento se ficar
// mais barato, sem perder qualidade"): MESMO modelo e mesma resposta, pela
// metade do preco. Conferido na VPS: a OpenAI aceita service_tier flex no
// gpt-5-mini e devolve "service_tier": "flex". Desligavel sem deploy com
// LIVES_OPENAI_FLEX=false.
const USAR_FLEX = process.env.LIVES_OPENAI_FLEX !== 'false';

function erroPassageiro(status) {
  return status === 429 || status >= 500;
}

async function comUmaNovaTentativa(fn) {
  try {
    return await fn();
  } catch (err) {
    if (!err.passageiro) throw err;
    await new Promise((r) => setTimeout(r, 3000));
    return fn();
  }
}

// Transcreve um bloco curto (~30s). "contexto" vai no parametro prompt da
// OpenAI - NAO passe o texto do bloco anterior: o gpt-4o-mini-transcribe
// devolve esse texto copiado dentro da resposta (visto em 28/09/2026).
async function transcreverBloco(arquivo, { contexto = '', segundos = 0 } = {}) {
  return comUmaNovaTentativa(async () => {
    const form = new FormData();
    form.append('file', new Blob([fs.readFileSync(arquivo)]), path.basename(arquivo));
    form.append('model', MODELO_TRANSCRICAO);
    form.append('response_format', 'json');
    if (contexto) form.append('prompt', contexto.slice(-400));
    const r = await fetch(TRANSCRICAO_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.openai.apiKey}` },
      body: form,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const dados = await r.json().catch(() => ({}));
    if (!r.ok) {
      const e = new Error(`Transcricao da live falhou (${r.status}): ${dados.error?.message || ''}`);
      e.passageiro = erroPassageiro(r.status);
      throw e;
    }
    // Cobrado pelos tokens que a propria resposta informa (audio enviado +
    // texto devolvido); sem "usage", cai na estimativa por minuto.
    return { texto: String(dados.text || '').trim(), custoUsd: miniTranscribeCostFromUsage(dados.usage, segundos) };
  });
}

// Pede ao modelo de texto mais barato uma resposta que OBEDECE ao schema
// (structured outputs, strict). A validacao de negocio (limites de tempo,
// nota, ids que existem) continua sendo de quem chama: o schema garante o
// formato, nao que o conteudo faca sentido.
// "imagem" (opcional): JPEG em base64, mandado junto com o texto - usado pra
// achar a camera do streamer num quadro da live.
async function pedirJson({ nome, sistema, usuario, schema, modelo = MODELO_TEXTO, raciocinio = 'minimal', imagem = null, flex = USAR_FLEX }) {
  if (flex) {
    try {
      return await chamarJson({ nome, sistema, usuario, schema, modelo, raciocinio, imagem, flex: true });
    } catch (err) {
      // Flex sem capacidade agora (429, nao cobrado) ou fila longa demais: a
      // mesma pergunta no modo normal. Erro de verdade (400) nao e repetido.
      if (!err.passageiro && !err.estourouTempo) throw err;
    }
  }
  return chamarJson({ nome, sistema, usuario, schema, modelo, raciocinio, imagem, flex: false });
}

async function chamarJson({ nome, sistema, usuario, schema, modelo, raciocinio, imagem, flex }) {
  const tentar = async () => {
    // Uma imagem ou varias (o formato do corte e decidido vendo dois quadros).
    const imagens = imagem ? (Array.isArray(imagem) ? imagem : [imagem]) : [];
    const conteudoUsuario = imagens.length
      ? [
          { type: 'text', text: usuario },
          ...imagens.map((b64) => ({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${b64}`, detail: 'low' } })),
        ]
      : usuario;
    const r = await fetch(CHAT_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.openai.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: modelo,
        // nano com 'minimal': medido em 28/09 - zero token de raciocinio.
        // O juiz usa 'low': pensar um pouco e o que separa momento bom de
        // conversa, e custa centavos no volume dele.
        reasoning_effort: raciocinio,
        ...(flex ? { service_tier: 'flex' } : {}),
        response_format: { type: 'json_schema', json_schema: { name: nome, strict: true, schema } },
        messages: [
          { role: 'system', content: sistema },
          { role: 'user', content: conteudoUsuario },
        ],
      }),
      signal: AbortSignal.timeout(flex ? TIMEOUT_FLEX_MS : TIMEOUT_MS),
    }).catch((err) => {
      if (err.name === 'TimeoutError') err.estourouTempo = true;
      throw err;
    });
    const dados = await r.json().catch(() => ({}));
    if (!r.ok) {
      const e = new Error(`OpenAI (${nome}${flex ? ', flex' : ''}) respondeu ${r.status}: ${dados.error?.message || ''}`);
      e.passageiro = erroPassageiro(r.status);
      throw e;
    }
    const conteudo = dados.choices?.[0]?.message?.content;
    let json;
    try {
      json = JSON.parse(conteudo);
    } catch {
      throw new Error(`OpenAI (${nome}) devolveu algo que nao e JSON.`);
    }
    const entrada = dados.usage?.prompt_tokens || 0;
    const emCache = dados.usage?.prompt_tokens_details?.cached_tokens || 0;
    const saida = dados.usage?.completion_tokens || 0;
    // O tier que a OpenAI DE FATO usou (ela devolve na resposta), nao o pedido.
    const tier = dados.service_tier || (flex ? 'flex' : 'default');
    const custo = textoCostFromUsage({ ...(PRECOS[modelo] || PRECOS['gpt-5-mini']), entrada, emCache, saida, flex: tier === 'flex' });
    return { dados: json, inputTokens: entrada, outputTokens: saida, cachedTokens: emCache, tier, custoUsd: custo };
  };
  // No flex, um 429 vai direto pro modo normal (sem esperar 3s pra repetir).
  return flex ? tentar() : comUmaNovaTentativa(tentar);
}

module.exports = { transcreverBloco, pedirJson, USAR_FLEX, MODELO_TRANSCRICAO, MODELO_TEXTO, MODELO_JUIZ };
