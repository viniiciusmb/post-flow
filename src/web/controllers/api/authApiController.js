'use strict';

const authService = require('../../../services/authService');

async function login(req, res) {
  const { email, password } = req.body;
  const user = await authService.verifyLogin(email, password);

  if (!user) {
    return res.status(401).json({ error: 'E-mail ou senha invalidos.' });
  }

  req.session.user = { id: user.id, role: user.role, email: user.email };
  res.json({ user: req.session.user });
}

function logout(req, res) {
  req.session.destroy(() => res.status(204).end());
}

function me(req, res) {
  res.json({ user: req.session.user });
}

module.exports = { login, logout, me };
