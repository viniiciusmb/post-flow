// Tokens de redefinição de senha.
//
// O token que vai no e-mail NUNCA é guardado: o banco tem só o hash SHA-256
// dele. Assim um backup vazado ou um dump de desenvolvimento não dá pra
// ninguém a chave de entrar em conta alheia.
'use strict';

const crypto = require('crypto');
const pool = require('../db/pool');

// 30 minutos. Curto o bastante pra limitar o estrago de um e-mail que ficou
// aberto numa máquina compartilhada, longo o bastante pra quem só vê o e-mail
// mais tarde ainda conseguir usar.
const VALIDADE_MINUTOS = 30;

function hashDoToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// Gera o token bruto (que vai no link) e guarda só o hash.
async function create(userId, { requestedIp = null } = {}) {
  // 32 bytes de aleatoriedade criptográfica: inviável de adivinhar por força
  // bruta, e não previsível a partir de outro token.
  const token = crypto.randomBytes(32).toString('base64url');

  // Um pedido novo invalida os anteriores. Sem isso, pedir "esqueci a senha"
  // três vezes deixaria três links vivos ao mesmo tempo, e o cliente
  // provavelmente clicaria no mais antigo (o primeiro que chegou na caixa).
  await pool.query(
    'UPDATE password_reset_tokens SET used_at = now() WHERE user_id = $1 AND used_at IS NULL',
    [userId]
  );

  await pool.query(
    `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at, requested_ip)
     VALUES ($1, $2, now() + ($3 || ' minutes')::interval, $4)`,
    [userId, hashDoToken(token), String(VALIDADE_MINUTOS), requestedIp]
  );

  return { token, expiraEmMinutos: VALIDADE_MINUTOS };
}

// Devolve o usuário dono de um token ainda válido, ou null.
async function findValidUser(token) {
  const { rows } = await pool.query(
    `SELECT prt.id, prt.user_id, u.email
     FROM password_reset_tokens prt
     JOIN users u ON u.id = prt.user_id
     WHERE prt.token_hash = $1
       AND prt.used_at IS NULL
       AND prt.expires_at > now()
       AND u.is_active = true`,
    [hashDoToken(token)]
  );
  return rows[0] || null;
}

// Marca como usado. O UPDATE condicional garante uso único mesmo se dois
// cliques chegarem ao mesmo tempo: só um consegue marcar, o outro vê rowCount 0.
async function markUsed(id) {
  const { rowCount } = await pool.query(
    'UPDATE password_reset_tokens SET used_at = now() WHERE id = $1 AND used_at IS NULL',
    [id]
  );
  return rowCount > 0;
}

// Quantos pedidos esse usuário fez na última hora. Trava simples contra alguém
// usar o formulário pra encher a caixa de e-mail de outra pessoa.
async function countRecentByUser(userId, minutos = 60) {
  const { rows } = await pool.query(
    `SELECT count(*)::int AS total FROM password_reset_tokens
     WHERE user_id = $1 AND created_at > now() - ($2 || ' minutes')::interval`,
    [userId, String(minutos)]
  );
  return rows[0].total;
}

async function deleteExpired() {
  const { rowCount } = await pool.query(
    "DELETE FROM password_reset_tokens WHERE expires_at < now() - interval '7 days'"
  );
  return rowCount;
}

module.exports = { VALIDADE_MINUTOS, create, findValidUser, markUsed, countRecentByUser, deleteExpired };
