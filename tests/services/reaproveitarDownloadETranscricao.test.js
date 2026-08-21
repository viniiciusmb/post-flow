// Reaproveitar o download e a transcrição entre clientes que monitoram o
// mesmo canal do YouTube.
//
// Dois clientes que monitoram o canal "TOGURO" viram dois source_videos para o
// MESMO vídeo do YouTube — e antes disso o mesmo arquivo era baixado duas
// vezes e mandado pro Whisper duas vezes. Baixar e transcrever são os dois
// maiores custos do sistema, e são exatamente as duas etapas cujo resultado é
// idêntico para todo mundo: é o mesmo vídeo.
//
// O que estes testes travam:
//   - o segundo cliente NÃO baixa e NÃO chama o Whisper;
//   - mas continua pagando exatamente o mesmo crédito (a economia é de custo
//     nosso, não desconto pra ele) e recebendo os cortes dele, com a IA de
//     seleção rodando individualmente;
//   - o arquivo compartilhado sobrevive ao fim do processamento do primeiro
//     cliente (senão o segundo baixaria de novo, e o sistema não teria efeito
//     nenhum);
//   - e sobrevive também à exclusão do vídeo por um dos clientes.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const pool = require('../../src/db/pool');
const config = require('../../src/config');
const processVideoJob = require('../../src/worker/videoJobs/processVideoJob');
const sourceVideosRepository = require('../../src/repositories/sourceVideosRepository');
const sharedVideoAssetsRepository = require('../../src/repositories/sharedVideoAssetsRepository');
const clipsRepository = require('../../src/repositories/clipsRepository');
const sharedVideoFiles = require('../../src/lib/sharedVideoFiles');
const ytDlpService = require('../../src/services/ytDlpService');
const videoEditingService = require('../../src/services/videoEditingService');
const openaiTranscriptionService = require('../../src/services/openaiTranscriptionService');
const claudeClipSelectionService = require('../../src/services/claudeClipSelectionService');
const { createClient, createYoutubeChannel, giveCredits, readCredits } = require('../helpers/db');

const workDirOriginal = config.videoProcessing.workDir;
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'postflow-compartilhado-'));
config.videoProcessing.workDir = workDir;

test.after(async () => {
  config.videoProcessing.workDir = workDirOriginal;
  fs.rmSync(workDir, { recursive: true, force: true });
  await pool.end();
});

// Palavras de mentira, mas com a mesma forma que o Whisper devolve - é o que
// o resto do pipeline consome.
const PALAVRAS = [
  { word: 'ola', start: 0, end: 0.5 },
  { word: 'mundo', start: 0.5, end: 1.2 },
];

// Substitui as 4 etapas caras (yt-dlp, ffmpeg, Whisper, Claude) por versões
// que escrevem arquivos de verdade em disco e contam quantas vezes foram
// chamadas. O que este teste precisa provar é justamente quantas vezes cada
// uma roda.
function comEtapasFalsas(fn) {
  const originais = {
    downloadVideo: ytDlpService.downloadVideo,
    extractAudio: videoEditingService.extractAudio,
    renderClip: videoEditingService.renderClip,
    extractThumbnail: videoEditingService.extractThumbnail,
    transcribeAudio: openaiTranscriptionService.transcribeAudio,
    selectClips: claudeClipSelectionService.selectClips,
  };
  const chamadas = { download: 0, whisper: 0, claude: 0, render: 0 };

  ytDlpService.downloadVideo = async (videoId, outputDir) => {
    chamadas.download += 1;
    fs.mkdirSync(outputDir, { recursive: true });
    const filePath = path.join(outputDir, `${videoId}.mp4`);
    fs.writeFileSync(filePath, Buffer.alloc(4096, 7)); // 4 KB de "vídeo"
    return { filePath, egressType: 'founder_tunnel', tunnelId: null };
  };
  videoEditingService.extractAudio = async (_videoPath, audioPath) => {
    fs.writeFileSync(audioPath, 'audio');
  };
  openaiTranscriptionService.transcribeAudio = async () => {
    chamadas.whisper += 1;
    return { text: 'ola mundo', words: PALAVRAS, durationSeconds: 600, costUsd: 0.36, language: 'pt' };
  };
  claudeClipSelectionService.selectClips = async () => {
    chamadas.claude += 1;
    return {
      clips: [{ title: 'Corte 1', description: 'desc', startSeconds: 0, endSeconds: 30 }],
      inputTokens: 10,
      outputTokens: 5,
      costUsd: 0.01,
    };
  };
  videoEditingService.renderClip = async ({ videoPath, outputPath }) => {
    chamadas.render += 1;
    // Prova que o corte leu o arquivo que o pipeline entregou - se o
    // compartilhamento apontasse pro lugar errado, quebraria aqui.
    assert.ok(fs.existsSync(videoPath), `renderClip recebeu um caminho que não existe: ${videoPath}`);
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
async function videoDeCanal(clienteId, canalId, youtubeVideoId) {
  contador += 1;
  const { rows } = await pool.query(
    `INSERT INTO source_videos
       (youtube_channel_id, owner_client_user_id, youtube_video_id, title, status, input_type, duration_seconds)
     VALUES ($1, $2, $3, $4, 'detected', 'channel', 600) RETURNING *`,
    [canalId, clienteId, youtubeVideoId, `Video de teste ${contador}`]
  );
  return rows[0];
}

async function clienteMonitorando(youtubeChannelId) {
  const cliente = await createClient();
  await giveCredits(cliente.id, { quotaNormal: 1000 });
  const canal = await createYoutubeChannel(cliente.id, { channelId: youtubeChannelId });
  return { cliente, canal };
}

test('dois clientes no mesmo canal: baixa e transcreve UMA vez, corta duas', async () => {
  const canalDoYoutube = `UC_toguro_${Date.now()}`;
  const videoDoYoutube = `vid_${Date.now()}`;

  const a = await clienteMonitorando(canalDoYoutube);
  const b = await clienteMonitorando(canalDoYoutube);

  const videoA = await videoDeCanal(a.cliente.id, a.canal.id, videoDoYoutube);
  const videoB = await videoDeCanal(b.cliente.id, b.canal.id, videoDoYoutube);

  await comEtapasFalsas(async (chamadas) => {
    await processVideoJob.run(videoA.id);

    assert.equal(chamadas.download, 1, 'o primeiro cliente tem que baixar');
    assert.equal(chamadas.whisper, 1, 'o primeiro cliente tem que transcrever');

    // O arquivo saiu da pasta do vídeo e foi pra pasta compartilhada - é isso
    // que permite o segundo cliente encontrá-lo.
    const depoisDeA = await sourceVideosRepository.findById(videoA.id);
    assert.equal(depoisDeA.status, 'ready');
    assert.ok(sharedVideoFiles.isShared(depoisDeA.local_video_path), 'o vídeo tinha que estar na pasta compartilhada');
    assert.ok(
      fs.existsSync(depoisDeA.local_video_path),
      'o arquivo compartilhado NÃO pode ser apagado no fim do processamento - o segundo cliente ainda vai usá-lo'
    );

    await processVideoJob.run(videoB.id);

    assert.equal(chamadas.download, 1, 'o segundo cliente NÃO pode baixar de novo');
    assert.equal(chamadas.whisper, 1, 'o segundo cliente NÃO pode chamar o Whisper de novo');
    // A partir da transcrição tudo volta a ser individual: cada cliente
    // configura os cortes do jeito dele.
    assert.equal(chamadas.claude, 2, 'a escolha dos trechos continua individual');
    assert.equal(chamadas.render, 2, 'cada cliente recebe o corte dele');
  });

  const depoisDeB = await sourceVideosRepository.findById(videoB.id);
  assert.equal(depoisDeB.status, 'ready');
  assert.equal(depoisDeB.download_egress_type, 'reuse');
  assert.equal(Number(depoisDeB.download_bytes), 0, 'reaproveitar não gasta banda nenhuma');
  assert.equal(depoisDeB.transcript_reused, true);
  assert.equal(Number(depoisDeB.whisper_cost_usd), 0, 'o Whisper não foi chamado, então o custo é zero');
  // A transcrição chegou inteira, não só a marca de que foi reaproveitada.
  assert.deepEqual(depoisDeB.transcript_words, PALAVRAS);
  assert.equal(depoisDeB.transcript_language, 'pt');

  const cortesB = await clipsRepository.listBySourceVideoId(videoB.id);
  assert.equal(cortesB.length, 1);
  assert.equal(cortesB[0].status, 'ready');

  // Contadores de medição (painel "Banda").
  const asset = await sharedVideoAssetsRepository.findByYoutubeVideoId(videoDoYoutube);
  assert.equal(asset.download_reuse_count, 1);
  assert.equal(asset.transcript_reuse_count, 1);
  assert.equal(Number(asset.video_bytes), 4096);
});

test('quem reaproveita paga exatamente o mesmo crédito', async () => {
  const canalDoYoutube = `UC_preco_${Date.now()}`;
  const videoDoYoutube = `vid_preco_${Date.now()}`;

  const a = await clienteMonitorando(canalDoYoutube);
  const b = await clienteMonitorando(canalDoYoutube);

  const videoA = await videoDeCanal(a.cliente.id, a.canal.id, videoDoYoutube);
  const videoB = await videoDeCanal(b.cliente.id, b.canal.id, videoDoYoutube);

  await comEtapasFalsas(async () => {
    await processVideoJob.run(videoA.id);
    await processVideoJob.run(videoB.id);
  });

  const creditoA = await readCredits(a.cliente.id);
  const creditoB = await readCredits(b.cliente.id);

  // 600s = 10 minutos, para os dois.
  assert.equal(creditoA.used_normal, 10);
  assert.equal(
    creditoB.used_normal,
    10,
    'reaproveitar é economia de custo nosso, não desconto pro cliente - ele paga o mesmo'
  );

  // E o lançamento fica registrado como confirmado nos dois casos.
  const { rows } = await pool.query(
    'SELECT status, minutes_charged FROM credit_transactions WHERE source_video_id = $1',
    [videoB.id]
  );
  assert.equal(rows[0].status, 'confirmado');
  assert.equal(rows[0].minutes_charged, 10);
});

test('cliente com o próprio túnel não é empurrado pro bolso caro ao reaproveitar', async () => {
  const canalDoYoutube = `UC_bonus_${Date.now()}`;
  const videoDoYoutube = `vid_bonus_${Date.now()}`;

  const a = await clienteMonitorando(canalDoYoutube);
  const b = await clienteMonitorando(canalDoYoutube);
  await giveCredits(b.cliente.id, { quotaNormal: 1000, quotaBonus: 1000 });

  // O cliente B tem o programa dele conectado: a cota dele é a bônus (mais
  // barata). Reaproveitar não pode tirar isso dele - o egress 'reuse' não é
  // "saiu pela nossa internet", é "não saiu por internet nenhuma".
  await pool.query(
    `INSERT INTO download_tunnels (owner_type, client_user_id, label, public_key, assigned_port, connected, enabled)
     VALUES ('client', $1, 'PC do B', $2, $3, true, true)`,
    [b.cliente.id, `chave-bonus-${Date.now()}`, 41000 + (Date.now() % 1000)]
  );

  const videoA = await videoDeCanal(a.cliente.id, a.canal.id, videoDoYoutube);
  const videoB = await videoDeCanal(b.cliente.id, b.canal.id, videoDoYoutube);

  await comEtapasFalsas(async () => {
    await processVideoJob.run(videoA.id);
    await processVideoJob.run(videoB.id);
  });

  const creditoB = await readCredits(b.cliente.id);
  assert.equal(creditoB.used_bonus, 10, 'o bolso bônus é o que tem que ser debitado');
  assert.equal(creditoB.used_normal, 0, 'o bolso normal (mais caro) não pode ser tocado');
});

test('excluir o vídeo em um cliente não apaga o arquivo que o outro vai usar', async () => {
  const canalDoYoutube = `UC_excluir_${Date.now()}`;
  const videoDoYoutube = `vid_excluir_${Date.now()}`;

  const a = await clienteMonitorando(canalDoYoutube);
  const b = await clienteMonitorando(canalDoYoutube);
  const videoA = await videoDeCanal(a.cliente.id, a.canal.id, videoDoYoutube);
  const videoB = await videoDeCanal(b.cliente.id, b.canal.id, videoDoYoutube);

  await comEtapasFalsas(async (chamadas) => {
    await processVideoJob.run(videoA.id);
    const asset = await sharedVideoAssetsRepository.findByYoutubeVideoId(videoDoYoutube);

    // O cliente A exclui o vídeo dele pela tela (é o mesmo caminho que o
    // controller usa: apaga a linha e os arquivos que são dele).
    await sourceVideosRepository.deleteById(videoA.id);
    fs.rmSync(path.join(workDir, String(videoA.id)), { recursive: true, force: true });

    assert.ok(
      fs.existsSync(asset.local_video_path),
      'a exclusão de um cliente não pode levar junto o arquivo compartilhado'
    );

    await processVideoJob.run(videoB.id);
    assert.equal(chamadas.download, 1, 'o cliente B ainda tem que conseguir reaproveitar');
  });
});

test('arquivo compartilhado sumiu do disco: baixa de novo em vez de quebrar', async () => {
  const canalDoYoutube = `UC_sumiu_${Date.now()}`;
  const videoDoYoutube = `vid_sumiu_${Date.now()}`;

  const a = await clienteMonitorando(canalDoYoutube);
  const b = await clienteMonitorando(canalDoYoutube);
  const videoA = await videoDeCanal(a.cliente.id, a.canal.id, videoDoYoutube);
  const videoB = await videoDeCanal(b.cliente.id, b.canal.id, videoDoYoutube);

  await comEtapasFalsas(async (chamadas) => {
    await processVideoJob.run(videoA.id);

    // Alguém apagou o arquivo por fora (limpeza de disco, volume perdido num
    // deploy). A linha no banco ainda aponta pra ele.
    const asset = await sharedVideoAssetsRepository.findByYoutubeVideoId(videoDoYoutube);
    fs.rmSync(asset.local_video_path, { force: true });

    await processVideoJob.run(videoB.id);

    assert.equal(chamadas.download, 2, 'sem o arquivo, tem que baixar de novo');
    // Mas a transcrição continua guardada: ela não depende do arquivo.
    assert.equal(chamadas.whisper, 1, 'a transcrição guardada dispensa o Whisper mesmo sem o arquivo');
  });

  const depoisDeB = await sourceVideosRepository.findById(videoB.id);
  assert.equal(depoisDeB.status, 'ready');
  assert.equal(depoisDeB.download_egress_type, 'founder_tunnel', 'baixou de verdade, então o egress é o real');
  assert.equal(depoisDeB.transcript_reused, true);
});

test('vídeo avulso (sem canal) continua funcionando e não vai pro compartilhado', async () => {
  const cliente = await createClient();
  await giveCredits(cliente.id, { quotaNormal: 1000 });

  // Upload direto: o arquivo já está em disco e não tem youtube_video_id.
  const arquivo = path.join(workDir, `upload-${Date.now()}.mp4`);
  fs.writeFileSync(arquivo, Buffer.alloc(2048, 3));
  const { rows } = await pool.query(
    `INSERT INTO source_videos
       (client_user_id, owner_client_user_id, input_type, title, local_video_path, duration_seconds, status)
     VALUES ($1, $1, 'upload', 'Enviado do computador', $2, 600, 'detected') RETURNING *`,
    [cliente.id, arquivo]
  );
  const video = rows[0];

  await comEtapasFalsas(async (chamadas) => {
    await processVideoJob.run(video.id);
    assert.equal(chamadas.download, 0, 'upload não baixa nada');
    assert.equal(chamadas.whisper, 1);
  });

  const depois = await sourceVideosRepository.findById(video.id);
  assert.equal(depois.status, 'ready');
  assert.equal(depois.transcript_reused, false);
  // O arquivo enviado continua sendo apagado no fim (esse não é compartilhado).
  assert.equal(fs.existsSync(arquivo), false, 'o arquivo do upload tem que ser apagado como sempre foi');
});
