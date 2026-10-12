// Gravacao de UMA live (Twitch ou Kick - o streamlink tem as duas):
// streamlink (baixa a transmissao, pulando os anuncios da Twitch - padrao no
// 8.x) com a saida ligada direto no ffmpeg, que grava em pedacos:
//
//   seg_NNNNNN.ts  - video+audio COPIADOS (sem recodificar), 10s cada
//   aud_NNNNN.ogg  - so o audio, mono 16 kHz opus 32 kbps, 30s cada - e o que
//                    vai pra transcricao
//   video.csv / audio.csv - listas que o ffmpeg escreve quando FECHA cada
//                    pedaco (nome, inicio, fim). Linha na lista = arquivo
//                    completo; e isso que o liveSegmentsService le.
//
// Custo medido na VPS (28/09/2026, 480p30): ~2% de um nucleo e 0,65 GB/hora.
//
// Duas licoes deste projeto aplicadas aqui (ver CLAUDE.md, "Erros reais"):
//  - spawn com detached + matar o GRUPO (process.kill(-pid)): o streamlink
//    abre processos filhos, e child.kill() deixaria orfaos gravando;
//  - 'error' e 'close' podem disparar os dois pro mesmo processo: o fim da
//    gravacao e avisado UMA vez so (guarda "avisado").
'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const config = require('../../config');
const logger = require('../../lib/logger');
const errorReportService = require('../errorReportService');

const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';

// Ordem de preferencia de qualidade. A Twitch nomeia as variantes com a
// taxa de quadros ("480p30", "720p60") e nem todo canal tem todas; a Kick
// oferece 160p/360p/480p/720p60/1080p60 (conferido em 30/09/2026). A lista
// termina em "worst" pra NUNCA falhar por falta da qualidade exata.
const QUALIDADES = {
  '360p': '360p,360p30,160p,worst',
  '480p': '480p,480p30,360p,360p30,worst',
  // 720p30 antes de 720p60: mesma nitidez pra camera, metade dos quadros pra
  // gravar e depois decodificar no render.
  '720p': '720p30,720p,720p60,480p,480p30,worst',
};

const emAndamento = new Map(); // sessionId -> { parar, terminou }

function argsStreamlink(url, qualidade) {
  // Sem --twitch-disable-ads: no streamlink 8.x pular os anuncios virou o
  // padrao e a opcao antiga so gera aviso de obsoleta (o log confirma "Will
  // skip ad segments" sem ela).
  return [
    '--stdout',
    '--loglevel', 'info',
    // Queda de rede curta nao encerra a gravacao: o streamlink tenta de novo
    // antes de desistir.
    '--stream-segment-attempts', '5',
    url,
    QUALIDADES[qualidade] || QUALIDADES['480p'],
  ];
}

function argsFfmpeg(dir) {
  return [
    '-hide_banner', '-loglevel', 'error',
    '-i', 'pipe:0',
    '-map', '0:v:0', '-map', '0:a:0', '-c', 'copy',
    '-f', 'segment', '-segment_time', '10', '-reset_timestamps', '1',
    '-segment_list', path.join(dir, 'video.csv'), '-segment_list_type', 'csv',
    path.join(dir, 'seg_%06d.ts'),
    '-map', '0:a:0', '-ac', '1', '-ar', '16000', '-c:a', 'libopus', '-b:a', '32k',
    // reset_timestamps tambem no audio: sem ele cada bloco carrega o relogio
    // do anterior (o 2o bloco se dizia com 1 minuto de duracao), o que baguncava
    // a medida de silencio no fim do bloco.
    '-f', 'segment', '-segment_time', '30', '-reset_timestamps', '1',
    '-segment_list', path.join(dir, 'audio.csv'), '-segment_list_type', 'csv',
    path.join(dir, 'aud_%05d.ogg'),
  ];
}

function matarGrupo(filho, sinal) {
  if (!filho || filho.exitCode !== null || filho.signalCode !== null) return;
  try {
    process.kill(-filho.pid, sinal);
  } catch {
    // Grupo ja nao existe (terminou entre a checagem e o kill) - nada a fazer.
  }
}

// Inicia a gravacao. onFim({ motivo, codigo, pedidoParar, ultimasLinhas }) e
// chamado exatamente uma vez, quando os dois processos terminarem.
// url: endereco da live (plataformas.urlDaLive) - twitch.tv/... ou kick.com/...
function iniciar({ sessionId, url, dir, qualidade, onFim, spawnImpl = spawn }) {
  if (emAndamento.has(sessionId)) throw new Error(`Sessao ${sessionId} ja esta gravando.`);
  fs.mkdirSync(dir, { recursive: true });

  const streamlink = spawnImpl(config.lives.streamlinkPath, argsStreamlink(url, qualidade), {
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const ffmpeg = spawnImpl(FFMPEG, argsFfmpeg(dir), { detached: true, stdio: ['pipe', 'ignore', 'pipe'] });

  // Log do streamlink em arquivo (e as ultimas linhas em memoria): e onde
  // aparece "Stream ended" x erro de verdade, que decide o status da sessao.
  const logStream = fs.createWriteStream(path.join(dir, 'streamlink.log'), { flags: 'a' });
  const ultimas = [];
  const guardarLinha = (origem) => (buf) => {
    logStream.write(buf);
    for (const linha of String(buf).split('\n').filter(Boolean)) {
      ultimas.push(`${origem}: ${linha}`);
      if (ultimas.length > 20) ultimas.shift();
    }
  };
  streamlink.stderr.on('data', guardarLinha('streamlink'));
  ffmpeg.stderr.on('data', guardarLinha('ffmpeg'));

  // O ffmpeg pode morrer antes do streamlink: escrever num pipe fechado da
  // EPIPE, e EPIPE sem handler derruba o processo inteiro do worker.
  ffmpeg.stdin.on('error', () => {});
  streamlink.stdout.pipe(ffmpeg.stdin);

  let pedidoParar = null;
  let vivos = 2;
  let avisado = false;
  let codigoStreamlink = null;
  let resolverTermino;
  const terminou = new Promise((r) => { resolverTermino = r; });

  function aoTerminarUm(qual, codigo) {
    if (qual === 'streamlink') {
      codigoStreamlink = codigo;
      // Streamlink acabou: o ffmpeg recebe fim de arquivo e fecha o ultimo
      // pedaco sozinho. So forca se ele nao sair em 15s.
      setTimeout(() => matarGrupo(ffmpeg, 'SIGKILL'), 15_000).unref();
    } else {
      // ffmpeg morreu: nao adianta continuar baixando pra lugar nenhum.
      matarGrupo(streamlink, 'SIGTERM');
    }
    vivos -= 1;
    if (vivos > 0 || avisado) return;
    avisado = true;
    logStream.end();
    emAndamento.delete(sessionId);
    const texto = ultimas.join('\n');
    const fimNatural = /Stream ended|stream has ended|No playable streams|offline/i.test(texto);
    const motivo = pedidoParar || (fimNatural ? 'live terminou' : `gravacao caiu (streamlink ${codigoStreamlink})`);
    Promise.resolve()
      .then(() => onFim({ motivo, pedidoParar: Boolean(pedidoParar), fimNatural, codigo: codigoStreamlink, ultimasLinhas: texto }))
      .catch((err) => {
        logger.error(`Lives: falha ao encerrar a sessao ${sessionId}:`, err);
        errorReportService.report({
          operation: errorReportService.OPERACOES.LIVES,
          entityType: 'live_sessao',
          entityId: sessionId,
          error: err,
          message: `Falha ao encerrar a gravação: ${String(err.message).slice(0, 200)}`,
          contexto: { etapa: 'encerrar', motivo, codigoDoStreamlink: codigoStreamlink, ultimasLinhasDoGravador: texto },
        });
      })
      .finally(resolverTermino);
  }

  for (const [nome, filho] of [['streamlink', streamlink], ['ffmpeg', ffmpeg]]) {
    let fechou = false;
    const fim = (codigo) => {
      if (fechou) return;
      fechou = true;
      aoTerminarUm(nome, codigo);
    };
    filho.on('error', (err) => {
      ultimas.push(`${nome}: nao iniciou - ${err.message}`);
      fim(-1);
    });
    filho.on('close', (codigo) => fim(codigo));
  }

  function parar(motivo) {
    if (!pedidoParar) pedidoParar = motivo;
    // Parar pelo streamlink e o caminho limpo: o ffmpeg recebe o fim do
    // arquivo e fecha o pedaco que estava gravando. O SIGKILL e so a rede de
    // seguranca se algo nao responder.
    matarGrupo(streamlink, 'SIGTERM');
    const forcar = setTimeout(() => {
      matarGrupo(streamlink, 'SIGKILL');
      matarGrupo(ffmpeg, 'SIGKILL');
    }, 20_000);
    forcar.unref();
    return terminou;
  }

  emAndamento.set(sessionId, { parar, terminou });
  logger.info(`Lives: gravando ${url} (sessao ${sessionId}, ${qualidade}).`);
  return { parar, terminou };
}

function parar(sessionId, motivo) {
  const g = emAndamento.get(sessionId);
  return g ? g.parar(motivo) : Promise.resolve();
}

async function pararTodas(motivo) {
  await Promise.all([...emAndamento.values()].map((g) => g.parar(motivo)));
}

function gravando(sessionId) {
  return emAndamento.has(sessionId);
}

function quantasGravando() {
  return emAndamento.size;
}

module.exports = { iniciar, parar, pararTodas, gravando, quantasGravando, argsFfmpeg, argsStreamlink, QUALIDADES };
