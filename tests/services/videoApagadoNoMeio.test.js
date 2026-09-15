// Cliente apaga o vídeo enquanto ele está sendo processado.
//
// Aconteceu de verdade em 15/09/2026: um cliente apagou o #2006 durante a
// transcrição e o #2008 durante o corte. O pipeline não percebia (a linha
// sumida contava como "não pediu pausa"), seguia gastando Whisper e IA, e cada
// corte quebrava com ENOENT porque a pasta tinha sido apagada junto - 7 "erros
// abertos" no painel do admin que não eram defeito nenhum.
//
// O que estes testes travam:
//   - apagar no meio da transcrição para o vídeo sem chamar a IA nem cortar;
//   - apagar no meio dos cortes para no corte em que estava, sem tentar os
//     seguintes;
//   - nos dois casos, nada vai pro painel de erros.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const pool = require('../../src/db/pool');
const config = require('../../src/config');
const processVideoJob = require('../../src/worker/videoJobs/processVideoJob');
const ytDlpService = require('../../src/services/ytDlpService');
const videoEditingService = require('../../src/services/videoEditingService');
const openaiTranscriptionService = require('../../src/services/openaiTranscriptionService');
const claudeClipSelectionService = require('../../src/services/claudeClipSelectionService');
const { createClient, createYoutubeChannel, giveCredits } = require('../helpers/db');

const workDirOriginal = config.videoProcessing.workDir;
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'postflow-apagado-'));
config.videoProcessing.workDir = workDir;

test.after(async () => {
  config.videoProcessing.workDir = workDirOriginal;
  fs.rmSync(workDir, { recursive: true, force: true });
  await pool.end();
});

const PALAVRAS = [
  { word: 'ola', start: 0, end: 0.5 },
  { word: 'mundo', start: 0.5, end: 1.2 },
];

// O que o botão "Excluir" faz: apaga a linha e a pasta de trabalho do vídeo.
async function apagarComoOCliente(sourceVideoId) {
  await pool.query('DELETE FROM source_videos WHERE id = $1', [sourceVideoId]);
  fs.rmSync(path.join(workDir, String(sourceVideoId)), { recursive: true, force: true });
}

function erroDeArquivoSumido(caminho) {
  const err = new Error(`ENOENT: no such file or directory, open '${caminho}'`);
  err.code = 'ENOENT';
  return err;
}

function comEtapasFalsas({ aoTranscrever, aoCortar }, fn) {
  const originais = {
    downloadVideo: ytDlpService.downloadVideo,
    extractAudio: videoEditingService.extractAudio,
    renderClip: videoEditingService.renderClip,
    extractThumbnail: videoEditingService.extractThumbnail,
    transcribeAudio: openaiTranscriptionService.transcribeAudio,
    selectClips: claudeClipSelectionService.selectClips,
  };
  const chamadas = { whisper: 0, claude: 0, render: 0 };

  ytDlpService.downloadVideo = async (videoId, outputDir) => {
    fs.mkdirSync(outputDir, { recursive: true });
    const filePath = path.join(outputDir, `${videoId}.mp4`);
    fs.writeFileSync(filePath, Buffer.alloc(4096, 7));
    return { filePath, egressType: 'founder_tunnel', tunnelId: null };
  };
  videoEditingService.extractAudio = async (_videoPath, audioPath) => {
    fs.writeFileSync(audioPath, 'audio');
  };
  openaiTranscriptionService.transcribeAudio = async (audioPath) => {
    chamadas.whisper += 1;
    if (aoTranscrever) await aoTranscrever(audioPath);
    return { text: 'ola mundo', words: PALAVRAS, durationSeconds: 600, costUsd: 0.36, language: 'pt' };
  };
  claudeClipSelectionService.selectClips = async () => {
    chamadas.claude += 1;
    return {
      clips: [
        { title: 'Corte 1', description: 'desc', startSeconds: 0, endSeconds: 30 },
        { title: 'Corte 2', description: 'desc', startSeconds: 30, endSeconds: 60 },
        { title: 'Corte 3', description: 'desc', startSeconds: 60, endSeconds: 90 },
      ],
      inputTokens: 10,
      outputTokens: 5,
      costUsd: 0.01,
    };
  };
  videoEditingService.renderClip = async ({ outputPath }) => {
    chamadas.render += 1;
    if (aoCortar) await aoCortar(outputPath, chamadas.render);
    fs.writeFileSync(outputPath, 'corte');
  };
  videoEditingService.extractThumbnail = async (_out, thumbPath) => {
    fs.writeFileSync(thumbPath, 'capa');
  };

  return fn(chamadas).finally(() => {
    Object.assign(ytDlpService, { downloadVideo: originais.downloadVideo });
    Object.assign(videoEditingService, {
      extractAudio: originais.extractAudio,
      renderClip: originais.renderClip,
      extractThumbnail: originais.extractThumbnail,
    });
    Object.assign(openaiTranscriptionService, { transcribeAudio: originais.transcribeAudio });
    Object.assign(claudeClipSelectionService, { selectClips: originais.selectClips });
  });
}

let contador = 0;
async function videoNovo() {
  contador += 1;
  const cliente = await createClient();
  await giveCredits(cliente.id, { quotaNormal: 1000 });
  const canal = await createYoutubeChannel(cliente.id, { channelId: `UC_apagado_${process.pid}_${Date.now()}_${contador}` });
  const { rows } = await pool.query(
    `INSERT INTO source_videos
       (youtube_channel_id, owner_client_user_id, youtube_video_id, title, status, input_type, duration_seconds)
     VALUES ($1, $2, $3, $4, 'detected', 'channel', 600) RETURNING *`,
    [canal.id, cliente.id, `vid_apagado_${process.pid}_${Date.now()}_${contador}`, `Video ${contador}`]
  );
  return rows[0];
}

// Erros registrados para o vídeo ou para qualquer corte que ele teve.
async function errosRegistradosDesde(inicio, clientUserId) {
  const { rows } = await pool.query(
    `SELECT entity_type, entity_id, message FROM system_errors
      WHERE client_user_id = $1 AND last_seen_at >= $2`,
    [clientUserId, inicio]
  );
  return rows;
}

test('apagado durante a transcrição: para ali, sem IA, sem corte e sem erro no painel', async () => {
  const video = await videoNovo();
  const inicio = new Date();

  await comEtapasFalsas(
    {
      // O cliente clica em Excluir enquanto o Whisper lê o áudio - e a leitura
      // quebra porque a pasta sumiu, que é exatamente o que se viu no #2006.
      aoTranscrever: async (audioPath) => {
        await apagarComoOCliente(video.id);
        throw erroDeArquivoSumido(audioPath);
      },
    },
    async (chamadas) => {
      await processVideoJob.run(video.id);
      assert.equal(chamadas.claude, 0, 'não pode pagar a IA por um vídeo que não existe mais');
      assert.equal(chamadas.render, 0);
    }
  );

  const erros = await errosRegistradosDesde(inicio, video.owner_client_user_id);
  assert.deepEqual(erros, [], 'apagar o vídeo não é defeito - não pode ir pro painel de erros');
});

test('apagado durante os cortes: para no corte em que estava e não tenta os seguintes', async () => {
  const video = await videoNovo();
  const inicio = new Date();

  await comEtapasFalsas(
    {
      aoCortar: async (outputPath, numero) => {
        if (numero === 1) {
          await apagarComoOCliente(video.id);
          throw erroDeArquivoSumido(outputPath.replace(/\.mp4$/, '.ass'));
        }
      },
    },
    async (chamadas) => {
      await processVideoJob.run(video.id);
      assert.equal(chamadas.render, 1, 'os cortes seguintes não podem ser tentados depois de o vídeo sumir');
    }
  );

  const erros = await errosRegistradosDesde(inicio, video.owner_client_user_id);
  assert.deepEqual(erros, [], 'nenhum "erro de corte" por causa de um vídeo apagado');
});

test('um corte que falha de verdade (vídeo ainda existe) continua indo pro painel', async () => {
  // O outro lado da regra: parar de reportar só pode acontecer quando o vídeo
  // sumiu. Sem este teste, "nunca reportar erro de corte" passaria nos dois
  // testes acima.
  const video = await videoNovo();
  const inicio = new Date();

  await comEtapasFalsas(
    {
      aoCortar: async (_outputPath, numero) => {
        if (numero === 1) throw new Error('ffmpeg saiu com codigo 1');
      },
    },
    async (chamadas) => {
      await processVideoJob.run(video.id);
      assert.equal(chamadas.render, 3, 'um corte com defeito não impede os outros');
    }
  );

  const erros = await errosRegistradosDesde(inicio, video.owner_client_user_id);
  assert.equal(erros.filter((e) => e.entity_type === 'clip').length, 1);
});
