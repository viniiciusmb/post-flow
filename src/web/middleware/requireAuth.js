'use strict';

// Bloqueia acesso a rotas que exigem login. Guarda o usuario na sessao apenas
// como { id, role } - dados completos sao buscados no banco quando precisos.
// Caminho interno seguro: tem que comecar com uma barra so. "//outro.site"
// e "https://outro.site" sao lidos pelo navegador como OUTRO dominio - sem
// esta checagem, um link montado por terceiro mandaria a pessoa pra fora do
// site logo depois de ela digitar a senha, que e o momento em que ela menos
// desconfia.
function destinoSeguro(url) {
  return typeof url === 'string' && url.startsWith('/') && !url.startsWith('//') ? url : null;
}

function requireAuth(req, res, next) {
  if (!req.session.user) {
    // Guarda pra onde a pessoa estava indo, pra devolve-la ali depois do
    // login. Sem isso, quem volta de um pagamento (ou abre um link direto do
    // painel) sem sessao ativa cai no login e depois no inicio, sem nunca
    // chegar onde queria - foi exatamente o "me levou pra lugar nenhum" de
    // quem voltou da tela de pagamento do Asaas.
    //
    // So GET: reenviar um POST depois do login repetiria uma acao (uma
    // compra, por exemplo) que a pessoa nao pediu de novo.
    if (req.method === 'GET') req.session.returnTo = destinoSeguro(req.originalUrl);
    return res.redirect('/login');
  }
  next();
}

module.exports = requireAuth;
module.exports.destinoSeguro = destinoSeguro;
