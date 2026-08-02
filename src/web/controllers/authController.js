'use strict';

const authService = require('../../services/authService');
const publicController = require('./publicController');
const { ROLES } = require('../../config/constants');

async function login(req, res) {
  const { email, password } = req.body;
  const user = await authService.verifyLogin(email, password);

  if (!user) {
    return res.status(401).render('auth/login', { title: 'Entrar', error: 'E-mail ou senha inválidos.' });
  }

  req.session.user = { id: user.id, role: user.role, email: user.email };
  res.redirect(user.role === ROLES.ADMIN ? '/admin' : '/client');
}

function showRegister(req, res) {
  res.render('auth/register', { title: 'Criar conta', error: null, values: {} });
}

async function register(req, res) {
  const { email, password, businessName, acceptedTerms } = req.body;
  // Devolve o que ja foi digitado quando o cadastro falha - sem isso, o
  // usuario preenche tudo de novo a cada erro.
  const values = { email, businessName };

  // O atributo "required" do checkbox so vale dentro do navegador; um POST
  // direto passaria por cima. A checagem que conta e esta.
  if (!acceptedTerms) {
    return res.status(400).render('auth/register', {
      title: 'Criar conta',
      error: 'Você precisa aceitar os Termos de Uso e a Politica de Privacidade pra criar a conta.',
      values,
    });
  }

  try {
    const user = await authService.registerClient({
      email,
      password,
      businessName,
      // Guarda QUAL versao do documento foi aceita, nao so que houve aceite -
      // quando os termos mudarem, da pra saber quem aceitou o texto antigo.
      termsVersion: publicController.LEGAL_UPDATED_AT,
    });
    req.session.user = { id: user.id, role: user.role, email: user.email };
    res.redirect('/client');
  } catch (err) {
    res.status(400).render('auth/register', { title: 'Criar conta', error: err.message, values });
  }
}

function logout(req, res) {
  req.session.destroy(() => res.redirect('/login'));
}

module.exports = { login, showRegister, register, logout };
