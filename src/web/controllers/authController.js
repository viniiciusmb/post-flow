'use strict';

const authService = require('../../services/authService');
const publicController = require('./publicController');
const affiliateService = require('../../services/affiliateService');
const { ROLES } = require('../../config/constants');

async function login(req, res) {
  const { email, password } = req.body;
  const user = await authService.verifyLogin(email, password);

  if (!user) {
    return res.status(401).render('auth/login', { title: 'Entrar', error: res.locals.t('erros.credenciaisInvalidas') });
  }

  req.session.user = { id: user.id, role: user.role, email: user.email };
  res.redirect(user.role === ROLES.ADMIN ? '/admin' : '/client');
}

function showRegister(req, res) {
  res.render('auth/register', { title: res.locals.t('cadastro.titulo'), error: null, values: {} });
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
      title: res.locals.t('cadastro.titulo'),
      error: res.locals.t('cadastro.precisaAceitar'),
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

    // De onde esse cliente veio (indicacao/UTM) - capturado na sessao por
    // affiliateAttribution.js em qualquer visita a pagina publica antes do
    // cadastro. So vale pra conta NOVA, por isso fica aqui e nao em login.
    const attribution = req.session.affiliateAttribution;
    if (attribution) {
      await affiliateService.captureAttribution({
        referredUserId: user.id,
        refCode: attribution.refCode,
        utm: attribution.utm,
        landingPath: attribution.landingPath,
      });
      delete req.session.affiliateAttribution;
    }

    req.session.user = { id: user.id, role: user.role, email: user.email };
    res.redirect('/client');
  } catch (err) {
    res.status(400).render('auth/register', { title: res.locals.t('cadastro.titulo'), error: err.message, values });
  }
}

function logout(req, res) {
  req.session.destroy(() => res.redirect('/login'));
}

module.exports = { login, showRegister, register, logout };
