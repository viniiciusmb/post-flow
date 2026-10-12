// Saúde das contas de Instagram, Facebook, Threads, LinkedIn, Pinterest,
// Bluesky e YouTube (12/10/2026).
//
// Em 09/10/2026 a conta do Instagram do fundador continuou aparecendo como
// "conectada" com a autorização já cancelada pelo Instagram (troca de senha ou
// sessão encerrada pela Meta), e só se descobriu na hora de publicar. A
// Outstand ainda dizia `isActive: 1`. O único jeito de saber de verdade é usar
// o token: lemos os números da conta (chamada só de leitura) e, se a rede
// recusar a autorização, a conta fica marcada como "precisa reconectar" - a
// tela pede a reconexão e a fila dela espera, em vez de cada corte virar erro.
//
// Só AUTORIZAÇÃO marca a conta. Rede fora do ar, limite de requisição ou
// número que a rede não informa não dizem nada sobre o login, e marcar por
// isso faria a tela pedir reconexão à toa.
'use strict';

const pool = require('../db/pool');
const outstandService = require('./outstandService');
const errorReportService = require('./errorReportService');
const logger = require('../lib/logger');

const SINAIS_DE_AUTORIZACAO =
  /token|oauth|expired|session has been invalidated|reauth|re-auth|reconnect|not authorized|unauthorized|permission|code"?:\s*190|revoked/i;

function ehFalhaDeAutorizacao(mensagem) {
  return SINAIS_DE_AUTORIZACAO.test(String(mensagem || ''));
}

async function marcarSaudavel(id) {
  await pool.query(
    `UPDATE social_accounts SET conferida_em = now(), precisa_reconectar_em = NULL, motivo_reconectar = NULL WHERE id = $1`,
    [id]
  );
}

async function marcarPrecisaReconectar(id, motivo) {
  const { rows } = await pool.query(
    `UPDATE social_accounts
        SET conferida_em = now(), precisa_reconectar_em = COALESCE(precisa_reconectar_em, now()), motivo_reconectar = $2
      WHERE id = $1 RETURNING client_user_id, network, (precisa_reconectar_em = conferida_em) AS agora`,
    [id, String(motivo || '').slice(0, 300)]
  );
  return rows[0] || null;
}

// Confere UMA conta. Devolve 'ok' | 'reconectar' | 'indefinido'.
async function conferir(conta) {
  try {
    await outstandService.conferirConta(conta.outstand_account_id);
    await marcarSaudavel(conta.id);
    return 'ok';
  } catch (err) {
    const status = Number(err.status) || 0;
    // 404: a conta não existe mais na Outstand (removida lá, ou o login foi
    // desfeito do lado da rede). Do ponto de vista do cliente é a mesma coisa:
    // precisa conectar de novo.
    if (status === 404 || ehFalhaDeAutorizacao(err.message)) {
      const r = await marcarPrecisaReconectar(conta.id, status === 404 ? 'A conta não foi encontrada na rede.' : err.message);
      logger.warn(`Conta social ${conta.id} (${conta.network}) precisa reconectar: ${err.message}`);
      if (r && r.agora) {
        await errorReportService.report({
          operation: errorReportService.OPERACOES.SOCIAL_CONTA,
          entityType: 'social_account',
          entityId: conta.id,
          clientUserId: r.client_user_id,
          error: err,
          message: `Conta de ${conta.network} precisa ser reconectada pelo cliente`,
        });
      }
      return 'reconectar';
    }
    logger.warn(`Nao deu pra conferir a conta social ${conta.id} (${conta.network}): ${err.message}`);
    return 'indefinido';
  }
}

// Todas as contas conectadas. Roda a cada 6 horas no video-worker.
async function conferirTodas() {
  if (!outstandService.configurado()) return { conferidas: 0 };
  const { rows } = await pool.query(
    'SELECT id, network, outstand_account_id FROM social_accounts WHERE disconnected_at IS NULL ORDER BY conferida_em NULLS FIRST'
  );
  const resultado = { ok: 0, reconectar: 0, indefinido: 0 };
  for (const conta of rows) resultado[await conferir(conta)] += 1;
  return resultado;
}

module.exports = { conferir, conferirTodas, marcarPrecisaReconectar, marcarSaudavel, ehFalhaDeAutorizacao };
