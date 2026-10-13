'use strict';

// Erro de JavaScript nas telas, mandado pelo próprio navegador. É o que pega a
// "tela branca": um erro desses não chega no servidor por nenhum outro caminho
// (foi assim com a tela de Planos em 21/08/2026, achada só porque o fundador
// abriu a página). Vale pra todo cliente logado desde 12/10/2026: quem está no
// painel novo cai em "Erros em teste", o resto em "Erros".
const express = require('express');
const requireAuthApi = require('../../middleware/requireAuthApi');
const painelNovo = require('../../../lib/painelNovo');
const asyncHandler = require('../../lib/asyncHandler');
const errorReportService = require('../../../services/errorReportService');

const router = express.Router();
router.use(requireAuthApi);

const limpar = (v, max) => String(v || '').replace(/[\u0000-\u001f]/g, ' ').slice(0, max);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const mensagem = limpar(req.body?.mensagem, 300);
    if (!mensagem) return res.status(400).json({ error: 'Mensagem vazia.' });
    const pagina = limpar(req.body?.pagina, 120).replace(/\?.*$/, '');
    const err = new Error(mensagem);
    err.stack = `${mensagem}\n${limpar(req.body?.pilha, 3000)}`;
    const novo = await painelNovo.ehPainelNovo(req.session.user);
    await errorReportService.report({
      operation: errorReportService.OPERACOES.ERRO_TELA,
      entityType: 'tela',
      clientUserId: req.session.user.id,
      error: err,
      message: `${pagina}: ${mensagem}`,
      contexto: {
        pagina,
        navegador: req.get('user-agent'),
        tela: limpar(req.body?.tela, 40) || null,
        idioma: limpar(req.body?.idioma, 20) || null,
        painelNovo: novo,
      },
    });
    res.status(204).end();
  })
);

module.exports = router;
