// Feed de cortes (08/10/2026): o cliente passa pelos cortes prontos da conta
// dele como num feed de rede social, marca os que gostou e manda os escolhidos
// pra fila de publicação das contas que ele marcar.
//
// Enviar usa a MESMA criação de postagem do resto do sistema
// (postingsRepository.createIfNotExists): o horário sai da fila da conta, a
// ordem por vídeo é mantida e a publicação automática da conta continua
// decidindo se sai sozinho. O feed só escolhe O QUE e PRA ONDE.
'use strict';

const clipsRepository = require('../../../repositories/clipsRepository');
const feedRepository = require('../../../repositories/feedRepository');
const postingsRepository = require('../../../repositories/postingsRepository');
const tiktokAccountsRepository = require('../../../repositories/tiktokAccountsRepository');
const youtubeChannelsRepository = require('../../../repositories/youtubeChannelsRepository');
const socialAccountsRepository = require('../../../repositories/socialAccountsRepository');
const backfillPostingsService = require('../../../services/backfillPostingsService');

const POR_PAGINA = 12;

function corteParaApi(r) {
  return {
    id: Number(r.id),
    titulo: r.title,
    legenda: r.description,
    duracaoSegundos: Math.max(0, Math.round(Number(r.end_seconds) - Number(r.start_seconds))),
    criadoEm: r.created_at,
    videoUrl: `/api/client/source-videos/clips/${r.id}/download`,
    capaUrl: r.tem_capa ? `/api/client/source-videos/clips/${r.id}/thumbnail` : null,
    origem: {
      videoId: Number(r.source_video_id),
      titulo: r.source_title,
      canalId: r.youtube_channel_id ? Number(r.youtube_channel_id) : null,
      canalNome: r.channel_name,
      canalAvatar: r.channel_avatar,
      canalUrl: r.channel_url,
    },
    gostei: r.gostei,
    postagens: (r.postagens || []).map((p) => ({ ...p, accountId: Number(p.accountId) })),
  };
}

// GET /api/client/feed?canal=<id|avulsos>&aba=gostei&antes=<id>
async function listar(req, res) {
  const clientUserId = req.session.user.id;
  let canal = null;
  if (req.query.canal === 'avulsos') canal = 'avulsos';
  else if (req.query.canal && req.query.canal !== 'todos') {
    const id = Number(req.query.canal);
    const c = Number.isInteger(id) ? await youtubeChannelsRepository.findById(id) : null;
    // Canal de outro cliente é tratado como inexistente, não como "todos".
    if (!c || String(c.client_user_id) !== String(clientUserId)) return res.status(404).json({ error: 'Canal não encontrado.' });
    canal = id;
  }
  const antes = req.query.antes ? Number(req.query.antes) : null;
  if (antes !== null && !Number.isInteger(antes)) return res.status(400).json({ error: 'Página inválida.' });

  // Arquivo que a retenção já apagou (ou render que deixou 0 byte) não entra:
  // um corte que não toca é a pior coisa que um feed pode mostrar. Como isso
  // só se descobre olhando o disco, busca mais até completar a página - senão
  // ela viria com menos cortes e a próxima começaria no lugar errado.
  const cortes = [];
  let cursor = antes;
  let proximo = null;
  for (let rodada = 0; rodada < 5; rodada++) {
    const linhas = await feedRepository.listarCortes(clientUserId, {
      canal,
      soGostei: req.query.aba === 'gostei',
      antes: cursor,
      limite: POR_PAGINA,
    });
    // Lote menor que o pedido = não há nada além dele.
    const acabou = linhas.length < POR_PAGINA;
    let cheia = false;
    for (let k = 0; k < linhas.length; k++) {
      const r = linhas[k];
      cursor = Number(r.id);
      if (backfillPostingsService.arquivoUtilizavel(r.local_clip_path)) cortes.push(corteParaApi(r));
      if (cortes.length === POR_PAGINA) {
        cheia = true;
        // Só não há próxima página se este era o último corte de todos.
        proximo = acabou && k === linhas.length - 1 ? null : cursor;
        break;
      }
    }
    if (cheia) break;
    if (acabou) {
      proximo = null;
      break;
    }
    proximo = cursor;
  }
  res.json({ cortes, proximo });
}

// Canais pro filtro e contas pro "Enviar", numa chamada só.
async function contexto(req, res) {
  const clientUserId = req.session.user.id;
  const [canais, tiktok, sociais, totalGostei] = await Promise.all([
    youtubeChannelsRepository.listByClientId(clientUserId),
    tiktokAccountsRepository.listActiveByClientId(clientUserId),
    socialAccountsRepository.listActive(clientUserId),
    feedRepository.contarGostei(clientUserId),
  ]);
  res.json({
    canais: canais.map((c) => ({ id: Number(c.id), nome: c.channel_name || c.channel_url, avatar: c.avatar_url })),
    contas: [
      ...tiktok.map((a) => ({
        id: Number(a.id),
        rede: 'tiktok',
        nome: a.display_name,
        avatar: a.avatar_url || null,
        publicaSozinho: a.auto_post_enabled === true,
        disponivel: true,
      })),
      // Instagram e Facebook já conectam, mas ainda não publicam: aparecem na
      // lista pra pessoa ver que existem, marcados como indisponíveis.
      ...sociais.map((s) => ({
        id: Number(s.id),
        rede: s.network,
        nome: s.display_name || s.username,
        avatar: s.avatar_url,
        publicaSozinho: false,
        disponivel: false,
      })),
    ],
    totalGostei,
  });
}

async function corteDoCliente(req) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return null;
  return clipsRepository.findByIdOwnedByClient(id, req.session.user.id);
}

// PUT /api/client/feed/cortes/:id/gostei { gostei: true|false }
async function gostei(req, res) {
  if (typeof req.body?.gostei !== 'boolean') return res.status(400).json({ error: 'Informe gostei: true ou false.' });
  const corte = await corteDoCliente(req);
  if (!corte) return res.status(404).json({ error: 'Corte não encontrado.' });
  await feedRepository.marcarGostei(req.session.user.id, Number(corte.id), req.body.gostei);
  res.json({ gostei: req.body.gostei, totalGostei: await feedRepository.contarGostei(req.session.user.id) });
}

// POST /api/client/feed/cortes/:id/enviar { tiktokAccountIds: [..] }
async function enviar(req, res) {
  const clientUserId = req.session.user.id;
  const corte = await corteDoCliente(req);
  if (!corte || corte.status !== 'ready' || !corte.local_clip_path) {
    return res.status(404).json({ error: 'Corte não encontrado.' });
  }
  if (!backfillPostingsService.arquivoUtilizavel(corte.local_clip_path)) {
    return res.status(410).json({ error: 'O arquivo deste corte não existe mais (passou do prazo de retenção).' });
  }

  const pedidas = Array.isArray(req.body?.tiktokAccountIds) ? [...new Set(req.body.tiktokAccountIds.map(Number))] : [];
  if (pedidas.length === 0) return res.status(400).json({ error: 'Marque pelo menos uma conta.' });
  const minhas = await tiktokAccountsRepository.listActiveByClientId(clientUserId);
  const contas = pedidas.map((id) => minhas.find((a) => Number(a.id) === id));
  // Conta de outro cliente (ou desconectada) recusa o pedido inteiro, antes
  // de criar qualquer postagem.
  if (contas.some((c) => !c)) return res.status(404).json({ error: 'Conta não encontrada.' });

  const videoId = await backfillPostingsService.garantirVideo(corte);
  const resultados = [];
  for (const conta of contas) {
    const criada = await postingsRepository.createIfNotExists({ videoId, tiktokAccountId: conta.id, caption: corte.description });
    if (criada) {
      resultados.push({ accountId: Number(conta.id), nome: conta.display_name, resultado: 'enfileirado', scheduledFor: criada.scheduled_for });
      continue;
    }
    // Já existe uma postagem deste corte nesta conta. Cancelada volta pra fila
    // (o cliente pediu de novo, de propósito); o resto só é informado.
    const existente = await feedRepository.postagemDoCorte(Number(corte.id), conta.id);
    if (existente && existente.status === 'skipped') {
      const devolvida = await postingsRepository.requeueSkipped(existente.id, conta.id);
      resultados.push({
        accountId: Number(conta.id),
        nome: conta.display_name,
        resultado: devolvida ? 'enfileirado' : 'ja_existia',
        scheduledFor: devolvida ? devolvida.scheduled_for : existente.scheduled_for,
      });
    } else {
      resultados.push({
        accountId: Number(conta.id),
        nome: conta.display_name,
        resultado: existente && existente.status === 'posted' ? 'ja_publicado' : 'ja_na_fila',
        scheduledFor: existente ? existente.scheduled_for : null,
      });
    }
  }
  res.json({ resultados });
}

module.exports = { listar, contexto, gostei, enviar };
