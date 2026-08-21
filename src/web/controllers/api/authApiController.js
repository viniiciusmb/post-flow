'use strict';

const authService = require('../../../services/authService');
const usersRepository = require('../../../repositories/usersRepository');
const subscriptionCheckoutService = require('../../../services/subscriptionCheckoutService');

const SEVEN_DAYS_MS = 1000 * 60 * 60 * 24 * 7;
const THIRTY_DAYS_MS = 1000 * 60 * 60 * 24 * 30;

async function login(req, res) {
  const { email, password, rememberMe } = req.body;
  const user = await authService.verifyLogin(email, password);

  if (!user) {
    return res.status(401).json({ error: res.locals.t('erros.credenciaisInvalidas') });
  }

  // Plano escolhido na landing por quem JA tinha conta: a tela de entrar e a
  // SPA, entao ela decide pra onde ir depois do login. Sem mandar o destino
  // daqui, esse caminho perdia a escolha e caia no painel - o mesmo beco sem
  // saida que o cadastro tinha. Usado uma vez so (consumido da sessao).
  const planKey = req.session.planoEscolhido || null;
  if (planKey) delete req.session.planoEscolhido;

  req.session.user = { id: user.id, role: user.role, email: user.email };
  req.session.cookie.maxAge = rememberMe ? THIRTY_DAYS_MS : SEVEN_DAYS_MS;
  await usersRepository.touchLastActive(user.id);

  const redirectTo = await subscriptionCheckoutService.destinoDepoisDeEntrar({
    user,
    planKey,
    origin: `${req.protocol}://${req.get('host')}`,
    returnTo: subscriptionCheckoutService.consumirReturnTo(req),
  });
  res.json({ user: req.session.user, redirectTo });
}

function logout(req, res) {
  req.session.destroy(() => res.status(204).end());
}

function me(req, res) {
  res.json({ user: req.session.user });
}

module.exports = { login, logout, me };
