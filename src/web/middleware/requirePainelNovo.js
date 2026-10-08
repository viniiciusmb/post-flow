'use strict';

const painelNovo = require('../../lib/painelNovo');

// Telas e rotas do painel remodelado, em teste com poucas contas (ver
// lib/painelNovo). A versão de página redireciona pro painel antigo em vez de
// dar 403: quem não está no teste não precisa saber que a tela existe.
function api(req, res, next) {
  painelNovo
    .ehPainelNovo(req.session.user)
    .then((ok) => (ok ? next() : res.status(403).json({ error: 'Acesso negado.' })))
    .catch(next);
}

function pagina(destinoSemAcesso) {
  return function (req, res, next) {
    painelNovo
      .ehPainelNovo(req.session.user)
      .then((ok) => (ok ? next() : res.redirect(destinoSemAcesso)))
      .catch(next);
  };
}

module.exports = { api, pagina };
