'use strict';

const crypto = require('crypto');
const pool = require('../db/pool');

// Mesma lista de errorReportService.OPERACOES_EM_TESTE (repetida aqui porque
// aquele módulo depende deste; há teste conferindo que as duas batem).
const OPERACOES_EM_TESTE = [
  'social_posting',
  'social_conta',
  'social_conexao',
  'painel_novo_api',
  'painel_novo_tela',
  'lives',
  'lives_capacidade',
  'limite_do_plano',
];

// A assinatura decide o que é "o mesmo erro". Inclui a operação, a entidade e o
// começo da mensagem - não a mensagem inteira, porque quase todo erro carrega
// algo que muda a cada vez (timestamp, id de requisição, caminho de arquivo
// temporário). Se a assinatura mudasse junto, cada ocorrência viraria uma linha
// nova e a tela voltaria a ser um log.
function assinatura({ operation, entityType, entityId, message }) {
  const base = [operation, entityType || '', entityId || '', String(message || '').slice(0, 120)].join('|');
  return crypto.createHash('sha1').update(base).digest('hex');
}

// Registra uma falha. Se o mesmo erro já está aberto, soma no contador e
// atualiza a data - nunca cria linha nova.
async function record({
  operation,
  entityType = null,
  entityId = null,
  clientUserId = null,
  message,
  detail = null,
  contexto = null,
}) {
  const fingerprint = assinatura({ operation, entityType, entityId, message });
  const { rows } = await pool.query(
    `INSERT INTO system_errors (operation, entity_type, entity_id, client_user_id, message, detail, fingerprint)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (fingerprint) WHERE status <> 'resolvido'
     DO UPDATE SET
       occurrences  = system_errors.occurrences + 1,
       last_seen_at = now(),
       -- O detalhe mais recente é o que interessa pra investigar; o antigo já
       -- foi visto (ou não vai mais ser).
       detail       = EXCLUDED.detail,
       message      = EXCLUDED.message,
       -- Voltou a acontecer depois de uma tentativa: sai de "retentando" e
       -- volta pra "aberto", senão ficaria parecendo que a tentativa resolveu.
       status       = 'aberto'
     RETURNING *`,
    [operation, entityType, entityId, clientUserId, String(message || '').slice(0, 500), detail, fingerprint]
  );
  const erro = rows[0];
  // Cada ocorrência, com o contexto completo (a linha acima guarda só o último
  // detalhe). Limitado às 300 mais recentes por erro: um erro que repete a
  // cada 30 segundos o dia inteiro não pode encher o banco.
  await pool.query(
    `INSERT INTO system_error_events (error_id, client_user_id, message, detail, contexto)
     VALUES ($1, $2, $3, $4, $5)`,
    [erro.id, clientUserId, String(message || '').slice(0, 500), detail, contexto ? JSON.stringify(contexto) : null]
  );
  if (erro.occurrences % 50 === 0) {
    await pool.query(
      `DELETE FROM system_error_events
        WHERE error_id = $1
          AND id NOT IN (SELECT id FROM system_error_events WHERE error_id = $1 ORDER BY occurred_at DESC, id DESC LIMIT ${MAX_OCORRENCIAS_POR_ERRO})`,
      [erro.id]
    );
  }
  return erro;
}

const MAX_OCORRENCIAS_POR_ERRO = 300;

// As ocorrências de um erro, da mais recente pra mais antiga.
async function listEvents(errorId, limit = 50) {
  const { rows } = await pool.query(
    `SELECT ev.id, ev.occurred_at, ev.message, ev.detail, ev.contexto, ev.client_user_id,
            u.email AS client_email, u.business_name AS client_name
       FROM system_error_events ev LEFT JOIN users u ON u.id = ev.client_user_id
      WHERE ev.error_id = $1
      ORDER BY ev.occurred_at DESC, ev.id DESC LIMIT $2`,
    [errorId, limit]
  );
  return rows;
}

// `grupo`: 'principal' (o que todo cliente usa) ou 'teste' (novidades do
// painel novo, ver errorReportService.OPERACOES_EM_TESTE). Sem grupo, tudo.
function filtroDeGrupo(grupo, params) {
  if (grupo !== 'principal' && grupo !== 'teste') return 'true';
  params.push(OPERACOES_EM_TESTE);
  return grupo === 'teste' ? `e.operation = ANY($${params.length}::text[])` : `NOT (e.operation = ANY($${params.length}::text[]))`;
}

async function list({ status = 'abertos', limit = 200, grupo = null } = {}) {
  const filtro =
    status === 'resolvidos'
      ? "e.status = 'resolvido'"
      : status === 'todos'
        ? 'true'
        : "e.status <> 'resolvido'";

  const params = [limit];
  const doGrupo = filtroDeGrupo(grupo, params);
  const { rows } = await pool.query(
    `SELECT e.*, u.email AS client_email, u.business_name AS client_name
       FROM system_errors e
       LEFT JOIN users u ON u.id = e.client_user_id
      WHERE ${filtro} AND ${doGrupo}
      ORDER BY e.last_seen_at DESC
      LIMIT $1`,
    params
  );
  return rows;
}

async function findById(id) {
  const { rows } = await pool.query('SELECT * FROM system_errors WHERE id = $1', [id]);
  return rows[0] || null;
}

async function counts({ grupo = null } = {}) {
  const params = [];
  const doGrupo = filtroDeGrupo(grupo, params);
  const { rows } = await pool.query(
    `SELECT
       count(*) FILTER (WHERE status <> 'resolvido')::int AS abertos,
       count(*) FILTER (WHERE status = 'resolvido')::int  AS resolvidos,
       COALESCE(sum(occurrences) FILTER (WHERE status <> 'resolvido'), 0)::int AS ocorrencias_abertas
     FROM system_errors e WHERE ${doGrupo}`,
    params
  );
  return rows[0];
}

async function markRetrying(id) {
  const { rows } = await pool.query(
    `UPDATE system_errors
        SET status = 'retentando', retry_count = retry_count + 1, last_retry_at = now()
      WHERE id = $1
      RETURNING *`,
    [id]
  );
  return rows[0] || null;
}

// Volta pra "aberto" quando a tentativa nem chega a ser disparada (a fila
// recusou, a entidade sumiu). Sem isso a linha ficaria parada em "retentando"
// pra sempre, dando a impressão de que alguma coisa está rodando.
async function markOpenAgain(id) {
  await pool.query("UPDATE system_errors SET status = 'aberto' WHERE id = $1", [id]);
}

async function resolve(id) {
  const { rows } = await pool.query(
    `UPDATE system_errors SET status = 'resolvido', resolved_at = now() WHERE id = $1 RETURNING *`,
    [id]
  );
  return rows[0] || null;
}

// Fecha sozinho o erro de uma entidade quando ela volta a funcionar. É o que
// impede a lista de encher de coisa já resolvida que ninguém foi lá marcar.
async function resolveByEntity(operation, entityType, entityId) {
  const { rowCount } = await pool.query(
    `UPDATE system_errors
        SET status = 'resolvido', resolved_at = now()
      WHERE operation = $1 AND entity_type = $2 AND entity_id = $3 AND status <> 'resolvido'`,
    [operation, entityType, entityId]
  );
  return rowCount;
}

async function deleteResolvedOlderThan(dias = 30) {
  const { rowCount } = await pool.query(
    `DELETE FROM system_errors WHERE status = 'resolvido' AND resolved_at < now() - ($1 || ' days')::interval`,
    [String(dias)]
  );
  // Ocorrências de erro ainda aberto também envelhecem: 90 dias bastam pra
  // investigar, e o contador de system_errors continua contando tudo.
  await pool.query("DELETE FROM system_error_events WHERE occurred_at < now() - interval '90 days'");
  return rowCount;
}

module.exports = {
  OPERACOES_EM_TESTE,
  record,
  list,
  listEvents,
  findById,
  counts,
  markRetrying,
  markOpenAgain,
  resolve,
  resolveByEntity,
  deleteResolvedOlderThan,
};
