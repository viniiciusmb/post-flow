// Gera um video narrado a partir de um roteiro colado pelo usuario.
//
// Ordem das etapas, e por que ela e essa:
//
//   1. divide o roteiro em cenas          (deterministico, sem IA)
//   2. a IA planeja como ilustrar cada uma
//   3. gera a narracao CENA A CENA        <- ver migration 084
//   4. junta o audio e transcreve         (so para a legenda ter o tempo certo)
//   5. busca ou desenha a imagem de cada cena
//   6. monta o video
//
// A narracao vem antes das imagens de proposito: a duracao de cada cena so
// existe depois que a fala dela existe, e e ela que decide quanto tempo cada
// imagem fica no ar.
'use strict';

const fs = require('fs');
const path = require('path');
const config = require('../../config');
const logger = require('../../lib/logger');
const roteiroEmCenas = require('../../lib/roteiroEmCenas');
const { ehPassageiro } = require('../../lib/erroDeProcessamento');
const narratedVideosRepository = require('../../repositories/narratedVideosRepository');
const narrationScriptService = require('../../services/narrationScriptService');
const ttsService = require('../../services/ttsService');
const imageSearchService = require('../../services/imageSearchService');
const imageGenerationService = require('../../services/imageGenerationService');
const renderService = require('../../services/narratedVideoRenderService');
const openaiTranscriptionService = require('../../services/openaiTranscriptionService');
const custoService = require('../../services/custoService');

// Faixas de progresso por etapa. Sao aproximadas de proposito - o que a barra
// precisa e nunca andar para tras, nao ser exata.
const FAIXAS = { roteirizar: 5, narrar: 40, ilustrar: 70, montar: 100 };

const HEARTBEAT_MS = 60_000;
const TIMEOUT_DOWNLOAD_MS = 30_000;

function pastaDoVideo(id) {
  return path.join(config.videoProcessing.workDir, 'narrado', String(id));
}

// Sinal de vida enquanto o job roda. Sem ele, um deploy no meio da geracao
// deixaria o video preso num status "em andamento" para sempre - foi o que
// motivou o processing_heartbeat_at de source_videos.
function iniciarHeartbeat(id) {
  const timer = setInterval(() => {
    narratedVideosRepository.touchHeartbeat(id).catch((err) =>
      logger.error(`Falha ao bater o sinal de vida do vídeo narrado #${id}:`, err.message)
    );
  }, HEARTBEAT_MS);
  timer.unref();
  return timer;
}

async function baixarImagem(url, destino) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_DOWNLOAD_MS);
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': `PostFlow/1.0 (${require('../../config/constants').CONTACT.supportEmail})` },
      signal: controller.signal,
    });
    if (!r.ok) throw new Error(`download da imagem falhou (${r.status})`);
    fs.writeFileSync(destino, Buffer.from(await r.arrayBuffer()));
    return destino;
  } finally {
    clearTimeout(timer);
  }
}

// Decide a imagem de UMA cena, respeitando a politica escolhida no formulario.
//
//   economico - acervo primeiro sempre; IA so quando a busca volta vazia.
//   qualidade - respeita o palpite da IA sobre onde a cena fica melhor, mas
//               continua caindo para o outro lado quando o preferido falha.
//
// Nos DOIS modos a IA e o fundo do poco: foi medido que 3 de 6 buscas da
// amostra voltaram vazias, e uma cena sem imagem e um buraco preto no video.
async function resolverImagem(cena, { policy, aspect, pasta, usadas }) {
  const destino = path.join(pasta, `img${cena.idx}.jpg`);
  const preferirIa = policy === 'qualidade' && cena.image_prompt && cena.preferir === 'ia';

  if (!preferirIa && cena.image_query) {
    const achada = await imageSearchService.buscar(cena.image_query, { usadas });
    if (achada) {
      await baixarImagem(achada.url, destino);
      return {
        imageSource: 'acervo',
        imagePath: destino,
        imageUrl: achada.url,
        imageLicense: achada.license,
        imageCredit: achada.credit,
        custoUsd: 0,
      };
    }
  }

  if (cena.image_prompt) {
    const gerada = await imageGenerationService.gerar(cena.image_prompt, destino, { aspect });
    return {
      imageSource: 'ia',
      imagePath: destino,
      imageUrl: null,
      imageLicense: gerada.license,
      imageCredit: gerada.credit,
      custoUsd: gerada.custoUsd,
    };
  }

  // Preferiu IA mas nao ha prompt: ainda da para tentar o acervo antes de
  // desistir da cena.
  if (preferirIa && cena.image_query) {
    const achada = await imageSearchService.buscar(cena.image_query, { usadas });
    if (achada) {
      await baixarImagem(achada.url, destino);
      return {
        imageSource: 'acervo',
        imagePath: destino,
        imageUrl: achada.url,
        imageLicense: achada.license,
        imageCredit: achada.credit,
        custoUsd: 0,
      };
    }
  }

  return null;
}

async function run(narratedVideoId) {
  // Posse atomica: so quem muda a linha continua. Ver claimForProcessing.
  const video = await narratedVideosRepository.claimForProcessing(narratedVideoId);
  if (!video) {
    logger.info(`Vídeo narrado #${narratedVideoId} já está sendo gerado (ou não está na fila) - ignorando.`);
    return;
  }

  const pasta = pastaDoVideo(video.id);
  fs.mkdirSync(pasta, { recursive: true });
  const heartbeat = iniciarHeartbeat(video.id);

  try {
    // ---- 1 e 2: cenas + plano de imagens --------------------------------
    const blocos = roteiroEmCenas.dividir(video.script);
    if (blocos.length === 0) throw new Error('O roteiro está vazio.');

    const plano = await narrationScriptService.planejarIlustracoes(blocos, { titulo: video.title });
    await custoService.registrarNarrado(video, { iaUsd: plano.costUsd });
    await narratedVideosRepository.replaceScenes(video.id, plano.cenas);
    await narratedVideosRepository.setProgress(video.id, FAIXAS.roteirizar);

    // ---- 3: narracao, cena a cena ---------------------------------------
    await narratedVideosRepository.setStatus(video.id, 'narrando', { progressPercent: FAIXAS.roteirizar });
    const cenas = await narratedVideosRepository.listScenes(video.id);

    const audiosProntos = [];
    let charsNarrados = 0;
    let segundosNarrados = 0;

    for (let i = 0; i < cenas.length; i += 1) {
      const cena = cenas[i];
      const bruto = path.join(pasta, `fala${cena.idx}.mp3`);
      const pronto = path.join(pasta, `fala${cena.idx}.m4a`);

      await ttsService.gerarNarracao(cena.text, bruto, {
        provider: video.voice_provider,
        voiceId: video.voice_id,
      });
      // Padroniza e acrescenta a pausa. A duracao devolvida AQUI e a verdade
      // sobre quanto tempo esta cena ocupa - nada e alinhado depois.
      const duracao = await renderService.prepararAudioDaCena(bruto, pronto);
      fs.rmSync(bruto, { force: true });

      await narratedVideosRepository.updateScene(cena.id, { audioPath: pronto, durationSeconds: duracao });
      audiosProntos.push({ path: pronto, duration: duracao });
      charsNarrados += cena.text.length;
      segundosNarrados += duracao;

      await narratedVideosRepository.setProgress(
        video.id,
        FAIXAS.roteirizar + ((FAIXAS.narrar - FAIXAS.roteirizar) * (i + 1)) / cenas.length
      );
    }

    await custoService.registrarNarrado(video, {
      ttsUsd: ttsService.custoDaNarracao(video.voice_provider, {
        chars: charsNarrados,
        audioSeconds: segundosNarrados,
      }),
      videoSeconds: segundosNarrados,
    });

    // ---- 4: junta o audio e transcreve para a legenda --------------------
    const audioPath = path.join(pasta, 'narracao.m4a');
    // juntarAudio ja devolve a duracao do arquivo final - medir de novo aqui
    // seria uma segunda fonte para o mesmo numero.
    const duracaoTotal = await renderService.juntarAudio(audiosProntos.map((a) => a.path), audioPath);

    let legendaPath = null;
    if (video.burn_captions) {
      const transcricao = await openaiTranscriptionService.transcribeAudio(audioPath);
      await custoService.registrarNarrado(video, { whisperUsd: transcricao.costUsd });
      legendaPath = renderService.montarLegenda(
        transcricao.words,
        renderService.SAIDAS[video.aspect] || renderService.SAIDAS['16:9'],
        path.join(pasta, 'legenda.ass')
      );
    }

    // ---- 5: imagens ------------------------------------------------------
    await narratedVideosRepository.setStatus(video.id, 'ilustrando', { progressPercent: FAIXAS.narrar });
    const usadas = new Set();
    let custoImagens = 0;
    const cenasComImagem = [];

    for (let i = 0; i < cenas.length; i += 1) {
      const cena = cenas[i];
      let escolhida = null;
      try {
        escolhida = await resolverImagem({ ...cena, preferir: plano.cenas[i]?.preferir }, {
          policy: video.image_policy,
          aspect: video.aspect,
          pasta,
          usadas,
        });
      } catch (err) {
        // Falhar UMA imagem nao pode derrubar o video inteiro: a cena herda a
        // imagem da anterior, que e muito melhor que perder 10 minutos de
        // narracao ja paga.
        logger.error(`Falha na imagem da cena ${cena.idx} do vídeo narrado #${video.id}:`, err.message);
      }

      if (escolhida) {
        custoImagens += escolhida.custoUsd || 0;
        await narratedVideosRepository.updateScene(cena.id, escolhida);
        cenasComImagem.push({ imagePath: escolhida.imagePath, duration: Number(audiosProntos[i].duration) });
      } else {
        const anterior = cenasComImagem[cenasComImagem.length - 1];
        if (!anterior) throw new Error('Não foi possível obter nenhuma imagem para o vídeo.');
        cenasComImagem.push({ imagePath: anterior.imagePath, duration: Number(audiosProntos[i].duration) });
      }

      await narratedVideosRepository.setProgress(
        video.id,
        FAIXAS.narrar + ((FAIXAS.ilustrar - FAIXAS.narrar) * (i + 1)) / cenas.length
      );
    }

    await custoService.registrarNarrado(video, { imagemUsd: custoImagens, videoSeconds: duracaoTotal });

    // ---- 6: montagem -----------------------------------------------------
    await narratedVideosRepository.setStatus(video.id, 'montando', { progressPercent: FAIXAS.ilustrar });
    const destino = path.join(pasta, 'video.mp4');

    await renderService.renderizar({
      cenas: cenasComImagem,
      audioPath,
      legendaPath,
      musicaPath: null,
      aspect: video.aspect,
      destino,
      onProgress: (pct) => {
        narratedVideosRepository
          .setProgress(video.id, FAIXAS.ilustrar + ((FAIXAS.montar - FAIXAS.ilustrar) * pct) / 100)
          // Sem o catch, um erro transitorio de banco dentro do polling do
          // ffmpeg vira unhandled rejection e derruba o worker inteiro - ja
          // aconteceu neste projeto.
          .catch((err) => logger.error('Falha ao gravar o progresso:', err.message));
      },
    });

    await narratedVideosRepository.setStatus(video.id, 'pronto', {
      progressPercent: 100,
      durationSeconds: duracaoTotal,
      videoPath: destino,
      audioPath,
    });
    logger.info(`Vídeo narrado #${video.id} pronto (${duracaoTotal.toFixed(1)}s).`);
  } catch (err) {
    // Classificado AQUI, com o erro em maos - nunca reconstituido lendo texto
    // de volta do banco. Terceira vez que esta licao aparece no projeto.
    const passageiro = ehPassageiro(err);
    await narratedVideosRepository.setStatus(video.id, 'erro', {
      errorMessage: err.message?.slice(0, 500) || 'Falha desconhecida',
      errorTransient: passageiro,
    });
    logger.error(`Falha ao gerar o vídeo narrado #${video.id} (${passageiro ? 'passageiro' : 'permanente'}):`, err.message);
    throw err;
  } finally {
    clearInterval(heartbeat);
  }
}

module.exports = { run, resolverImagem, pastaDoVideo, FAIXAS };
