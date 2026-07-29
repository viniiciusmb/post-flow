'use strict';

// Versao da requireAuth que responde JSON em vez de redirecionar - usada
// pelas rotas /api/* que o frontend React consome via fetch().
function requireAuthApi(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({ error: 'Nao autenticado.' });
  }
  next();
}

module.exports = requireAuthApi;
