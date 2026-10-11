// Feed de cortes (08/10/2026): o cliente passa pelos cortes prontos da conta
// dele - os do YouTube e os das LIVES - como num feed de rede social, marca os
// que gostou e manda os escolhidos pra fila de publicação das contas que ele
// marcar.
//
// Enviar pro TikTok usa a MESMA criação de postagem do resto do sistema
// (postingsRepository.createIfNotExists): o horário sai da fila da conta, a
// ordem por vídeo é mantida e a publicação automática da conta continua
// decidindo se sai sozinho. O feed só escolhe O QUE e PRA ONDE.
//
// Instagram e Facebook (10/10/2026) vão pela fila própria (social_postings) e
// publicam na hora, pela Outstand - ver socialPostingService.
'use strict';

const clipsRepository = require('../../../repositories/clipsRepository');
const feedRepository = require('../../../repositories/feedRepository');
const livesRepository = require('../../../repositories/livesRepository');
const postingsRepository = require('../../../repositories/postingsRepository');
const tiktokAccountsRepository = require('../../../repositories/tiktokAccountsRepository');
const youtubeChannelsRepository = require('../../../repositories/youtubeChannelsRepository');
const socialAccountsRepository = require('../../../repositories/socialAccountsRepository');
const socialPostingsRepository = require('../../../repositories/socialPostingsRepository');
const backfillPostingsService = require('../../../services/backfillPostingsService');
const socialPostingService = require('../../../services/socialPostingService');
const queueService = require('../../../services/queueService');
const logger = require('../../../lib/logger');

const POR_PAGINA = 12;
const POR_PAGINA_GRADE = 24;
const TIPOS = ['youtube', 'live'];

function urlsDoCorte(tipo, id, temCapa) {
  if (tipo === 'live') {
    const base = `/api/client/lives/cortes/${id}/arquivo`;
    return { videoUrl: base, capaUrl: temCapa ? `${base}?capa=1` : null, downloadUrl: `${base}?download=1` };
  }
  const base = `/api/client/source-videos/clips/${id}`;
  return { videoUrl: `${base}/download`, capaUrl: temCapa ? `${base}/thumbnail` : null, downloadUrl: `${base}/download` };
}

function corteParaApi(r) {
  return {
    chave: `${r.tipo}-${r.id}`,
    tipo: r.tipo,
    id: Number(r.id),
    titulo: r.titulo,
    legenda: r.legenda,
    duracaoSegundos: Math.max(0, Math.round(Number(r.fim) - Number(r.inicio))),
    criadoEm: r.quando,
    ...urlsDoCorte(r.tipo, r.id, r.tem_capa),
    origem: {
      titulo: r.origem_titulo,
      canalId: r.canal_id ? Number(r.canal_id) : null,
      canalNome: r.canal_nome,
      canalAvatar: r.canal_avatar,
      plataforma: r.plataforma,
    },
    gostei: r.gostei,
    postagens: (r.postagens || []).map((p) => ({ ...p, accountId: Number(p.accountId) })),
  };
}

function cursorDe(r) {
  return `${r.us}.${r.tipo}.${r.id}`;
}

function lerCursor(texto) {
  const m = /^(\d+)\.(youtube|live)\.(\d+)$/.exec(String(texto || ''));
  return m ? { us: m[1], tipo: m[2], id: Number(m[3]) } : null;
}

// GET /api/client/feed?origem=youtube|lives&canal=yt-<id>|live-<id>|avulsos
//                     &ordem=antigos&aba=gostei&depois=<cursor>
async function listar(req, res) {
  const clientUserId = req.session.user.id;
  const origem = req.query.origem === 'youtube' ? 'youtube' : req.query.origem === 'lives' ? 'live' : null;

  let canal = null;
  const pedido = String(req.query.canal || 'todos');
  if (pedido === 'avulsos') canal = 'avulsos';
  else if (pedido !== 'todos') {
    const m = /^(yt|live)-(\d+)$/.exec(pedido);
    if (!m) return res.status(400).json({ error: 'Canal inválido.' });
    const id = Number(m[2]);
    if (m[1] === 'yt') {
      const c = await youtubeChannelsRepository.findById(id);
      // Canal de outro cliente é tratado como inexistente, não como "todos".
      if (!c || String(c.client_user_id) !== String(clientUserId)) return res.status(404).json({ error: 'Canal não encontrado.' });
      canal = { tipo: 'youtube', id };
    } else {
      // Canal de live é compartilhado entre clientes; o corte é que tem dono
      // (k.user_id), então filtrar por um canal de live nunca mostra corte de
      // outro cliente.
      canal = { tipo: 'live', id };
    }
  }
  let depois = null;
  if (req.query.depois) {
    depois = lerCursor(req.query.depois);
    if (!depois) return res.status(400).json({ error: 'Página inválida.' });
  }
  const soGostei = req.query.aba === 'gostei';
  const ordem = req.query.ordem === 'antigos' ? 'antigos' : 'recentes';
  const porPagina = soGostei ? POR_PAGINA_GRADE : POR_PAGINA;

  // Arquivo que a retenção já apagou (ou render que deixou 0 byte) não entra:
  // um corte que não toca é a pior coisa que um feed pode mostrar. Como isso
  // só se descobre olhando o disco, busca mais até completar a página - senão
  // ela viria com menos cortes e a próxima começaria no lugar errado.
  const cortes = [];
  let cursor = depois;
  let proximo = null;
  for (let rodada = 0; rodada < 5; rodada++) {
    const linhas = await feedRepository.listarCortes(clientUserId, { origem, canal, soGostei, ordem, depois: cursor, limite: porPagina });
    // Lote menor que o pedido = não há nada além dele.
    const acabou = linhas.length < porPagina;
    let cheia = false;
    for (let k = 0; k < linhas.length; k++) {
      const r = linhas[k];
      cursor = { us: r.us, tipo: r.tipo, id: Number(r.id) };
      if (backfillPostingsService.arquivoUtilizavel(r.local_clip_path)) cortes.push(corteParaApi(r));
      if (cortes.length === porPagina) {
        cheia = true;
        // Só não há próxima página se este era o último corte de todos.
        proximo = acabou && k === linhas.length - 1 ? null : cursorDe(r);
        break;
      }
    }
    if (cheia) break;
    if (acabou) {
      proximo = null;
      break;
    }
    proximo = `${cursor.us}.${cursor.tipo}.${cursor.id}`;
  }
  // O total só vai na primeira página (é o que o marcador "3 / 34" usa); nas
  // seguintes seria a mesma consulta de novo a cada rolagem.
  const total = depois ? undefined : await feedRepository.contarCortes(clientUserId, { origem, canal, soGostei });
  res.json({ cortes, proximo, total });
}

// Canais pro filtro e contas pro "Postar", numa chamada só.
async function contexto(req, res) {
  const clientUserId = req.session.user.id;
  const [canais, canaisLive, tiktok, sociais, totalGostei] = await Promise.all([
    youtubeChannelsRepository.listByClientId(clientUserId),
    feedRepository.canaisDeLive(clientUserId),
    tiktokAccountsRepository.listActiveByClientId(clientUserId),
    socialAccountsRepository.listActive(clientUserId),
    feedRepository.contarGostei(clientUserId),
  ]);
  res.json({
    canais: [
      ...canais.map((c) => ({ chave: `yt-${c.id}`, tipo: 'youtube', id: Number(c.id), nome: c.channel_name || c.channel_url, avatar: c.avatar_url, plataforma: null })),
      ...canaisLive.map((c) => ({
        chave: `live-${c.id}`,
        tipo: 'live',
        id: Number(c.id),
        nome: c.display_name || c.login,
        avatar: c.profile_image_url,
        plataforma: c.platform,
      })),
    ],
    contas: [
      ...tiktok.map((a) => ({
        id: Number(a.id),
        rede: 'tiktok',
        nome: a.display_name,
        avatar: a.avatar_url || null,
        publicaSozinho: a.auto_post_enabled === true,
        disponivel: true,
      })),
      // Instagram e Facebook publicam na hora pela Outstand (não têm fila
      // com horário como o TikTok), e só cortes dentro do limite de duração.
      ...sociais.map((s) => ({
        id: Number(s.id),
        rede: s.network,
        nome: s.display_name || s.username,
        avatar: s.avatar_url,
        publicaSozinho: true,
        disponivel: true,
      })),
    ],
    limitesRedesSociais: { duracaoMinimaS: socialPostingService.DURACAO_MINIMA_S, duracaoMaximaS: socialPostingService.DURACAO_MAXIMA_S },
    totalGostei,
  });
}

// O corte do cliente, do tipo pedido. Normalizado pra mesma forma.
async function corteDoCliente(req) {
  const { tipo } = req.params;
  const id = Number(req.params.id);
  if (!TIPOS.includes(tipo) || !Number.isInteger(id)) return null;
  if (tipo === 'live') {
    const k = await livesRepository.findClipForUser(id, req.session.user.id);
    if (!k) return null;
    return {
      tipo,
      id,
      pronto: k.status === 'pronto',
      caminho: k.local_clip_path,
      titulo: k.title,
      legenda: k.title,
      duracaoS: Number(k.end_offset) - Number(k.start_offset),
      linha: k,
    };
  }
  const c = await clipsRepository.findByIdOwnedByClient(id, req.session.user.id);
  if (!c) return null;
  return {
    tipo,
    id,
    pronto: c.status === 'ready',
    caminho: c.local_clip_path,
    titulo: c.title,
    legenda: c.description,
    duracaoS: Number(c.end_seconds) - Number(c.start_seconds),
    linha: c,
  };
}

// PUT /api/client/feed/cortes/:tipo/:id/gostei { gostei: true|false }
async function gostei(req, res) {
  if (typeof req.body?.gostei !== 'boolean') return res.status(400).json({ error: 'Informe gostei: true ou false.' });
  const corte = await corteDoCliente(req);
  if (!corte) return res.status(404).json({ error: 'Corte não encontrado.' });
  await feedRepository.marcarGostei(req.session.user.id, corte.tipo, corte.id, req.body.gostei);
  res.json({ gostei: req.body.gostei, totalGostei: await feedRepository.contarGostei(req.session.user.id) });
}

function idsDoCorpo(lista) {
  return Array.isArray(lista) ? [...new Set(lista.map(Number))] : [];
}

// POST /api/client/feed/cortes/:tipo/:id/enviar { tiktokAccountIds: [..], socialAccountIds: [..] }
async function enviar(req, res) {
  const clientUserId = req.session.user.id;
  const corte = await corteDoCliente(req);
  if (!corte || !corte.pronto || !corte.caminho) return res.status(404).json({ error: 'Corte não encontrado.' });
  if (!backfillPostingsService.arquivoUtilizavel(corte.caminho)) {
    return res.status(410).json({ error: 'O arquivo deste corte não existe mais (passou do prazo de retenção).' });
  }

  const pedidasTiktok = idsDoCorpo(req.body?.tiktokAccountIds);
  const pedidasSociais = idsDoCorpo(req.body?.socialAccountIds);
  if (pedidasTiktok.length === 0 && pedidasSociais.length === 0) return res.status(400).json({ error: 'Marque pelo menos uma conta.' });
  const [minhas, minhasSociais] = await Promise.all([
    pedidasTiktok.length ? tiktokAccountsRepository.listActiveByClientId(clientUserId) : [],
    pedidasSociais.length ? socialAccountsRepository.listActive(clientUserId) : [],
  ]);
  const contas = pedidasTiktok.map((id) => minhas.find((a) => Number(a.id) === id));
  const sociais = pedidasSociais.map((id) => minhasSociais.find((a) => Number(a.id) === id));
  // Conta de outro cliente (ou desconectada) recusa o pedido inteiro, antes
  // de criar qualquer postagem.
  if (contas.some((c) => !c) || sociais.some((c) => !c)) return res.status(404).json({ error: 'Conta não encontrada.' });
  // Instagram/Facebook só aceitam Reel dentro do limite: recusar aqui, com o
  // motivo, em vez de o corte virar erro minutos depois.
  if (sociais.length > 0) {
    const { DURACAO_MINIMA_S: min, DURACAO_MAXIMA_S: max } = socialPostingService;
    if (corte.duracaoS > max + 0.5 || corte.duracaoS < min) {
      return res.status(422).json({
        error: `Instagram e Facebook só aceitam cortes de ${min} s a ${max} s, e este tem ${Math.round(corte.duracaoS)} s.`,
      });
    }
  }

  const resultados = [];
  if (contas.length > 0) {
    const videoId =
      corte.tipo === 'live'
        ? await feedRepository.garantirVideoDeLive(corte.linha)
        : await backfillPostingsService.garantirVideo(corte.linha);
    for (const conta of contas) resultados.push({ rede: 'tiktok', ...(await enviarParaTiktok(corte, videoId, conta)) });
  }

  for (const conta of sociais) {
    const { linha, resultado } = await socialPostingsRepository.enfileirar({
      clientUserId,
      socialAccountId: conta.id,
      tipo: corte.tipo,
      clipId: corte.id,
      caption: corte.legenda,
    });
    resultados.push({ rede: conta.network, accountId: Number(conta.id), nome: conta.display_name || conta.username, resultado, scheduledFor: null, status: linha.status });
  }
  // Publica na hora: não espera a rodada de minuto em minuto do video-worker.
  if (resultados.some((r) => r.rede !== 'tiktok' && r.resultado === 'enfileirado')) {
    queueService
      .getBoss()
      .then((boss) => boss.send('social-posting', {}))
      .catch((err) => logger.error('Nao deu pra disparar a publicacao no Instagram/Facebook na hora:', err));
  }
  res.json({ resultados });
}

async function enviarParaTiktok(corte, videoId, conta) {
  const criada = await postingsRepository.createIfNotExists({ videoId, tiktokAccountId: conta.id, caption: corte.legenda });
  if (criada) {
    return { accountId: Number(conta.id), nome: conta.display_name, resultado: 'enfileirado', scheduledFor: criada.scheduled_for };
  }
  // Já existe uma postagem deste corte nesta conta. Cancelada volta pra fila
  // (o cliente pediu de novo, de propósito); o resto só é informado.
  const existente = await feedRepository.postagemDoCorte(corte.tipo, corte.id, conta.id);
  if (existente && existente.status === 'skipped') {
    const devolvida = await postingsRepository.requeueSkipped(existente.id, conta.id);
    return {
      accountId: Number(conta.id),
      nome: conta.display_name,
      resultado: devolvida ? 'enfileirado' : 'ja_existia',
      scheduledFor: devolvida ? devolvida.scheduled_for : existente.scheduled_for,
    };
  }
  return {
    accountId: Number(conta.id),
    nome: conta.display_name,
    resultado: existente && existente.status === 'posted' ? 'ja_publicado' : 'ja_na_fila',
    scheduledFor: existente ? existente.scheduled_for : null,
  };
}

module.exports = { listar, contexto, gostei, enviar };
