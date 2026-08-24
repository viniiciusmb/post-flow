'use strict';

const pool = require('../db/pool');

async function findByEmail(email) {
  const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]);
  return rows[0] || null;
}

async function findById(id) {
  const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
  return rows[0] || null;
}

async function create({ email, passwordHash, role, businessName = null, termsVersion = null }) {
  const { rows } = await pool.query(
    `INSERT INTO users (email, password_hash, role, business_name, terms_accepted_at, terms_version)
     VALUES ($1, $2, $3, $4, CASE WHEN $5::text IS NULL THEN NULL ELSE now() END, $5)
     RETURNING *`,
    [email.toLowerCase(), passwordHash, role, businessName, termsVersion]
  );
  return rows[0];
}

async function findByGoogleSub(googleSub) {
  const { rows } = await pool.query('SELECT * FROM users WHERE google_sub = $1', [googleSub]);
  return rows[0] || null;
}

// Liga uma conta Google a uma conta que ja existe aqui. So e chamada depois de
// o Google confirmar que o e-mail e verificado - e essa checagem que impede
// alguem de assumir a conta de outra pessoa.
async function linkGoogleAccount(id, { sub, email }) {
  const { rows } = await pool.query(
    `UPDATE users SET google_sub = $2, google_email = $3, updated_at = now()
      WHERE id = $1 RETURNING *`,
    [id, sub, email]
  );
  return rows[0] || null;
}

// Conta criada na hora pelo login com Google. Sem senha (password_hash fica
// NULL): quem entra por aqui nao tem senha pra vazar. Se um dia quiser entrar
// por senha, usa o "esqueci minha senha" e define uma.
async function createFromGoogle({ email, businessName, googleSub, termsVersion = null }) {
  const { rows } = await pool.query(
    `INSERT INTO users (email, password_hash, role, business_name, google_sub, google_email,
                        terms_accepted_at, terms_version)
     VALUES ($1, NULL, 'client', $2, $3, $1,
             CASE WHEN $4::text IS NULL THEN NULL ELSE now() END, $4)
     RETURNING *`,
    [email.toLowerCase(), businessName, googleSub, termsVersion]
  );
  return rows[0];
}

async function listByRole(role) {
  const { rows } = await pool.query(
    'SELECT * FROM users WHERE role = $1 ORDER BY created_at DESC',
    [role]
  );
  return rows;
}

async function updateProfile(id, { businessName, email }) {
  const { rows } = await pool.query(
    'UPDATE users SET business_name = $2, email = $3, updated_at = now() WHERE id = $1 RETURNING *',
    [id, businessName, email.toLowerCase()]
  );
  return rows[0];
}

async function updatePasswordHash(id, passwordHash) {
  await pool.query('UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1', [id, passwordHash]);
}

async function setActive(id, isActive) {
  const { rows } = await pool.query(
    'UPDATE users SET is_active = $2, updated_at = now() WHERE id = $1 RETURNING *',
    [id, isActive]
  );
  return rows[0] || null;
}

async function touchLastActive(id) {
  await pool.query('UPDATE users SET last_active_at = now() WHERE id = $1', [id]);
}

// Lista clientes com contagem de canais e status da conta TikTok - usada na
// tela admin "Clientes".
// Lista da tela "Clientes" do admin, com plano, custo gerado e cortes
// postados no periodo escolhido.
//
// Cada numero por periodo sai de uma SUBCONSULTA, e nao de mais um LEFT JOIN
// somado: juntar videos e postagens na mesma consulta multiplicaria as linhas
// uma pela outra e o custo apareceria inflado pelo numero de postagens (e
// vice-versa). Classico erro de "fan-out" em relatorio.
//
// A conta de banda repete a regra que ja vale no painel de processamento: so
// vira dinheiro o que saiu por PROXY PAGO. Tunel (do cliente ou do fundador) e
// reaproveitamento nao custam nada por GB - a banda ja esta paga na conta de
// internet, e cobrar aqui inventaria um custo que nao existe.
const ORDENS = {
  recentes: 'u.created_at DESC',
  antigos: 'u.created_at ASC',
  maior_custo: 'custo_usd DESC, u.created_at DESC',
};

async function listClientsWithStats({ since, until, precoPorGb = 0, ordem = 'recentes' } = {}) {
  const orderBy = ORDENS[ordem] || ORDENS.recentes;
  // Sem periodo (chamada antiga), pega tudo - assim quem ja usava esta funcao
  // continua vendo o total, e nao um zero silencioso.
  const de = since || new Date('2020-01-01T00:00:00.000Z');
  const ate = until || new Date();

  const { rows } = await pool.query(
    `SELECT u.*,
            (SELECT count(*)::int FROM youtube_channels yc WHERE yc.client_user_id = u.id) AS channel_count,
            -- Nome da PRIMEIRA conta ativa. Antes isto era um LEFT JOIN com
            -- GROUP BY no display_name, o que repetia o cliente uma vez por
            -- conta do TikTok - quem tinha 3 contas aparecia 3 vezes na lista.
            (SELECT ta.display_name FROM tiktok_accounts ta
              WHERE ta.client_user_id = u.id AND ta.is_active = true
              ORDER BY ta.id LIMIT 1) AS tiktok_display_name,
            (SELECT count(*)::int FROM tiktok_accounts ta
              WHERE ta.client_user_id = u.id AND ta.is_active = true) AS tiktok_account_count,
            sp.key AS plan_key,
            sp.name AS plan_name,
            cs.status AS subscription_status,
            (SELECT coalesce(sum(
                      coalesce(sv.whisper_cost_usd, 0)
                      + coalesce(sv.claude_cost_usd, 0)
                      + CASE WHEN sv.download_egress_type = 'proxy'
                             THEN (coalesce(sv.download_bytes, 0) / 1073741824.0) * $3
                             ELSE 0 END
                    ), 0)
               FROM source_videos sv
              WHERE sv.owner_client_user_id = u.id
                AND sv.created_at >= $1 AND sv.created_at <= $2) AS custo_usd,
            (SELECT count(*)::int
               FROM postings p
               JOIN tiktok_accounts ta2 ON ta2.id = p.tiktok_account_id
              WHERE ta2.client_user_id = u.id
                AND p.status = 'posted'
                AND p.posted_at >= $1 AND p.posted_at <= $2) AS clips_posted
     FROM users u
     LEFT JOIN client_subscriptions cs ON cs.client_user_id = u.id
     LEFT JOIN subscription_plans sp ON sp.id = cs.plan_id
     WHERE u.role = 'client'
     ORDER BY ${orderBy}`,
    [de, ate, precoPorGb]
  );
  return rows;
}

// CPF/CNPJ so e pedido (e so existe) pra quem paga por PIX Automatico - a
// autorizacao exige um cliente cadastrado no Asaas, e o Asaas nao cria
// cliente sem documento. Quem paga com cartao nunca informa CPF pra nos: a
// tela do proprio Asaas coleta o que precisa.
async function setCpfCnpj(id, cpfCnpj) {
  const { rows } = await pool.query(
    'UPDATE users SET cpf_cnpj = $2, updated_at = now() WHERE id = $1 RETURNING *',
    [id, cpfCnpj]
  );
  return rows[0] || null;
}

module.exports = {
  setCpfCnpj,
  findByGoogleSub,
  linkGoogleAccount,
  createFromGoogle,
  findByEmail,
  findById,
  create,
  listByRole,
  setActive,
  touchLastActive,
  listClientsWithStats,
  updateProfile,
  updatePasswordHash,
};
