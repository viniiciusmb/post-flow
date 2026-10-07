// Transcricao de audio - a porta unica do sistema inteiro (07/10/2026).
//
// Todo lugar que transforma fala em texto passa por aqui: os videos do YouTube
// e os enviados pelo cliente, a legenda dos cortes de live, a transcricao
// corrida das lives e o video narrado.
//
// A ordem dos provedores e decisao de custo, medida antes de escrever codigo
// (palestra do TEDx com legenda feita por pessoas como gabarito):
//
//   1. DeepInfra, whisper-large-v3-turbo - US$ 0,0002/min, 30x menos que a
//      OpenAI. Erro de 6,1% contra 6,3% do whisper-1 que usavamos.
//   2. Groq, o mesmo modelo, no plano gratuito (limite de 2 h de audio por
//      hora) - reserva sem custo.
//   3. OpenAI (whisper-1 / gpt-4o-mini-transcribe nas lives) - ultimo recurso,
//      o que sempre funcionou.
//
// Se um falha (sem saldo, fora do ar, limite), o proximo assume na hora e o
// video segue. Pausa do cliente NUNCA cai pro proximo: e uma ordem, nao falha.
//
// A ARMADILHA DA DEEPINFRA: mandando o audio inteiro, ela o corta sozinha em
// pedacos fixos de 30s e a fala que cai no corte SOME - medido: 15 frases de
// 15-20 palavras perdidas num video de 97 min, e erro de 7,8% em vez de 6,1%.
// Por isso o audio e cortado AQUI, nas pausas da fala, em pedacos de ate 28s
// - o mesmo principio dos blocos das lives. Com isso: nenhuma frase perdida.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const config = require('../config');
const logger = require('../lib/logger');
const { PausedError } = require('../lib/errors');
const { transcricaoCostUsd } = require('../lib/apiCost');
const { codigoDeIdioma } = require('../lib/codigoDeIdioma');
const gastoDeIa = require('./gastoDeIaService');
const openaiTranscriptionService = require('./openaiTranscriptionService');
const openaiLives = require('./lives/openaiLives');

const DEEPINFRA_URL = 'https://api.deepinfra.com/v1/openai/audio/transcriptions';
const DEEPINFRA_MODELO = 'openai/whisper-large-v3-turbo';
const GROQ_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';
const GROQ_MODELO = 'whisper-large-v3-turbo';

// Pedacos cortados nas pausas: no maximo 28s (a DeepInfra corta em 30s por
// conta propria - ficar abaixo garante que ela nunca corte de novo) e no
// minimo 8s (pedaco curto demais da pouco contexto pro modelo e multiplica
// as chamadas).
const MAX_PEDACO_S = 28;
const MIN_PEDACO_S = 8;
// Pedacos transcritos ao mesmo tempo. 97 min = ~220 pedacos: um por vez
// levaria mais de 10 minutos; com 6, ~3,5 min (medido na VPS).
const PARALELO = 6;
const TIMEOUT_PEDACO_MS = 120_000;
const TENTATIVAS_POR_PEDACO = 3;
// Pedaco quase todo silencio nao e enviado: nao ha o que transcrever, e e
// exatamente nele que o Whisper inventa frase ("Legendas pela comunidade
// Amara.org"). Mesmo limite das lives.
const SILENCIO_PULA = 0.9;

// Plano gratuito da Groq aceita ate 25 MB por arquivo. O fetch do Node desiste
// em 300s sem resposta - a Groq responde 97 min em ~15s, entao sobra folga.
const LIMITE_GROQ_BYTES = 24 * 1024 * 1024;
const TIMEOUT_GROQ_MS = 280_000;

// Frases que o Whisper INVENTA em trecho de musica ou silencio - vem dos
// creditos de legenda do material em que ele foi treinado. Pedaco cujo texto
// e so isso vira vazio.
const ALUCINACOES = [
  /amara\.org/i,
  /legendas pela comunidade/i,
  /legendado por/i,
  /subtitles by/i,
  /^\s*(obrigad[oa] por assistir|thanks? for watching|thank you for watching)[.!]?\s*$/i,
];

function ehAlucinacao(texto) {
  const t = String(texto || '').trim();
  return Boolean(t) && ALUCINACOES.some((re) => re.test(t));
}

// ---------------------------------------------------------------------------
// ffmpeg / ffprobe
// ---------------------------------------------------------------------------

function rodar(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args);
    let stdout = '';
    let stderr = '';
    let terminou = false;
    child.stdout.on('data', (c) => { stdout += c; });
    child.stderr.on('data', (c) => { stderr += c; });
    // 'error' e 'close' podem disparar os dois (erro nº 3 do CLAUDE.md).
    child.on('error', (err) => {
      if (terminou) return;
      terminou = true;
      reject(err);
    });
    child.on('close', (code) => {
      if (terminou) return;
      terminou = true;
      if (code !== 0) return reject(new Error(`${cmd} saiu com codigo ${code}: ${stderr.slice(-500)}`));
      resolve({ stdout, stderr });
    });
  });
}

async function duracaoDoAudio(arquivo) {
  const { stdout } = await rodar(process.env.FFPROBE_PATH || 'ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', arquivo,
  ]);
  const segundos = Number(String(stdout).trim());
  if (!Number.isFinite(segundos) || segundos <= 0) throw new Error('Nao foi possivel ler a duracao do audio.');
  return segundos;
}

// Onde estao as pausas. -30 dB por 0,25s+ conta como pausa: e o respiro entre
// frases, nao so o silencio absoluto (que quase nao existe em video).
async function analisarSilencios(arquivo, duracao) {
  const { stderr } = await rodar(process.env.FFMPEG_PATH || 'ffmpeg', [
    '-hide_banner', '-nostats', '-i', arquivo, '-af', 'silencedetect=noise=-30dB:d=0.25', '-f', 'null', '-',
  ]);
  return interpretarSilencios(stderr, duracao);
}

function interpretarSilencios(saida, duracao) {
  const silencios = [];
  let inicio = null;
  for (const linha of String(saida).split('\n')) {
    const a = linha.match(/silence_start:\s*(-?[\d.]+)/);
    if (a) inicio = Math.max(0, Number(a[1]));
    const b = linha.match(/silence_end:\s*([\d.]+)/);
    if (b && inicio !== null) {
      silencios.push({ inicio, fim: Number(b[1]) });
      inicio = null;
    }
  }
  // Audio que TERMINA em silencio so tem "silence_start".
  if (inicio !== null && duracao) silencios.push({ inicio, fim: duracao });
  return silencios;
}

// Onde cortar: o meio da ULTIMA pausa que cabe no pedaco (o pedaco fica o
// maior possivel sem passar de 28s). Sem pausa nenhuma na janela (fala
// corrida, musica), corta no limite - raro, e o pior caso e o de antes.
function planejarPedacos(duracao, silencios, { max = MAX_PEDACO_S, min = MIN_PEDACO_S } = {}) {
  if (!(duracao > 0)) return [];
  const meios = silencios.map((s) => (s.inicio + s.fim) / 2).sort((x, y) => x - y);
  const pedacos = [];
  let inicio = 0;
  while (duracao - inicio > max) {
    const candidatos = meios.filter((m) => m > inicio + min && m <= inicio + max);
    const fim = candidatos.length ? candidatos[candidatos.length - 1] : inicio + max;
    pedacos.push([inicio, fim]);
    inicio = fim;
  }
  pedacos.push([inicio, duracao]);
  return pedacos;
}

function fracaoDeSilencio([a, b], silencios) {
  if (b <= a) return 1;
  let total = 0;
  for (const s of silencios) total += Math.max(0, Math.min(b, s.fim) - Math.max(a, s.inicio));
  return total / (b - a);
}

async function extrairPedaco(arquivo, [a, b], destino) {
  // Reencoda (nao -c copy): com copy o corte cai na borda do quadro de mp3 e o
  // "inicio" do pedaco deixa de ser o inicio - a legenda dali pra frente sairia
  // fora de sincronia.
  await rodar(process.env.FFMPEG_PATH || 'ffmpeg', [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-ss', a.toFixed(3), '-to', b.toFixed(3), '-i', arquivo,
    '-vn', '-ac', '1', '-ar', '16000', '-b:a', '32k', destino,
  ]);
  return destino;
}

// ---------------------------------------------------------------------------
// Chamada HTTP (DeepInfra e Groq falam o formato da OpenAI)
// ---------------------------------------------------------------------------

function erroDaApi(provedor, status, dados) {
  const msg = dados?.error?.message || dados?.detail?.error || (typeof dados?.detail === 'string' ? dados.detail : '') || '';
  const e = new Error(`Transcricao ${provedor} respondeu ${status}: ${String(msg).slice(0, 200)}`);
  e.status = status;
  // 429 (limite) e 5xx passam sozinhos; 402/401/400 (sem saldo, chave, pedido
  // ruim) nao adianta repetir - vai direto pro proximo provedor.
  e.passageiro = status === 429 || status >= 500;
  return e;
}

async function pedirTranscricao({ url, chave, modelo, arquivo, provedor, language, palavras = true, timeoutMs, sinal }) {
  const form = new FormData();
  form.append('file', new Blob([fs.readFileSync(arquivo)]), path.basename(arquivo));
  form.append('model', modelo);
  if (palavras) {
    form.append('response_format', 'verbose_json');
    form.append('timestamp_granularities[]', 'word');
    form.append('timestamp_granularities[]', 'segment');
  } else {
    form.append('response_format', 'json');
  }
  if (language) form.append('language', language);
  const sinais = [AbortSignal.timeout(timeoutMs)];
  if (sinal) sinais.push(sinal);
  let r;
  try {
    r = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${chave}` },
      body: form,
      signal: AbortSignal.any(sinais),
    });
  } catch (err) {
    // Rede caiu ou estourou o tempo: passageiro.
    err.passageiro = true;
    throw err;
  }
  const dados = await r.json().catch(() => ({}));
  if (!r.ok) throw erroDaApi(provedor, r.status, dados);
  return dados;
}

async function comTentativas(fn, tentativas = TENTATIVAS_POR_PEDACO) {
  let ultimo;
  for (let i = 0; i < tentativas; i++) {
    try {
      return await fn();
    } catch (err) {
      ultimo = err;
      if (!err.passageiro || err.pausado) throw err;
      await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
    }
  }
  throw ultimo;
}

function normalizarResposta(dados, deslocamento = 0) {
  return {
    text: String(dados.text || '').trim(),
    language: dados.language || null,
    words: (dados.words || []).map((w) => ({ word: w.word, start: w.start + deslocamento, end: w.end + deslocamento })),
    segments: (dados.segments || []).map((sg) => ({
      start: sg.start + deslocamento,
      end: sg.end + deslocamento,
      text: String(sg.text || '').trim(),
    })),
  };
}

// Vigia a pausa do cliente a cada 2s enquanto a transcricao roda, e corta as
// chamadas em andamento na hora - igual ao resto do pipeline.
function vigiarPausa(checkCancelled) {
  const controller = new AbortController();
  let pausado = false;
  const timer = checkCancelled
    ? setInterval(async () => {
        try {
          if (await checkCancelled()) {
            pausado = true;
            controller.abort();
          }
        } catch {
          // Falha ao consultar o banco nao e pausa.
        }
      }, 2000)
    : null;
  if (timer && timer.unref) timer.unref();
  return {
    sinal: controller.signal,
    pausado: () => pausado,
    parar: () => timer && clearInterval(timer),
  };
}

// ---------------------------------------------------------------------------
// Provedores (arquivo inteiro, com tempo de cada palavra)
// ---------------------------------------------------------------------------

async function transcreverDeepinfra(arquivo, { language, checkCancelled } = {}) {
  const duracao = await module.exports.duracaoDoAudio(arquivo);
  const silencios = duracao > MAX_PEDACO_S ? await module.exports.analisarSilencios(arquivo, duracao) : [];
  const pedacos = planejarPedacos(duracao, silencios);
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'postflow-pedacos-'));
  const vigia = vigiarPausa(checkCancelled);
  const resultados = new Array(pedacos.length).fill(null);
  let idioma = codigoDeIdioma(language);
  let segundosEnviados = 0;

  const um = async (i) => {
    if (vigia.pausado()) throw new PausedError('Transcrição interrompida pelo cliente.');
    const [a, b] = pedacos[i];
    let fonte = arquivo;
    if (pedacos.length > 1) fonte = await module.exports.extrairPedaco(arquivo, pedacos[i], path.join(pasta, `p${i}.mp3`));
    try {
      const dados = await comTentativas(() =>
        pedirTranscricao({
          url: DEEPINFRA_URL,
          chave: config.deepinfra.apiKey,
          modelo: DEEPINFRA_MODELO,
          arquivo: fonte,
          provedor: 'deepinfra',
          language: idioma,
          timeoutMs: TIMEOUT_PEDACO_MS,
          sinal: vigia.sinal,
        }).catch((err) => {
          if (vigia.pausado()) err.pausado = true;
          throw err;
        })
      );
      segundosEnviados += b - a;
      const r = normalizarResposta(dados, pedacos.length > 1 ? a : 0);
      // Pedaco que so tem frase inventada fica vazio.
      resultados[i] = ehAlucinacao(r.text) ? { text: '', language: r.language, words: [], segments: [] } : r;
    } finally {
      if (fonte !== arquivo) fs.rm(fonte, { force: true }, () => {});
    }
  };

  let falhou = false;
  try {
    const fila = pedacos.map((_, i) => i).filter((i) => fracaoDeSilencio(pedacos[i], silencios) < SILENCIO_PULA);
    // O primeiro pedaco com fala decide o idioma de todos os outros, pra um
    // video nao virar metade portugues e metade outra coisa.
    if (!idioma && fila.length) {
      const primeiro = fila.shift();
      await um(primeiro);
      idioma = codigoDeIdioma(resultados[primeiro].language);
    }
    await Promise.all(
      Array.from({ length: Math.min(PARALELO, fila.length) }, async () => {
        // Um pedaco que falhou de vez derruba o provedor inteiro (o proximo
        // assume o arquivo todo) - entao para de gastar com os que faltam.
        while (fila.length && !falhou) {
          try {
            await um(fila.shift());
          } catch (err) {
            falhou = true;
            throw err;
          }
        }
      })
    );
  } catch (err) {
    if (vigia.pausado() || err instanceof PausedError) throw new PausedError('Transcrição interrompida pelo cliente.');
    throw err;
  } finally {
    vigia.parar();
    fs.rmSync(pasta, { recursive: true, force: true });
  }

  const partes = resultados.filter(Boolean);
  return {
    text: partes.map((p) => p.text).filter(Boolean).join(' '),
    language: idioma || codigoDeIdioma(partes.find((p) => p.language)?.language),
    words: partes.flatMap((p) => p.words),
    segments: partes.flatMap((p) => p.segments),
    durationSeconds: duracao,
    segundosCobrados: segundosEnviados,
    costUsd: transcricaoCostUsd('deepinfra', segundosEnviados),
  };
}

async function transcreverGroq(arquivo, { language, checkCancelled } = {}) {
  const tamanho = fs.statSync(arquivo).size;
  const vigia = vigiarPausa(checkCancelled);
  const pedir = (fonte, idioma) =>
    comTentativas(
      () =>
        pedirTranscricao({
          url: GROQ_URL,
          chave: config.groq.apiKey,
          modelo: GROQ_MODELO,
          arquivo: fonte,
          provedor: 'groq',
          language: idioma,
          timeoutMs: TIMEOUT_GROQ_MS,
          sinal: vigia.sinal,
        }),
      // 429 na Groq gratuita e o limite por hora: esperar segundos nao
      // resolve, o certo e passar logo pro proximo provedor.
      1
    );
  try {
    if (tamanho <= LIMITE_GROQ_BYTES) {
      const dados = await pedir(arquivo, codigoDeIdioma(language));
      const r = normalizarResposta(dados);
      const duracao = Number(dados.duration) || 0;
      return { ...r, durationSeconds: duracao, segundosCobrados: duracao, costUsd: transcricaoCostUsd('groq', duracao) };
    }
    // Acima do limite do plano gratuito: partes de duracao igual.
    const duracao = await module.exports.duracaoDoAudio(arquivo);
    const quantidade = Math.ceil(tamanho / (18 * 1024 * 1024));
    const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'postflow-groq-'));
    try {
      const fatia = duracao / quantidade;
      const saida = { text: [], words: [], segments: [] };
      let idioma = codigoDeIdioma(language);
      for (let i = 0; i < quantidade; i++) {
        const parte = await module.exports.extrairPedaco(arquivo, [i * fatia, (i + 1) * fatia], path.join(pasta, `g${i}.mp3`));
        const r = normalizarResposta(await pedir(parte, idioma), i * fatia);
        if (!idioma) idioma = codigoDeIdioma(r.language);
        saida.text.push(r.text);
        saida.words.push(...r.words);
        saida.segments.push(...r.segments);
      }
      return {
        text: saida.text.filter(Boolean).join(' '),
        language: idioma,
        words: saida.words,
        segments: saida.segments,
        durationSeconds: duracao,
        segundosCobrados: duracao,
        costUsd: transcricaoCostUsd('groq', duracao),
      };
    } finally {
      fs.rmSync(pasta, { recursive: true, force: true });
    }
  } catch (err) {
    if (vigia.pausado()) throw new PausedError('Transcrição interrompida pelo cliente.');
    throw err;
  } finally {
    vigia.parar();
  }
}

async function transcreverOpenai(arquivo, { language, checkCancelled } = {}) {
  const r = await openaiTranscriptionService.transcribeAudio(arquivo, { language: codigoDeIdioma(language) || undefined, checkCancelled });
  return { ...r, segundosCobrados: r.durationSeconds };
}

function provedoresDeArquivo() {
  const lista = [];
  if (config.deepinfra.apiKey) lista.push({ nome: 'deepinfra', fn: (...a) => module.exports.transcreverDeepinfra(...a) });
  if (config.groq.apiKey) lista.push({ nome: 'groq', fn: (...a) => module.exports.transcreverGroq(...a) });
  if (config.openai.apiKey) lista.push({ nome: 'openai', fn: (...a) => module.exports.transcreverOpenai(...a) });
  return lista;
}

// Transcreve um arquivo de audio inteiro, com o tempo de cada palavra.
// Devolve { text, language (codigo ISO), words, segments, durationSeconds,
// costUsd, provedor } - o mesmo formato que o sistema sempre recebeu.
// "uso" so serve pra anotar de onde veio o gasto (tela de Custos).
async function transcribeAudio(arquivo, opcoes = {}) {
  const { uso = 'transcricao', ...resto } = opcoes;
  const lista = provedoresDeArquivo();
  if (!lista.length) throw new Error('Nenhum provedor de transcricao configurado (DEEPINFRA_API_KEY, GROQ_API_KEY ou OPENAI_API_KEY).');
  let ultimoErro = null;
  for (const p of lista) {
    try {
      const r = await p.fn(arquivo, resto);
      const resultado = {
        text: r.text,
        language: codigoDeIdioma(r.language) || codigoDeIdioma(resto.language) || null,
        words: r.words || [],
        segments: r.segments || [],
        durationSeconds: r.durationSeconds || 0,
        costUsd: r.costUsd || 0,
        provedor: p.nome,
      };
      gastoDeIa.registrar(p.nome, uso, resultado.costUsd, { audioSegundos: r.segundosCobrados ?? r.durationSeconds });
      if (p !== lista[0]) logger.warn(`Transcricao feita pela reserva (${p.nome}) - o provedor principal falhou antes.`);
      return resultado;
    } catch (err) {
      if (err instanceof PausedError) throw err;
      ultimoErro = err;
      logger.warn(`Transcricao: ${p.nome} falhou (${err.message}) - tentando o proximo provedor.`);
    }
  }
  throw ultimoErro;
}

// Bloco curto da live (~30s, ja acelerado): so o texto, sem tempo de palavra.
// "segundos" e a duracao do audio ENVIADO (o que e cobrado).
async function transcreverBlocoDeLive(arquivo, { segundos = 0, uso = 'lives' } = {}) {
  const lista = [];
  if (config.deepinfra.apiKey) lista.push('deepinfra');
  if (config.groq.apiKey) lista.push('groq');
  if (config.openai.apiKey) lista.push('openai');
  if (!lista.length) throw new Error('Nenhum provedor de transcricao configurado.');
  let ultimoErro = null;
  for (const nome of lista) {
    try {
      let texto;
      let custoUsd;
      if (nome === 'openai') {
        const r = await openaiLives.transcreverBloco(arquivo, { segundos });
        texto = r.texto;
        custoUsd = r.custoUsd;
      } else {
        const dados = await comTentativas(
          () =>
            pedirTranscricao({
              url: nome === 'deepinfra' ? DEEPINFRA_URL : GROQ_URL,
              chave: nome === 'deepinfra' ? config.deepinfra.apiKey : config.groq.apiKey,
              modelo: nome === 'deepinfra' ? DEEPINFRA_MODELO : GROQ_MODELO,
              arquivo,
              provedor: nome,
              palavras: false,
              timeoutMs: 90_000,
            }),
          nome === 'deepinfra' ? 2 : 1
        );
        texto = String(dados.text || '').trim();
        custoUsd = transcricaoCostUsd(nome, segundos);
      }
      if (ehAlucinacao(texto)) texto = '';
      gastoDeIa.registrar(nome, uso, custoUsd, { audioSegundos: segundos });
      return { texto, custoUsd, provedor: nome };
    } catch (err) {
      ultimoErro = err;
      logger.warn(`Transcricao de bloco de live: ${nome} falhou (${err.message}) - tentando o proximo.`);
    }
  }
  throw ultimoErro;
}

module.exports = {
  transcribeAudio,
  transcreverBlocoDeLive,
  transcreverDeepinfra,
  transcreverGroq,
  transcreverOpenai,
  duracaoDoAudio,
  analisarSilencios,
  extrairPedaco,
  interpretarSilencios,
  planejarPedacos,
  fracaoDeSilencio,
  ehAlucinacao,
  MAX_PEDACO_S,
  MIN_PEDACO_S,
};
