// Cliente com a mensalidade vencida não usa nada do painel (14/10/2026,
// decisão do fundador) - só o que serve pra regularizar: Plano e uso, o
// checkout, a exclusão da conta e os avisos. A tela mostra um pop-up que não
// fecha com o botão de pagar (DashboardLayout); isto aqui é a trava de verdade,
// porque a tela sozinha não impede uma chamada direta.
'use strict';

const assinaturaEmDiaService = require('../../services/assinaturaEmDiaService');
const logger = require('../../lib/logger');

// Caminhos relativos a /api/client.
const LIBERADAS = ['/billing', '/checkout', '/conta', '/erros-de-tela', '/notices'];

async function bloqueioPorPagamento(req, res, next) {
  const u = req.session && req.session.user;
  if (!u || u.role !== 'client') return next();
  if (LIBERADAS.some((p) => req.path === p || req.path.startsWith(`${p}/`))) return next();
  try {
    if (!(await assinaturaEmDiaService.pagamentoPendente(u.id))) return next();
  } catch (err) {
    // Banco fora do ar não pode virar "todo mundo bloqueado".
    logger.error('Bloqueio por pagamento: nao consegui conferir a assinatura:', err.message);
    return next();
  }
  return res.status(402).json({
    error: 'Sua mensalidade está em aberto. Regularize o pagamento em Plano e uso para voltar a usar o Post Flow.',
    pagamentoPendente: true,
  });
}

module.exports = bloqueioPorPagamento;
module.exports.LIBERADAS = LIBERADAS;
