// Painel de receita do admin: quanto entrou, de onde, e quanto entra por mês.
//
// Os números saem todos do receitaService - a tela Início usa as mesmas
// funções, então os dois lugares nunca discordam.
'use strict';

const receitaService = require('../../../services/receitaService');
const { resolveRange } = require('../../../lib/dateRanges');

async function overview(req, res) {
  const { range, since, until } = resolveRange(req.query.range, {
    since: req.query.since,
    until: req.query.until,
  });
  const painel = await receitaService.painel({ since, until });
  res.json({ range: { key: range, since, until }, ...painel });
}

module.exports = { overview };
