'use strict';

const authService = require('../../services/authService');
const { ROLES } = require('../../config/constants');

function showLogin(req, res) {
  res.render('auth/login', { title: 'Entrar', error: null });
}

async function login(req, res) {
  const { email, password } = req.body;
  const user = await authService.verifyLogin(email, password);

  if (!user) {
    return res.status(401).render('auth/login', { title: 'Entrar', error: 'E-mail ou senha invalidos.' });
  }

  req.session.user = { id: user.id, role: user.role, email: user.email };
  res.redirect(user.role === ROLES.ADMIN ? '/admin' : '/client');
}

function showRegister(req, res) {
  res.render('auth/register', { title: 'Criar conta', error: null });
}

async function register(req, res) {
  const { email, password, businessName } = req.body;

  try {
    const user = await authService.registerClient({ email, password, businessName });
    req.session.user = { id: user.id, role: user.role, email: user.email };
    res.redirect('/client');
  } catch (err) {
    res.status(400).render('auth/register', { title: 'Criar conta', error: err.message });
  }
}

function logout(req, res) {
  req.session.destroy(() => res.redirect('/login'));
}

module.exports = { showLogin, login, showRegister, register, logout };
