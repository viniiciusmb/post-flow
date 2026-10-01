// Transcricao de audio via API da OpenAI (Whisper), com timestamp por
// palavra - usado pra gerar a legenda estilo TikTok e pra IA escolher cortes.
// https://developers.openai.com/api/docs/guides/speech-to-text
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const config = require('../config');
const { whisperCostUsd } = require('../lib/apiCost');
const { PausedError } = require('../lib/errors');

const TRANSCRIPTION_URL = 'https://api.openai.com/v1/audio/transcriptions';

// A OpenAI recusa arquivo acima de 25 MiB (26.214.400 bytes) com um 413 - e
// recusa SEMPRE, entao repetir nao adianta. Fica uma folga abaixo do limite
// porque o corpo da requisicao leva o formulario junto com o arquivo.
const LIMITE_DA_OPENAI_BYTES = 25 * 1024 * 1024;
const TAMANHO_SEGURO_BYTES = 24 * 1024 * 1024;
// Cada parte mira bem abaixo do limite: o tamanho de um trecho de audio nao e
// exatamente proporcional a duracao, e uma parte que estourasse por pouco
// derrubaria o video inteiro do mesmo jeito.
const ALVO_POR_PARTE_BYTES = 18 * 1024 * 1024;

function rodar(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args);
    let stdout = '';
    let stderr = '';
    let terminou = false;
    child.stdout.on('data', (c) => { stdout += c; });
    child.stderr.on('data', (c) => { stderr += c; });
    // 'error' e 'close' podem disparar os dois pro mesmo processo que falhou
    // ao nascer (erro nº 3 do CLAUDE.md) - so o primeiro conta.
    child.on('error', (err) => {
      if (terminou) return;
      terminou = true;
      reject(err);
    });
    child.on('close', (code) => {
      if (terminou) return;
      terminou = true;
      if (code !== 0) return reject(new Error(`${cmd} saiu com codigo ${code}: ${stderr.slice(-500)}`));
      resolve(stdout);
    });
  });
}

async function duracaoDoAudio(arquivo) {
  const saida = await rodar(process.env.FFPROBE_PATH || 'ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', arquivo,
  ]);
  const segundos = Number(String(saida).trim());
  if (!Number.isFinite(segundos) || segundos <= 0) throw new Error('Nao foi possivel ler a duracao do audio.');
  return segundos;
}

// Audio grande demais pra uma chamada so: corta em partes de duracao igual,
// transcreve cada uma e junta tudo com os tempos deslocados pro inicio de cada
// parte - quem recebe (legenda, escolha de cortes) ve uma transcricao unica,
// como se tivesse sido uma chamada so.
async function transcreverEmPartes(audioFilePath, tamanhoBytes, { language, checkCancelled }) {
  const duracao = await duracaoDoAudio(audioFilePath);
  const quantidade = Math.max(2, Math.ceil(tamanhoBytes / ALVO_POR_PARTE_BYTES));
  const duracaoDaParte = duracao / quantidade;
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'postflow-partes-'));

  try {
    const resultado = { text: [], language: language || null, words: [], segments: [], durationSeconds: 0 };
    for (let i = 0; i < quantidade; i++) {
      const inicio = i * duracaoDaParte;
      const parte = path.join(pasta, `parte-${i}.mp3`);
      // Reencoda em vez de copiar: com -c copy o corte cai na borda do quadro
      // de mp3 mais proxima e o inicio real da parte deixa de ser "inicio" -
      // a legenda inteira dali pra frente sairia fora de sincronia.
      await rodar(process.env.FFMPEG_PATH || 'ffmpeg', [
        '-y', '-hide_banner', '-loglevel', 'error',
        '-ss', inicio.toFixed(3), '-t', duracaoDaParte.toFixed(3), '-i', audioFilePath,
        '-vn', '-ac', '1', '-ar', '16000', '-b:a', '32k', parte,
      ]);
      // A primeira parte detecta o idioma; as seguintes recebem o mesmo, pra
      // um video nao virar metade portugues e metade outra coisa.
      const t = await transcreverUmArquivo(parte, { language: resultado.language, checkCancelled });
      if (!resultado.language) resultado.language = t.language;
      resultado.text.push(t.text);
      for (const w of t.words) resultado.words.push({ word: w.word, start: w.start + inicio, end: w.end + inicio });
      for (const sg of t.segments) resultado.segments.push({ start: sg.start + inicio, end: sg.end + inicio, text: sg.text });
      resultado.durationSeconds += t.durationSeconds;
    }
    return {
      text: resultado.text.filter(Boolean).join(' '),
      language: resultado.language,
      words: resultado.words,
      segments: resultado.segments,
      durationSeconds: resultado.durationSeconds,
      costUsd: whisperCostUsd(resultado.durationSeconds),
    };
  } finally {
    fs.rmSync(pasta, { recursive: true, force: true });
  }
}

async function transcribeAudio(audioFilePath, opcoes = {}) {
  const tamanho = fs.statSync(audioFilePath).size;
  if (tamanho > TAMANHO_SEGURO_BYTES) return transcreverEmPartes(audioFilePath, tamanho, opcoes);
  return transcreverUmArquivo(audioFilePath, opcoes);
}

async function transcreverUmArquivo(audioFilePath, { language, checkCancelled } = {}) {
  const fileBuffer = fs.readFileSync(audioFilePath);
  const form = new FormData();
  form.append('file', new Blob([fileBuffer]), path.basename(audioFilePath));
  form.append('model', 'whisper-1');
  form.append('response_format', 'verbose_json');
  form.append('timestamp_granularities[]', 'word');
  // Frases (segmentos) com inicio e fim, na mesma chamada e sem custo extra:
  // o corte de live usa pra terminar no FIM de uma frase, nunca no meio (ver
  // liveRenderService). Quem nao usa (o fluxo do YouTube) so ignora o campo.
  form.append('timestamp_granularities[]', 'segment');
  if (language) form.append('language', language);

  // Confere pausa a cada 2s enquanto espera a OpenAI responder - sem isso,
  // pausar so tinha efeito depois que a transcricao inteira terminasse.
  const controller = new AbortController();
  let cancelled = false;
  const cancelPoll = checkCancelled
    ? setInterval(async () => {
        if (await checkCancelled()) {
          cancelled = true;
          controller.abort();
        }
      }, 2000)
    : null;

  let response;
  try {
    response = await fetch(TRANSCRIPTION_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.openai.apiKey}` },
      body: form,
      signal: controller.signal,
    });
  } catch (err) {
    if (cancelled) throw new PausedError('Transcrição interrompida pelo cliente.');
    throw err;
  } finally {
    if (cancelPoll) clearInterval(cancelPoll);
  }

  const data = await response.json();
  if (!response.ok) {
    throw new Error(`Falha na transcricao (OpenAI): ${data.error?.message || response.statusText}`);
  }

  return {
    text: data.text,
    // O Whisper detecta o idioma e devolve o codigo ISO ('pt', 'en', 'es'...).
    // E o que impede a IA de escrever titulo em ingles pra video em portugues.
    language: data.language || null,
    words: (data.words || []).map((w) => ({ word: w.word, start: w.start, end: w.end })),
    segments: (data.segments || []).map((sg) => ({ start: sg.start, end: sg.end, text: String(sg.text || '').trim() })),
    durationSeconds: data.duration || 0,
    costUsd: whisperCostUsd(data.duration),
  };
}

module.exports = { transcribeAudio, LIMITE_DA_OPENAI_BYTES, TAMANHO_SEGURO_BYTES };
