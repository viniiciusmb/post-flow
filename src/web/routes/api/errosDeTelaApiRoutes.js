'use strict';

// Erro de JavaScript nas telas novas, mandado pelo próprio navegador. É o que
// pega a "tela branca": um erro desses não chega no servidor por nenhum outro
// caminho (foi assim com a tela de Planos em 21/08/2026, achada só porque o
// fundador abriu a página). Só painel novo; vai pra tela "Erros em teste".
const express = require('express');
const requireAuthApi = require('../../middleware/requireAuthApi');
const requirePainelNovo = require('../../middleware/requirePainelNovo');
const asyncHandler = require('../../lib/asyncHandler');
const errorReportService = require('../../../services/errorReportService');

const router = express.Router();
router.use(requireAuthApi, requirePainelNovo.api);

const limpar = (v, max) => String(v || '').replace(/[\u0000-\u001f]/g, ' ').slice(0, max);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const mensagem = limpar(req.body?.mensagem, 300);
    if (!mensagem) return res.status(400).json({ error: 'Mensagem vazia.' });
    const pagina = limpar(req.body?.pagina, 120).replace(/\?.*$/, '');
    const err = new Error(mensagem);
    err.stack = `${mensagem}\n${limpar(req.body?.pilha, 3000)}`;
    await errorReportService.report({
      operation: errorReportService.OPERACOES.PAINEL_NOVO_TELA,
      entityType: 'tela',
      clientUserId: req.session.user.id,
      error: err,
      message: `${pagina}: ${mensagem}`,
    });
    res.status(204).end();
  })
);

module.exports = router;
