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
async function listClientsWithStats() {
  const { rows } = await pool.query(
    `SELECT u.*,
            count(DISTINCT yc.id)::int AS channel_count,
            ta.display_name AS tiktok_display_name
     FROM users u
     LEFT JOIN youtube_channels yc ON yc.client_user_id = u.id
     LEFT JOIN tiktok_accounts ta ON ta.client_user_id = u.id AND ta.is_active = true
     WHERE u.role = 'client'
     GROUP BY u.id, ta.display_name
     ORDER BY u.created_at DESC`
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
