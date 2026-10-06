// Devolve os minutos de um video que falhou por nossa causa.
//
// Esta e a UNICA porta pela qual o suporte mexe em saldo, e ela nao aceita
// "quantos minutos": o valor e sempre exatamente o que aquele video cobrou,
// lido da cobranca dele. A IA (ou qualquer um) so consegue escolher QUAL video
// - e o video precisa ser do cliente da sessao e passar no diagnostico.
//
// Tetos por cliente: acima deles a devolucao nao e recusada pra sempre, ela
// vai pra uma pessoa olhar. Sao a rede contra um defeito nosso em massa (ou
// alguem tentando explorar uma brecha que ainda nao vimos) virar minutos
// distribuidos sem ninguem perceber.
'use strict';

const pool = require('../../db/pool');
const supportRepository = require('../../repositories/supportRepository');
const { diagnosticar } = require('./diagnosticoDeVideo');
const logger = require('../../lib/logger');

const MAX_DEVOLUCOES_POR_DIA = 3;
const MAX_MINUTOS_POR_30_DIAS = 300;

const COLUNAS = {
  normal: { used: 'used_normal', extra: 'extra_normal' },
  bonus: { used: 'used_bonus', extra: 'extra_bonus' },
};

function linhaParaDiagnostico(linha) {
  return {
    video: linha,
    cobranca: linha.tx_status
      ? { status: linha.tx_status, minutes_charged: linha.tx_minutes_charged }
      : null,
    cortesProntos: Number(linha.cortes_prontos || 0),
    cortesTotal: Number(linha.cortes_total || 0),
    devolucao: linha.devolvido_minutos ? { minutes: linha.devolvido_minutos } : null,
  };
}

/**
 * @returns {Promise<{ ok: true, minutos: number } | { ok: false, motivo: string, mensagem: string }>}
 */
async function devolverMinutosDoVideo({ clientUserId, sourceVideoId, conversationId = null }) {
  const id = Number(sourceVideoId);
  if (!Number.isInteger(id) || id <= 0) {
    return { ok: false, motivo: 'video_invalido', mensagem: 'Número de vídeo inválido.' };
  }

  const linha = await supportRepository.findVideoForClient(id, clientUserId);
  if (!linha) {
    // Mesma resposta pra "nao existe" e "e de outro cliente": nao confirmar
    // que um id existe ja e informacao que nao pertence a quem perguntou.
    return { ok: false, motivo: 'video_nao_encontrado', mensagem: 'Não encontrei esse vídeo na sua conta.' };
  }

  const diagnostico = diagnosticar(linhaParaDiagnostico(linha));
  if (!diagnostico.podeDevolver) {
    return { ok: false, motivo: diagnostico.motivoSemDevolucao || 'nao_elegivel', mensagem: diagnostico.explicacao };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Uma devolucao por vez por cliente: sem isto, dois pedidos simultaneos de
    // videos DIFERENTES leriam os tetos antes de qualquer um gravar e os dois
    // passariam.
    await client.query('SELECT pg_advisory_xact_lock(9801, $1)', [clientUserId]);
    const { rows: janela } = await client.query(
      `SELECT count(*) FILTER (WHERE created_at > now() - interval '24 hours')::int AS no_dia,
              coalesce(sum(minutes) FILTER (WHERE created_at > now() - interval '30 days'), 0)::int AS minutos_no_mes
       FROM support_credit_refunds WHERE client_user_id = $1`,
      [clientUserId]
    );
    if (
      janela[0].no_dia >= MAX_DEVOLUCOES_POR_DIA ||
      janela[0].minutos_no_mes + diagnostico.minutosCobrados > MAX_MINUTOS_POR_30_DIAS
    ) {
      await client.query('ROLLBACK');
      return {
        ok: false,
        motivo: 'limite_de_devolucoes',
        mensagem: 'Esse caso precisa ser revisado por uma pessoa da equipe antes da devolução.',
      };
    }

    // Trava a cobranca e confere de novo DENTRO da transacao: dois pedidos
    // simultaneos pro mesmo video leem "confirmado" os dois fora daqui. So o
    // primeiro passa por este UPDATE; o segundo nao encontra mais a linha no
    // status esperado. O UNIQUE de support_credit_refunds e a segunda trava.
    const { rows: tx } = await client.query(
      `UPDATE credit_transactions
       SET status = 'liberado', updated_at = now()
       WHERE source_video_id = $1 AND client_user_id = $2 AND status IN ('confirmado', 'reservado')
       RETURNING bucket, minutes_charged, minutes_from_quota, minutes_from_extra, created_at`,
      [id, clientUserId]
    );
    if (!tx[0]) {
      await client.query('ROLLBACK');
      return { ok: false, motivo: 'ja_devolvido', mensagem: 'Os minutos desse vídeo já foram devolvidos.' };
    }
    const cobranca = tx[0];
    const colunas = COLUNAS[cobranca.bucket];
    if (!colunas) throw new Error(`Bolso de credito invalido: ${cobranca.bucket}`);

    // Se a cota ainda e a do mesmo ciclo da cobranca, desfaz exatamente o que
    // saiu de cada lugar. Se a cota ja renovou, devolver pra cota daria cota
    // a mais nesta semana sem ter saido nada dela - entao tudo vai pro avulso,
    // que nao expira.
    const { rows: cc } = await client.query(
      'SELECT cycle_start_at FROM client_credits WHERE client_user_id = $1 FOR UPDATE',
      [clientUserId]
    );
    const mesmoCiclo = cc[0] && new Date(cobranca.created_at) >= new Date(cc[0].cycle_start_at);
    const paraCota = mesmoCiclo ? Number(cobranca.minutes_from_quota) : 0;
    const paraAvulso = mesmoCiclo ? Number(cobranca.minutes_from_extra) : Number(cobranca.minutes_charged);

    await client.query(
      `UPDATE client_credits
       SET ${colunas.used} = GREATEST(${colunas.used} - $2, 0),
           ${colunas.extra} = ${colunas.extra} + $3,
           updated_at = now()
       WHERE client_user_id = $1`,
      [clientUserId, paraCota, paraAvulso]
    );

    await client.query(
      `INSERT INTO support_credit_refunds
         (client_user_id, source_video_id, conversation_id, bucket, minutes, minutes_to_quota, minutes_to_extra, reason_code, video_title)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [clientUserId, id, conversationId, cobranca.bucket, Number(cobranca.minutes_charged), paraCota, paraAvulso,
        `falha_${diagnostico.etapa || 'processamento'}`, String(linha.title || '').slice(0, 200)]
    );

    // Sem isto, o retry automatico poderia pegar o video depois e cobrar de
    // novo um processamento que o cliente nao pediu.
    await client.query(
      'UPDATE source_videos SET auto_retry_count = GREATEST(auto_retry_count, 3), updated_at = now() WHERE id = $1',
      [id]
    );

    await client.query('COMMIT');
    logger.info(`Suporte: devolvidos ${cobranca.minutes_charged} min do video ${id} ao cliente ${clientUserId}.`);
    return { ok: true, minutos: Number(cobranca.minutes_charged) };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err.code === '23505') {
      return { ok: false, motivo: 'ja_devolvido', mensagem: 'Os minutos desse vídeo já foram devolvidos.' };
    }
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { devolverMinutosDoVideo, linhaParaDiagnostico, MAX_DEVOLUCOES_POR_DIA, MAX_MINUTOS_POR_30_DIAS };
