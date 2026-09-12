// Gera a narracao a partir do texto de uma cena.
//
// Provedor plugavel porque a escolha entre os dois e uma decisao de custo x
// qualidade que muda com o tempo, nao uma constante do sistema:
//
//   openai (padrao)  - gpt-4o-mini-tts, ~US$ 0,015 por minuto de audio.
//                      Provado em producao nesta VPS antes de virar codigo.
//   elevenlabs       - perceptivelmente melhor em entonacao dramatica em
//                      portugues, e ~3x mais caro. Ligado quando a chave
//                      chegar, sem mudar mais nada.
//
// A narracao e gerada POR CENA, nunca do roteiro inteiro de uma vez. Ver o
// comentario de narrated_video_scenes na migration 084: e o que dispensa
// alinhar o texto original com o que o Whisper ouviu, e o que mantem cada
// requisicao abaixo do limite de 4096 caracteres da OpenAI.
'use strict';

const fs = require('fs');
const config = require('../config');
const { ttsCostUsd } = require('../lib/apiCost');

const OPENAI_URL = 'https://api.openai.com/v1/audio/speech';
const OPENAI_MODEL = 'gpt-4o-mini-tts';
const ELEVENLABS_URL = 'https://api.elevenlabs.io/v1/text-to-speech';
const ELEVENLABS_MODEL = 'eleven_flash_v2_5';

// Limite duro da OpenAI. As cenas ja saem bem abaixo disso (MAX_CHARS = 400 em
// roteiroEmCenas), mas a checagem fica aqui porque quem chama pode mudar.
const MAX_CHARS_POR_REQUISICAO = 4096;

// Vozes da OpenAI que funcionam bem para narracao em portugues. 'onyx' e a
// grave de documentario - foi a usada na amostra aprovada pelo fundador.
const VOZES_OPENAI = ['onyx', 'ash', 'sage', 'alloy', 'nova', 'shimmer', 'echo', 'fable', 'ballad', 'coral', 'verse'];

// O tom NAO e escolhido pela voz, e sim por instrucao em texto - recurso do
// gpt-4o-mini-tts que muda bastante o resultado. Sem isso a leitura sai
// apressada e sem pausa, que e o contrario de narracao de documentario.
const INSTRUCAO_PADRAO =
  'Narre em portugues do Brasil como um documentario. Voz firme e envolvente, ritmo pausado, '
  + 'com pausas naturais entre as frases. Pronuncie numeros e datas por extenso, sem pressa.';

function vozValida(provider, voiceId) {
  if (provider === 'elevenlabs') return String(voiceId || '').trim() || null;
  return VOZES_OPENAI.includes(voiceId) ? voiceId : 'onyx';
}

async function gerarOpenAi(texto, { voiceId, instrucao }) {
  const response = await fetch(OPENAI_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.openai.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      voice: vozValida('openai', voiceId),
      input: texto,
      instructions: instrucao || INSTRUCAO_PADRAO,
      response_format: 'mp3',
    }),
  });

  if (!response.ok) {
    const corpo = await response.text();
    throw new Error(`Falha ao gerar a narração (OpenAI ${response.status}): ${corpo.slice(0, 300)}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

async function gerarElevenLabs(texto, { voiceId }) {
  const voz = vozValida('elevenlabs', voiceId);
  if (!config.elevenlabs.apiKey) {
    throw new Error('A voz da ElevenLabs está selecionada mas a chave não foi configurada (ELEVENLABS_API_KEY).');
  }
  if (!voz) {
    throw new Error('A voz da ElevenLabs precisa de um ID de voz.');
  }

  const response = await fetch(`${ELEVENLABS_URL}/${encodeURIComponent(voz)}`, {
    method: 'POST',
    headers: {
      'xi-api-key': config.elevenlabs.apiKey,
      'Content-Type': 'application/json',
      Accept: 'audio/mpeg',
    },
    body: JSON.stringify({
      text: texto,
      model_id: ELEVENLABS_MODEL,
      voice_settings: { stability: 0.5, similarity_boost: 0.75 },
    }),
  });

  if (!response.ok) {
    const corpo = await response.text();
    throw new Error(`Falha ao gerar a narração (ElevenLabs ${response.status}): ${corpo.slice(0, 300)}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

// Gera o audio de UM trecho e grava em destino. Devolve o custo ja calculado.
//
// O custo do audio da OpenAI so pode ser fechado depois de saber a DURACAO do
// arquivo (ela cobra por token de audio de saida), e quem mede a duracao e o
// ffprobe de quem chamou - por isso audioSeconds entra por parametro na conta,
// e nao aqui dentro.
async function gerarNarracao(texto, destino, { provider = 'openai', voiceId = 'onyx', instrucao = null } = {}) {
  const conteudo = String(texto || '').trim();
  if (!conteudo) throw new Error('Não há texto para narrar.');
  if (conteudo.length > MAX_CHARS_POR_REQUISICAO) {
    throw new Error(
      `Trecho longo demais para uma narração só (${conteudo.length} caracteres, máximo ${MAX_CHARS_POR_REQUISICAO}).`
    );
  }

  const buffer = provider === 'elevenlabs'
    ? await gerarElevenLabs(conteudo, { voiceId })
    : await gerarOpenAi(conteudo, { voiceId, instrucao });

  fs.writeFileSync(destino, buffer);
  return { path: destino, chars: conteudo.length, bytes: buffer.length };
}

function custoDaNarracao(provider, { chars, audioSeconds }) {
  return ttsCostUsd(provider, { chars, audioSeconds });
}

module.exports = {
  gerarNarracao,
  custoDaNarracao,
  vozValida,
  VOZES_OPENAI,
  MAX_CHARS_POR_REQUISICAO,
  INSTRUCAO_PADRAO,
};
