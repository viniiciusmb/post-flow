// Exclusão de conta pelo próprio cliente (12/10/2026, painel novo).
//
// A linha do usuário NÃO é apagada. Apagar levaria em cascata os pagamentos
// dele (asaas_payments) e as comissões que os afiliados ganharam com ele
// (commission_entries) - o extrato de outra pessoa mudaria por causa desta
// exclusão. Em vez disso a conta é ANONIMIZADA: e-mail, nome, CPF/CNPJ, login
// do Google e senha somem, e todo o conteúdo (canais, vídeos, cortes, contas
// conectadas, conversas, arquivos em disco) é apagado de verdade. Fica só o
// que a lei manda guardar (registro de pagamento e receita), sem nome.
//
// ORDEM QUE NÃO PODE INVERTER: a cobrança recorrente é cancelada PRIMEIRO. Se
// o Asaas (ou a Stripe) recusar, nada é apagado e o cliente vê o erro -
// excluir a conta com a recorrência ainda de pé cobraria, no mês seguinte,
// alguém que não existe mais no sistema e não tem como entrar pra cancelar.
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const pool = require('../db/pool');
const config = require('../config');
const asaasService = require('./asaasService');
const stripeService = require('./stripeService');
const outstandService = require('./outstandService');
const sharedVideoFiles = require('../lib/sharedVideoFiles');
const logger = require('../lib/logger');

class ExclusaoError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// O que vai acontecer, pra tela mostrar ANTES de a pessoa confirmar.
async function resumo(userId) {
  const { rows } = await pool.query(
    `SELECT
       (SELECT count(*) FROM youtube_channels WHERE client_user_id = $1)::int AS canais,
       (SELECT count(*) FROM source_videos WHERE owner_client_user_id = $1 OR client_user_id = $1)::int AS videos,
       (SELECT count(*) FROM tiktok_accounts WHERE client_user_id = $1 AND is_active)::int AS contas_tiktok,
       (SELECT count(*) FROM social_accounts WHERE client_user_id = $1 AND disconnected_at IS NULL)::int AS contas_sociais,
       (SELECT COALESCE(balance_available_cents, 0) FROM affiliates WHERE user_id = $1)::int AS saldo_comissao,
       (SELECT status FROM client_subscriptions WHERE client_user_id = $1) AS assinatura,
       (SELECT asaas_subscription_id IS NOT NULL OR stripe_subscription_id IS NOT NULL OR asaas_pix_authorization_id IS NOT NULL
          FROM client_subscriptions WHERE client_user_id = $1) AS recorrente`,
    [userId]
  );
  const r = rows[0];
  return {
    canais: r.canais,
    videos: r.videos,
    contasConectadas: r.contas_tiktok + r.contas_sociais,
    saldoComissaoCentavos: r.saldo_comissao || 0,
    temCobrancaRecorrente: r.recorrente === true && r.assinatura !== 'cancelado',
  };
}

async function cancelarCobrancas(userId) {
  const { rows } = await pool.query('SELECT * FROM client_subscriptions WHERE client_user_id = $1', [userId]);
  const sub = rows[0];
  if (!sub) return;
  const ids = [sub.asaas_subscription_id, sub.asaas_extra_slots_subscription_id].filter(Boolean);
  for (const id of ids) {
    try {
      await asaasService.cancelSubscription(id);
    } catch (err) {
      // Assinatura que o Asaas já não encontra está, na prática, cancelada.
      if (!/404|not found|não encontrad/i.test(String(err.message))) {
        logger.error(`Exclusao de conta ${userId}: Asaas recusou cancelar ${id}: ${err.message}`);
        throw new ExclusaoError(502, 'Não foi possível cancelar a sua assinatura agora, então nada foi excluído. Tente de novo em alguns minutos.');
      }
    }
  }
  if (sub.stripe_subscription_id) {
    try {
      await stripeService.cancelSubscription(sub.stripe_subscription_id);
    } catch (err) {
      if (!/No such subscription|canceled/i.test(String(err.message))) {
        logger.error(`Exclusao de conta ${userId}: Stripe recusou cancelar: ${err.message}`);
        throw new ExclusaoError(502, 'Não foi possível cancelar a sua assinatura agora, então nada foi excluído. Tente de novo em alguns minutos.');
      }
    }
  }
}

// Desconectar nas redes é "melhor esforço": a conta vai sumir daqui de
// qualquer jeito, e uma Outstand fora do ar não pode impedir a exclusão.
async function desconectarRedes(userId) {
  const { rows } = await pool.query(
    'SELECT outstand_account_id FROM social_accounts WHERE client_user_id = $1 AND disconnected_at IS NULL',
    [userId]
  );
  for (const r of rows) {
    try {
      await outstandService.removerConta(r.outstand_account_id);
    } catch (err) {
      logger.warn(`Exclusao de conta ${userId}: nao removi ${r.outstand_account_id} na Outstand: ${err.message}`);
    }
  }
}

// Caminhos de arquivo do cliente, levantados ANTES de apagar as linhas.
async function arquivosDoCliente(userId) {
  const { rows: videos } = await pool.query(
    `SELECT sv.id, sv.local_video_path FROM source_videos sv
      WHERE sv.owner_client_user_id = $1 OR sv.client_user_id = $1
         OR sv.youtube_channel_id IN (SELECT id FROM youtube_channels WHERE client_user_id = $1)`,
    [userId]
  );
  const { rows: cortes } = await pool.query(
    `SELECT c.local_clip_path, c.thumbnail_path FROM clips c WHERE c.source_video_id = ANY($1::bigint[])
     UNION ALL
     SELECT k.local_clip_path, k.thumbnail_path FROM live_clips k WHERE k.user_id = $2`,
    [videos.map((v) => v.id), userId]
  );
  const arquivos = [
    ...videos.map((v) => v.local_video_path),
    ...cortes.flatMap((c) => [c.local_clip_path, c.thumbnail_path]),
  ]
    .filter(Boolean)
    // Arquivo compartilhado entre clientes do mesmo canal não é deste cliente
    // sozinho: quem apaga é a limpeza dos compartilhados.
    .filter((f) => !sharedVideoFiles.isShared(f));
  const pastas = videos.map((v) => path.join(config.videoProcessing.workDir, String(v.id)));
  return { arquivos, pastas, videoIds: videos.map((v) => v.id) };
}

async function excluirConta(userId) {
  const { rows: u } = await pool.query('SELECT id, role, deleted_at FROM users WHERE id = $1', [userId]);
  if (!u[0] || u[0].deleted_at) throw new ExclusaoError(404, 'Conta não encontrada.');
  // A conta de administrador não se exclui pela tela: apagar o dono do sistema
  // por um clique errado não tem volta.
  if (u[0].role !== 'client') throw new ExclusaoError(403, 'Conta de administrador não pode ser excluída por aqui.');

  await cancelarCobrancas(userId);
  await desconectarRedes(userId);
  const { arquivos, pastas, videoIds } = await arquivosDoCliente(userId);

  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    // Conteúdo: tudo que o cliente criou ou conectou.
    await db.query('DELETE FROM source_videos WHERE id = ANY($1::bigint[])', [videoIds]);
    for (const tabela of [
      'youtube_channels',
      'tiktok_accounts',
      'social_accounts',
      'drive_folders',
      'drive_connections:owner_user_id',
      'download_tunnels',
      'support_conversations',
      'client_video_settings',
      'clip_style_models',
      'client_notices',
      'live_channel_follows:user_id',
      'live_clip_settings:user_id',
      'live_clips:user_id',
      'clip_likes',
      'live_clip_likes',
      'clip_views',
      'live_clip_views',
      'password_reset_tokens:user_id',
      'affiliate_links:owner_user_id',
    ]) {
      const [nome, coluna = 'client_user_id'] = tabela.split(':');
      await db.query(`DELETE FROM ${nome} WHERE ${coluna} = $1`, [userId]);
    }
    // Dados pessoais que ficam em registros que continuam existindo.
    await db.query('UPDATE affiliates SET pix_key = NULL, pix_key_type = NULL WHERE user_id = $1', [userId]);
    await db.query(
      `UPDATE client_subscriptions
          SET status = 'cancelado', canceled_at = COALESCE(canceled_at, now()), cancel_at = NULL,
              asaas_card_token = NULL, asaas_card_brand = NULL, asaas_card_last4 = NULL, asaas_card_exp = NULL,
              overage_card_enabled = false, stripe_default_payment_method_id = NULL,
              asaas_subscription_id = NULL, asaas_extra_slots_subscription_id = NULL,
              asaas_pix_authorization_id = NULL, stripe_subscription_id = NULL, updated_at = now()
        WHERE client_user_id = $1`,
      [userId]
    );
    // O cadastro vira anônimo. O e-mail recebe um valor único e inválido de
    // propósito: a coluna é UNIQUE e a pessoa pode querer criar uma conta nova
    // com o mesmo e-mail depois.
    const sufixo = crypto.randomBytes(6).toString('hex');
    await db.query(
      `UPDATE users
          SET email = $2, business_name = 'Conta excluída', password_hash = NULL,
              google_sub = NULL, google_email = NULL, cpf_cnpj = NULL,
              is_active = false, deleted_at = now(), updated_at = now()
        WHERE id = $1`,
      [userId, `excluida-${userId}-${sufixo}@contas-excluidas.invalid`]
    );
    // Sessões abertas em outros aparelhos deixam de valer na hora.
    await db.query(`DELETE FROM session WHERE (sess::jsonb -> 'user' ->> 'id') = $1`, [String(userId)]);
    await db.query('COMMIT');
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    db.release();
  }

  for (const f of arquivos) fs.rm(f, { force: true }, () => {});
  for (const p of pastas) fs.rm(p, { recursive: true, force: true }, () => {});
  logger.info(`Conta ${userId} excluida pelo proprio cliente (${videoIds.length} videos, ${arquivos.length} arquivos).`);
}

module.exports = { excluirConta, resumo, ExclusaoError };
