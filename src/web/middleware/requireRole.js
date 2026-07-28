'use strict';

// Uso: requireRole('admin') ou requireRole('client') como middleware de rota.
// Deve ser usado sempre depois de requireAuth.
function requireRole(role) {
  return function (req, res, next) {
    if (!req.session.user || req.session.user.role !== role) {
      return res.status(403).send('Acesso negado.');
    }
    next();
  };
}

module.exports = requireRole;
