'use strict';

function requireRoleApi(roleOrRoles) {
  const allowed = Array.isArray(roleOrRoles) ? roleOrRoles : [roleOrRoles];
  return function (req, res, next) {
    if (!req.session.user || !allowed.includes(req.session.user.role)) {
      return res.status(403).json({ error: 'Acesso negado.' });
    }
    next();
  };
}

module.exports = requireRoleApi;
