// Video narrado a partir de um roteiro - MODO DE TESTE, so admin.
//
// A tela e o lugar onde a escolha entre "economico" e "qualidade" acontece, e
// ela e por video de proposito: o custo entre os dois modos praticamente
// dobra, e so gerando o MESMO roteiro nos dois da para saber se a diferenca
// visual justifica.
'use strict';

const fs = require('fs');
const roteiroEmCenas = require('../../../lib/roteiroEmCenas');
const narratedVideosRepository = require('../../../repositories/narratedVideosRepository');
const videoCostsRepository = require('../../../repositories/videoCostsRepository');
const queueService = require('../../../services/queueService');
const ttsService = require('../../../services/ttsService');
const narratedVideoJob = require('../../../worker/videoJobs/narratedVideoJob');
const logger = require('../../../lib/logger');

const QUEUE_NARRATED_VIDEO = 'narrated-video';

const ASPECTOS = ['16:9', '9:16'];
const POLITICAS = ['economico', 'qualidade'];
const PROVEDORES = ['openai', 'elevenlabs'];

// Teto de tamanho do roteiro. 20 mil caracteres sao ~28 minutos de narracao e
// ~85 cenas - ja acima do que o planejador de imagens aceita numa chamada so.
// O limite existe para a recusa vir AGORA, com o motivo escrito, em vez de o
// video falhar 10 minutos depois no meio da geracao.
const MAX_CHARS_ROTEIRO = 20_000;

function paraApi(v) {
  return {
    id: Number(v.id),
    title: v.title,
    aspect: v.aspect,
    imagePolicy: v.image_policy,
    voiceProvider: v.voice_provider,
    voiceId: v.voice_id,
    burnCaptions: v.burn_captions,
    musicMood: v.music_mood,
    status: v.status,
    progressPercent: v.progress_percent,
    durationSeconds: v.duration_seconds === null ? null : Number(v.duration_seconds),
    errorMessage: v.error_message,
    errorTransient: v.error_transient,
    attempts: v.attempts,
    createdAt: v.created_at,
    custoUsd: v.custo_usd === undefined || v.custo_usd === null ? null : Number(v.custo_usd),
    totalCenas: v.total_cenas === undefined ? null : Number(v.total_cenas),
    cenasIa: v.cenas_ia === undefined ? null : Number(v.cenas_ia),
    temArquivo: Boolean(v.video_path) && fs.existsSync(v.video_path),
  };
}

// As opcoes fixas vao juntas na MESMA resposta do GET e do POST. Regra que ja
// custou uma tela quebrada neste projeto: quando o front reusa a resposta pra
// atualizar o estado inteiro, um endpoint que devolve o objeto sem as opcoes
// faz a pagina quebrar no save seguinte.
function opcoes() {
  return {
    aspectos: ASPECTOS,
    politicas: POLITICAS,
    vozes: ttsService.VOZES_OPENAI,
    elevenlabsDisponivel: Boolean(require('../../../config').elevenlabs.apiKey),
    maxCharsRoteiro: MAX_CHARS_ROTEIRO,
    charsPorSegundo: roteiroEmCenas.CHARS_POR_SEGUNDO,
  };
}

async function list(req, res) {
  const videos = await narratedVideosRepository.listByOwner(req.session.user.id);
  res.json({ videos: videos.map(paraApi), options: opcoes() });
}

// Previa: quantas cenas o roteiro vai virar e quanto o video deve durar, SEM
// gastar nada. Serve para a pessoa ajustar o roteiro antes de pagar por ele.
async function preview(req, res) {
  const script = String(req.body?.script || '');
  const cenas = roteiroEmCenas.dividir(script);
  const segundos = cenas.reduce((s, c) => s + c.segundosEstimados, 0);
  res.json({
    cenas: cenas.length,
    chars: script.trim().length,
    segundosEstimados: Math.round(segundos),
    // Estimativa, e dita como tal na tela: a duracao real so existe depois que
    // a narracao existe.
    primeirasCenas: cenas.slice(0, 3).map((c) => c.text),
  });
}

async function create(req, res) {
  const title = String(req.body?.title || '').trim();
  const script = String(req.body?.script || '').trim();
  const aspect = ASPECTOS.includes(req.body?.aspect) ? req.body.aspect : '16:9';
  const imagePolicy = POLITICAS.includes(req.body?.imagePolicy) ? req.body.imagePolicy : 'economico';
  const voiceProvider = PROVEDORES.includes(req.body?.voiceProvider) ? req.body.voiceProvider : 'openai';
  const burnCaptions = req.body?.burnCaptions !== false;

  if (!title) return res.status(400).json({ error: 'Dê um nome para o vídeo.' });
  if (!script) return res.status(400).json({ error: 'Cole o roteiro do vídeo.' });
  if (script.length > MAX_CHARS_ROTEIRO) {
    return res.status(400).json({
      error: `O roteiro tem ${script.length} caracteres (máximo ${MAX_CHARS_ROTEIRO}). Divida em vídeos menores.`,
    });
  }
  if (roteiroEmCenas.dividir(script).length === 0) {
    return res.status(400).json({ error: 'Não consegui dividir esse roteiro em cenas. Confira o texto.' });
  }
  if (voiceProvider === 'elevenlabs' && !require('../../../config').elevenlabs.apiKey) {
    return res.status(400).json({ error: 'A voz da ElevenLabs ainda não está configurada.' });
  }

  const video = await narratedVideosRepository.create({
    adminUserId: req.session.user.id,
    title,
    script,
    aspect,
    imagePolicy,
    voiceProvider,
    voiceId: ttsService.vozValida(voiceProvider, req.body?.voiceId) || 'onyx',
    burnCaptions,
    musicMood: null,
  });

  const boss = await queueService.getBoss();
  await boss.send(QUEUE_NARRATED_VIDEO, { narratedVideoId: Number(video.id) });

  res.status(201).json({ video: paraApi(video), options: opcoes() });
}

async function detail(req, res) {
  const video = await narratedVideosRepository.findOwned(req.params.id, req.session.user.id);
  if (!video) return res.status(404).json({ error: 'Vídeo não encontrado.' });

  const [cenas, custo] = await Promise.all([
    narratedVideosRepository.listScenes(video.id),
    videoCostsRepository.doNarrado(video.id),
  ]);

  res.json({
    video: paraApi(video),
    // Os creditos das imagens ficam visiveis: CC BY exige atribuicao, e quem
    // publicar o video precisa saber o que citar.
    cenas: cenas.map((c) => ({
      idx: c.idx,
      text: c.text,
      durationSeconds: c.duration_seconds === null ? null : Number(c.duration_seconds),
      imageSource: c.image_source,
      imageQuery: c.image_query,
      imageLicense: c.image_license,
      imageCredit: c.image_credit,
    })),
    custo: custo
      ? {
          whisperUsd: Number(custo.whisper_usd),
          iaUsd: Number(custo.ia_usd),
          ttsUsd: Number(custo.tts_usd),
          imagemUsd: Number(custo.imagem_usd),
          totalUsd: Number(custo.whisper_usd) + Number(custo.ia_usd) + Number(custo.tts_usd) + Number(custo.imagem_usd),
        }
      : null,
    options: opcoes(),
  });
}

async function download(req, res) {
  const video = await narratedVideosRepository.findOwned(req.params.id, req.session.user.id);
  if (!video) return res.status(404).json({ error: 'Vídeo não encontrado.' });
  // Caminho gravado no banco nao e o mesmo que arquivo existindo em disco:
  // render interrompido deixa a coluna preenchida sem arquivo nenhum.
  if (!video.video_path || !fs.existsSync(video.video_path)) {
    return res.status(404).json({ error: 'O arquivo desse vídeo não está mais no servidor.' });
  }
  res.download(video.video_path, `${video.title.replace(/[^\p{L}\p{N} _-]/gu, '')}.mp4`);
}

async function remove(req, res) {
  const video = await narratedVideosRepository.remove(req.params.id, req.session.user.id);
  if (!video) return res.status(404).json({ error: 'Vídeo não encontrado.' });

  // Apagar a pasta inteira: imagens e audios de cena ocupam bem mais que o mp4
  // final (~17 MB por minuto so o video). O lancamento de custo sobrevive - a
  // coluna vira NULL por ON DELETE SET NULL.
  try {
    fs.rmSync(narratedVideoJob.pastaDoVideo(video.id), { recursive: true, force: true });
  } catch (err) {
    logger.error(`Falha ao apagar os arquivos do vídeo narrado #${video.id}:`, err.message);
  }

  res.json({ ok: true });
}

module.exports = { list, preview, create, detail, download, remove, MAX_CHARS_ROTEIRO };
