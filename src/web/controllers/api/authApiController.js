'use strict';

const authService = require('../../../services/authService');

const SEVEN_DAYS_MS = 1000 * 60 * 60 * 24 * 7;
const THIRTY_DAYS_MS = 1000 * 60 * 60 * 24 * 30;

async function login(req, res) {
  const { email, password, rememberMe } = req.body;
  const user = await authService.verifyLogin(email, password);

  if (!user) {
    return res.status(401).json({ error: 'E-mail ou senha invalidos.' });
  }

  req.session.user = { id: user.id, role: user.role, email: user.email };
  req.session.cookie.maxAge = rememberMe ? THIRTY_DAYS_MS : SEVEN_DAYS_MS;
  res.json({ user: req.session.user });
}

function logout(req, res) {
  req.session.destroy(() => res.status(204).end());
}

function me(req, res) {
  res.json({ user: req.session.user });
}

module.exports = { login, logout, me };
