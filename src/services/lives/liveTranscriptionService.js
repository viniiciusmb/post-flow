// Transcricao corrida da live, bloco a bloco (~30s). Antes de pagar pela
// transcricao, o proprio ffmpeg mede o bloco de graca: quanto dele e silencio
// e qual o volume. Bloco quase todo silencioso nao vai pra transcricao - numa live
// com pausas longas (AFK, tela de espera) isso corta boa parte do custo.
'use strict';

const fs = require('fs');
const { spawn } = require('child_process');
const livesRepository = require('../../repositories/livesRepository');
const transcricaoService = require('../transcricaoService');
const logger = require('../../lib/logger');
const { similaridade } = require('../../lib/similaridadeDeTexto');

const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
// A transcricao corrida vai ACELERADA: a OpenAI cobra pelo audio enviado.
// 04/10/2026: de 1,5x pra 1,25x. Medido contra uma transcricao independente
// (whisper-1) em audio real: fala limpa 96,3% (1,0x) / 95,3% (1,25x) / 94,7%
// (1,5x); live barulhenta (festa com musica) 45,2% / 47,4% / 36,3%. Em 1,5x o
// texto de live barulhenta piora de verdade; 1,25x fica igual ao normal e
// custa ~US$ 0,01 a mais por hora (custo real: ~US$ 0,068/h contra 0,056/h).
// Em 2x a transcricao QUEBRA ("(musica acelerada)") - nao subir.
// A legenda do corte nao passa por aqui: e feita a parte, em velocidade
// normal (liveRenderService). Custo de CPU: ~0,4s por bloco.
const VELOCIDADE_TRANSCRICAO = 1.25;

// Vigia da economia: 1 bloco a cada N tambem e transcrito em velocidade
// normal, e o quanto os dois textos concordam fica no banco e na tela. Custa
// ~4% a mais na transcricao. Se a concordancia cair, a aceleracao esta
// piorando o texto (ex.: lives mais barulhentas) e vale baixar a velocidade.
const AMOSTRAR_A_CADA = 25;

// Acima de 90% de silencio o bloco e pulado. Nao 100%: live tem ruido de
// fundo (musica baixa, clique de teclado) que nunca e silencio absoluto.
const LIMITE_SILENCIO = 0.9;

// Mede o bloco numa passada so: silencedetect (abaixo de -35 dB por 1s+ conta
// como silencio) e ebur128 (volume integrado e pico). Nada disso custa API.
function analisarAudio(arquivo, duracao) {
  return new Promise((resolve, reject) => {
    const filho = spawn(FFMPEG, [
      '-hide_banner', '-nostats', '-i', arquivo,
      // ebur128 SEM framelog: no nivel de log padrao ele imprime o volume
      // momentaneo 10x por segundo ("t: 12.3 ... M: -18.2"). A media do bloco
      // quase nao varia; o grito so aparece no segundo (ver interpretarAnalise).
      '-af', 'silencedetect=noise=-35dB:d=1,ebur128=peak=true',
      '-f', 'null', '-',
    ]);
    let saida = '';
    let terminou = false;
    filho.stderr.on('data', (c) => { saida += c; });
    filho.on('error', (err) => {
      if (terminou) return;
      terminou = true;
      reject(err);
    });
    filho.on('close', (codigo) => {
      if (terminou) return;
      terminou = true;
      if (codigo !== 0) return reject(new Error(`ffmpeg (analise de audio) saiu com ${codigo}: ${saida.slice(-300)}`));
      resolve(interpretarAnalise(saida, duracao));
    });
  });
}

// "duracao" vem do banco (inicio/fim do bloco na lista do ffmpeg), nao do
// cabecalho do arquivo: o cabecalho de um pedaco pode herdar o relogio do
// anterior e dizer que tem o dobro do tamanho.
function acelerarAudio(arquivo, destino) {
  return new Promise((resolve, reject) => {
    const filho = spawn(FFMPEG, [
      '-y', '-hide_banner', '-loglevel', 'error', '-i', arquivo,
      '-af', `atempo=${VELOCIDADE_TRANSCRICAO}`, '-c:a', 'libopus', '-b:a', '32k', destino,
    ]);
    let erro = '';
    let terminou = false;
    filho.stderr.on('data', (c) => { erro += c; });
    filho.on('error', (err) => {
      if (terminou) return;
      terminou = true;
      reject(err);
    });
    filho.on('close', (codigo) => {
      if (terminou) return;
      terminou = true;
      if (codigo !== 0) return reject(new Error(`ffmpeg (acelerar audio) saiu com ${codigo}: ${erro.slice(-300)}`));
      resolve(destino);
    });
  });
}

function interpretarAnalise(saida, duracao) {
  const silencio = [...saida.matchAll(/silence_duration:\s*([\d.]+)/g)].reduce((s, m) => s + Number(m[1]), 0);
  // Bloco que TERMINA em silencio nao tem "silence_duration" do ultimo
  // trecho, so "silence_start" - conta ate o fim do bloco.
  const inicios = [...saida.matchAll(/silence_start:\s*([\d.]+)/g)].map((m) => Number(m[1]));
  const fins = [...saida.matchAll(/silence_end:\s*([\d.]+)/g)].length;
  let silencioTotal = silencio;
  if (inicios.length > fins && duracao) silencioTotal += Math.max(0, duracao - inicios[inicios.length - 1]);
  const integrado = saida.match(/Summary:[\s\S]*?I:\s*(-?[\d.]+|-inf)\s*LUFS/);
  const pico = saida.match(/True peak:[\s\S]*?Peak:\s*(-?[\d.]+|-inf)\s*dBFS/);
  const num = (m) => (m && m[1] !== '-inf' ? Number(m[1]) : null);
  // Volume momentaneo (janela de 400ms do ebur128) -> o MAIOR de cada
  // segundo do bloco. -70 e o piso do medidor (silencio).
  const momentaneo = [];
  for (const m of saida.matchAll(/\bt:\s*([\d.]+)\s+TARGET:\S+\s+LUFS\s+M:\s*(-?[\d.]+|-inf)/g)) {
    const seg = Math.floor(Number(m[1]));
    const valor = m[2] === '-inf' ? -70 : Math.max(-70, Number(m[2]));
    momentaneo[seg] = momentaneo[seg] === undefined ? valor : Math.max(momentaneo[seg], valor);
  }
  const porSegundo = Array.from(momentaneo, (v) => (v === undefined ? -70 : Math.round(v * 10) / 10));
  return {
    silencioSegundos: Math.min(silencioTotal, duracao || silencioTotal),
    loudness: num(integrado),
    pico: num(pico),
    momentaneo: porSegundo,
  };
}

function amostrar(bloco) {
  return Number(bloco.id) % AMOSTRAR_A_CADA === 0;
}

// Transcreve o mesmo bloco em velocidade normal e guarda a concordancia com
// o texto acelerado. Falha aqui nunca derruba o bloco: e so medicao.
async function conferirVelocidade(bloco, textoAcelerado, segundos) {
  try {
    const normal = await transcricaoService.transcreverBlocoDeLive(bloco.file_path, { segundos, uso: 'lives_monitor' });
    const pct = Math.round(similaridade(normal.texto, textoAcelerado) * 10000) / 100;
    await livesRepository.setTranscriptCheck(bloco.id, pct);
    await livesRepository.recordCost({
      channelId: bloco.live_channel_id,
      sessionId: bloco.session_id,
      kind: 'monitor_transcricao',
      audioSeconds: segundos,
      custoUsd: normal.custoUsd,
    });
  } catch (err) {
    logger.warn(`Lives: conferencia da transcricao do bloco ${bloco.id} falhou: ${err.message}`);
  }
}

// Processa UM bloco pendente. Devolve false quando nao ha nada na fila.
async function processarProximo() {
  const bloco = await livesRepository.claimPendingTranscript();
  if (!bloco) return false;
  const segundos = Number(bloco.end_offset) - Number(bloco.start_offset);
  try {
    const analise = await module.exports.analisarAudio(bloco.file_path, segundos);
    const fracaoSilencio = segundos > 0 ? analise.silencioSegundos / segundos : 0;
    if (fracaoSilencio >= LIMITE_SILENCIO) {
      await livesRepository.finishTranscript(bloco.id, {
        status: 'silencio',
        loudness: analise.loudness,
        pico: analise.pico,
        silencio: analise.silencioSegundos,
        momentaneo: analise.momentaneo,
      });
      return true;
    }
    // Sem o texto do bloco anterior como "prompt": medido na primeira live
    // real (28/09/2026), o gpt-4o-mini-transcribe COPIAVA esse texto pro
    // comeco da resposta - cada bloco saia repetindo o fim do anterior, e a
    // triagem via o mesmo momento em dois lugares da live.
    const acelerado = `${bloco.file_path}.rapido.ogg`;
    const segundosCobrados = segundos / VELOCIDADE_TRANSCRICAO;
    let resultado;
    try {
      await module.exports.acelerarAudio(bloco.file_path, acelerado);
      resultado = await transcricaoService.transcreverBlocoDeLive(acelerado, { segundos: segundosCobrados, uso: 'lives' });
    } finally {
      fs.rm(acelerado, { force: true }, () => {});
    }
    const { texto, custoUsd } = resultado;
    if (module.exports.amostrar(bloco)) await module.exports.conferirVelocidade(bloco, texto, segundos);
    await livesRepository.finishTranscript(bloco.id, {
      status: 'feito',
      texto,
      loudness: analise.loudness,
      pico: analise.pico,
      silencio: analise.silencioSegundos,
      momentaneo: analise.momentaneo,
      custoUsd,
    });
    await livesRepository.recordCost({
      channelId: bloco.live_channel_id,
      sessionId: bloco.session_id,
      kind: 'transcricao',
      // Os segundos COBRADOS (o audio acelerado), nao os da live.
      audioSeconds: segundosCobrados,
      custoUsd,
    });
  } catch (err) {
    logger.error(`Lives: transcricao do bloco ${bloco.id} falhou (tentativa ${bloco.attempts}):`, err.message);
    await livesRepository.failTranscript(bloco.id, err.message);
  }
  return true;
}

module.exports = { processarProximo, analisarAudio, acelerarAudio, interpretarAnalise, conferirVelocidade, amostrar, LIMITE_SILENCIO, VELOCIDADE_TRANSCRICAO, AMOSTRAR_A_CADA };
