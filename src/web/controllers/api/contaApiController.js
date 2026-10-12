// Exclusão da própria conta (12/10/2026, painel novo). Ver exclusaoDeContaService.
'use strict';

const bcrypt = require('bcryptjs');
const pool = require('../../../db/pool');
const exclusaoDeContaService = require('../../../services/exclusaoDeContaService');
const logger = require('../../../lib/logger');

// GET /api/client/conta/exclusao - o que vai ser apagado, pra tela avisar antes.
async function resumoDaExclusao(req, res) {
  const { rows } = await pool.query('SELECT password_hash IS NOT NULL AS tem_senha FROM users WHERE id = $1', [req.session.user.id]);
  res.json({ ...(await exclusaoDeContaService.resumo(req.session.user.id)), pedeSenha: rows[0]?.tem_senha === true });
}

// DELETE /api/client/conta { confirmacao: "EXCLUIR", senha }
async function excluir(req, res) {
  const userId = req.session.user.id;
  if (String(req.body?.confirmacao || '').trim().toUpperCase() !== 'EXCLUIR') {
    return res.status(400).json({ error: 'Digite EXCLUIR para confirmar.' });
  }
  // Quem entra com senha confirma com a senha: uma sessão esquecida aberta num
  // computador emprestado não pode bastar pra apagar tudo. Quem só entra pelo
  // Google não tem senha, e a confirmação por texto é o que sobra.
  const { rows } = await pool.query('SELECT password_hash FROM users WHERE id = $1', [userId]);
  const hash = rows[0]?.password_hash;
  if (hash && !(await bcrypt.compare(String(req.body?.senha || ''), hash))) {
    return res.status(400).json({ error: 'Senha incorreta.' });
  }
  try {
    await exclusaoDeContaService.excluirConta(userId);
  } catch (err) {
    if (err instanceof exclusaoDeContaService.ExclusaoError) return res.status(err.status).json({ error: err.message });
    throw err;
  }
  logger.info(`Conta ${userId} excluida a pedido do proprio cliente.`);
  req.session.destroy(() => res.json({ ok: true }));
}

module.exports = { resumoDaExclusao, excluir };
