// Põe cortes na fila das contas de Instagram/Facebook/Threads/LinkedIn/
// Pinterest/Bluesky/YouTube (11/10/2026). Os três caminhos usam esta mesma
// porta: o pipeline (corte acabou de ficar pronto), o vínculo de um canal a uma
// conta (cortes que já estavam prontos) e o "Postar" do feed.
//
// A regra de duração mora aqui pra valer igual nos três: um corte maior do que
// a rede aceita não some em silêncio - quando entra pelo pipeline ou pelo feed,
// fica registrado como erro com o motivo ("O Instagram só aceita vídeos com
// menos de 90 segundos..."), pro cliente entender por que ele não foi.
'use strict';

const pool = require('../db/pool');
const socialPostingsRepository = require('../repositories/socialPostingsRepository');
const youtubeChannelSocialTargetsRepository = require('../repositories/youtubeChannelSocialTargetsRepository');
const backfillPostingsService = require('./backfillPostingsService');
const redesSociais = require('../lib/redesSociais');
const logger = require('../lib/logger');

// corte: { tipo: 'youtube'|'live', id, titulo, legenda, duracao }
async function enfileirarCorte({ clientUserId, conta, corte }) {
  return socialPostingsRepository.enfileirar({
    clientUserId,
    socialAccountId: conta.id,
    tipo: corte.tipo,
    clipId: corte.id,
    caption: corte.legenda,
    title: corte.titulo,
    bloqueio: redesSociais.motivoDaDuracao(conta.network, corte.duracao),
  });
}

// Chamado pelo pipeline quando um corte de canal fica pronto. Nunca lança: a
// fila das redes não pode derrubar a renderização do corte.
async function corteFicouPronto({ sourceVideo, clip }) {
  if (!sourceVideo.youtube_channel_id) return 0;
  let n = 0;
  try {
    const contas = await youtubeChannelSocialTargetsRepository.contasDoCanal(sourceVideo.youtube_channel_id);
    for (const conta of contas) {
      if (!conta.auto_post_enabled) continue;
      await enfileirarCorte({
        clientUserId: conta.client_user_id,
        conta,
        corte: {
          tipo: 'youtube',
          id: clip.id,
          titulo: clip.title,
          legenda: clip.description,
          duracao: Number(clip.end_seconds) - Number(clip.start_seconds),
        },
      });
      n += 1;
    }
  } catch (err) {
    logger.error(`Falha ao por o corte ${clip.id} na fila das redes sociais:`, err);
  }
  return n;
}

// Canal acabou de ser ligado a uma conta: os cortes do canal que já estavam
// prontos (e ainda têm arquivo) entram na fila dela, igual o TikTok faz ao
// vincular. Os que são longos demais pra rede ficam de fora sem virar erro -
// seriam dezenas de avisos de uma vez sobre cortes antigos.
async function canalLigadoAConta({ clientUserId, youtubeChannelId, conta }) {
  const { rows } = await pool.query(
    `SELECT c.id, c.title, c.description, c.local_clip_path, c.start_seconds, c.end_seconds
       FROM clips c JOIN source_videos sv ON sv.id = c.source_video_id
      WHERE sv.youtube_channel_id = $1 AND c.status = 'ready' AND c.local_clip_path IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM social_postings sp WHERE sp.clip_id = c.id AND sp.social_account_id = $2)
      ORDER BY c.id`,
    [youtubeChannelId, conta.id]
  );
  let enfileirados = 0;
  let longos = 0;
  for (const c of rows) {
    if (!backfillPostingsService.arquivoUtilizavel(c.local_clip_path)) continue;
    const duracao = Number(c.end_seconds) - Number(c.start_seconds);
    if (redesSociais.motivoDaDuracao(conta.network, duracao)) {
      longos += 1;
      continue;
    }
    const r = await socialPostingsRepository.enfileirar({
      clientUserId,
      socialAccountId: conta.id,
      tipo: 'youtube',
      clipId: c.id,
      caption: c.description,
      title: c.title,
    });
    if (r.resultado === 'enfileirado') enfileirados += 1;
  }
  return { enfileirados, longos };
}

module.exports = { enfileirarCorte, corteFicouPronto, canalLigadoAConta };
