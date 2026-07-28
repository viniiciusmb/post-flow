'use strict';

// Bloqueia acesso a rotas que exigem login. Guarda o usuario na sessao apenas
// como { id, role } - dados completos sao buscados no banco quando precisos.
function requireAuth(req, res, next) {
  if (!req.session.user) {
    return res.redirect('/login');
  }
  next();
}

module.exports = requireAuth;
