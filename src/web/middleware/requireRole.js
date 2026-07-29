'use strict';

// Uso: requireRole('admin') ou requireRole(['client', 'admin']) como middleware
// de rota. Deve ser usado sempre depois de requireAuth.
function requireRole(roleOrRoles) {
  const allowed = Array.isArray(roleOrRoles) ? roleOrRoles : [roleOrRoles];
  return function (req, res, next) {
    if (!req.session.user || !allowed.includes(req.session.user.role)) {
      return res.status(403).send('Acesso negado.');
    }
    next();
  };
}

module.exports = requireRole;
