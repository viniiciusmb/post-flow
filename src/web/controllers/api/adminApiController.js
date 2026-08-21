'use strict';

const usersRepository = require('../../../repositories/usersRepository');
const postingsRepository = require('../../../repositories/postingsRepository');
const youtubeChannelsRepository = require('../../../repositories/youtubeChannelsRepository');
const sourceVideosRepository = require('../../../repositories/sourceVideosRepository');
const clipsRepository = require('../../../repositories/clipsRepository');
const referralsRepository = require('../../../repositories/referralsRepository');
const { ROLES } = require('../../../config/constants');
const tiktokCapacityService = require('../../../services/tiktokCapacityService');
const { resolveRange } = require('../../../lib/dateRanges');

async function dashboard(req, res) {
  const { range, since, until } = resolveRange(req.query.range);

  const [clients, postings, channels, videosInProgress, clipsInRange, tiktokCapacity] = await Promise.all([
    usersRepository.listByRole(ROLES.CLIENT),
    postingsRepository.listAllWithDetails(),
    youtubeChannelsRepository.listActive(),
    sourceVideosRepository.countInProgress(),
    clipsRepository.countCreatedSince(since, until),
    // Teto de criadores ativos do app no TikTok. Vem junto do dashboard (em
    // vez de numa chamada propria) porque o aviso precisa aparecer sem
    // ninguem ir procurar - o risco dele e justamente passar despercebido.
    tiktokCapacityService.avaliar(),
  ]);

  const postingsInRange = postings.filter((p) => {
    const t = new Date(p.created_at).getTime();
    return t >= since.getTime() && t <= until.getTime();
  });

  res.json({
    range: { key: range, since, until },
    tiktokCapacity,
    counts: {
      clients: clients.length,
      postings: postings.length,
      youtubeChannels: channels.length,
      videosInProgress,
      clipsInRange,
    },
    postings: postingsInRange.map((p) => ({
      id: p.id,
      clientName: p.client_business_name || p.client_email,
      filename: p.filename,
      status: p.status,
      origin: p.origin,
      createdAt: p.created_at,
    })),
  });
}

async function postings(req, res) {
  const { range, since, until } = resolveRange(req.query.range);
  const rows = await postingsRepository.listAllWithDetails();
  const rowsInRange = rows.filter((p) => {
    const t = new Date(p.created_at).getTime();
    return t >= since.getTime() && t <= until.getTime();
  });

  res.json({
    range: { key: range, since, until },
    postings: rowsInRange.map((p) => ({
      id: p.id,
      clientName: p.client_business_name || p.client_email,
      filename: p.filename,
      status: p.status,
      origin: p.origin,
      channelName: p.channel_name,
      tiktokDisplayName: p.tiktok_display_name,
      errorMessage: p.error_message,
      createdAt: p.created_at,
    })),
  });
}

async function clients(req, res) {
  const [rows, origins] = await Promise.all([
    usersRepository.listClientsWithStats(),
    referralsRepository.originByUser(),
  ]);
  // Por usuario: nome/e-mail de quem indicou, ou a UTM de campanha, ou nulo
  // (cadastro direto) - ver referralsRepository.originByUser.
  const originByUserId = new Map(origins.map((o) => [o.referred_user_id, o]));

  res.json({
    clients: rows.map((c) => {
      const origin = originByUserId.get(c.id);
      return {
        id: c.id,
        businessName: c.business_name,
        email: c.email,
        isActive: c.is_active,
        createdAt: c.created_at,
        channelCount: c.channel_count,
        tiktokConnected: Boolean(c.tiktok_display_name),
        tiktokDisplayName: c.tiktok_display_name,
        origin: origin
          ? {
              referrerName: origin.referrer_email
                ? origin.referrer_business_name || origin.referrer_email
                : null,
              affiliateLinkLabel: origin.affiliate_link_label,
              utmSource: origin.utm_source,
              utmCampaign: origin.utm_campaign,
            }
          : null,
      };
    }),
  });
}

// O fundador informa o teto que o TikTok concedeu na auditoria. Sem isso o
// sistema trabalha com um chute conservador, que erra nos dois sentidos:
// avisa cedo demais (irrita) ou tarde demais (deixa cliente sem publicar).
async function setTiktokLimit(req, res) {
  const salvo = await tiktokCapacityService.definirLimite(req.body.limite);
  if (salvo === null) return res.status(400).json({ error: res.locals.t('erros.valorInvalido') });
  res.json(await tiktokCapacityService.avaliar());
}

// "Ja pedi o aumento." Silencia o aviso por um tempo, nao para sempre: pedido
// pode ser recusado, e aviso silenciado pra sempre e o mesmo que nao existir.
async function snoozeTiktokLimit(req, res) {
  await tiktokCapacityService.adiarAviso(Number(req.body.dias) || 14);
  res.json(await tiktokCapacityService.avaliar());
}

module.exports = {
  setTiktokLimit,
  snoozeTiktokLimit, dashboard, postings, clients };
