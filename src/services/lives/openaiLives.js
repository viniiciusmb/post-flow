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
const { miniTranscribeCostUsd, gpt5NanoCostUsd, gpt5MiniCostUsd } = require('../../lib/apiCost');

const TRANSCRICAO_URL = 'https://api.openai.com/v1/audio/transcriptions';
const CHAT_URL = 'https://api.openai.com/v1/chat/completions';
const MODELO_TRANSCRICAO = 'gpt-4o-mini-transcribe';
const MODELO_TEXTO = 'gpt-5-nano';
// O juiz, o ajuste fino e a camera usam o mini: no primeiro teste real o nano
// deu nota 7 pra quase todo trecho - nao distingue momento bom de conversa.
const MODELO_JUIZ = 'gpt-5-mini';
const CUSTO_POR_MODELO = { 'gpt-5-nano': gpt5NanoCostUsd, 'gpt-5-mini': gpt5MiniCostUsd };
const TIMEOUT_MS = 90_000;

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
    // Cobrado pela duracao do audio enviado, nao pelo texto que voltou.
    return { texto: String(dados.text || '').trim(), custoUsd: miniTranscribeCostUsd(segundos) };
  });
}

// Pede ao modelo de texto mais barato uma resposta que OBEDECE ao schema
// (structured outputs, strict). A validacao de negocio (limites de tempo,
// nota, ids que existem) continua sendo de quem chama: o schema garante o
// formato, nao que o conteudo faca sentido.
// "imagem" (opcional): JPEG em base64, mandado junto com o texto - usado pra
// achar a camera do streamer num quadro da live.
async function pedirJson({ nome, sistema, usuario, schema, modelo = MODELO_TEXTO, raciocinio = 'minimal', imagem = null }) {
  return comUmaNovaTentativa(async () => {
    const conteudoUsuario = imagem
      ? [
          { type: 'text', text: usuario },
          { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${imagem}`, detail: 'low' } },
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
        response_format: { type: 'json_schema', json_schema: { name: nome, strict: true, schema } },
        messages: [
          { role: 'system', content: sistema },
          { role: 'user', content: conteudoUsuario },
        ],
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const dados = await r.json().catch(() => ({}));
    if (!r.ok) {
      const e = new Error(`OpenAI (${nome}) respondeu ${r.status}: ${dados.error?.message || ''}`);
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
    const saida = dados.usage?.completion_tokens || 0;
    const custo = (CUSTO_POR_MODELO[modelo] || gpt5MiniCostUsd)(entrada, saida);
    return { dados: json, inputTokens: entrada, outputTokens: saida, custoUsd: custo };
  });
}

module.exports = { transcreverBloco, pedirJson, MODELO_TRANSCRICAO, MODELO_TEXTO, MODELO_JUIZ };
