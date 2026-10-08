'use strict';

const express = require('express');
const requireAuth = require('../middleware/requireAuth');
const requireRole = require('../middleware/requireRole');
const serveSpaPage = require('../lib/serveSpaPage');
const { ROLES } = require('../../config/constants');
const exibicaoDoTunel = require('../../lib/exibicaoDoTunel');
const requirePainelNovo = require('../middleware/requirePainelNovo');
const asyncHandler = require('../lib/asyncHandler');
const socialAccountsApiController = require('../controllers/api/socialAccountsApiController');

const router = express.Router();

router.use(requireAuth, requireRole([ROLES.CLIENT, ROLES.ADMIN]));

router.get('/', serveSpaPage('client'));
router.get('/youtube-channels', serveSpaPage('youtube-channels'));
router.get('/videos-clips', serveSpaPage('videos-clips'));
router.get('/tiktok-account', serveSpaPage('tiktok-account'));
router.get('/settings', serveSpaPage('client-settings'));
// A pagina da conexao some junto com o menu quando o fundador desliga a
// exibicao do tunel. Sem isto, "esconder o menu" deixaria a tela viva pra quem
// digitasse o endereco, tivesse o link no historico, ou clicasse num link
// antigo - e o pedido foi que nao aparecesse absolutamente nada.
//
// Redireciona em vez de dar 404: a pagina EXISTE e volta a funcionar assim que
// a chave for ligada. Um 404 diria "isso nao existe", que nao e verdade.
//
// A FUNCIONALIDADE continua inteira: as rotas /api/client/tunnel seguem no ar,
// quem ja tem o programa pareado continua baixando pela internet dele e
// ganhando a cota bonus. E so a porta de entrada visual que fecha.
router.get('/tunnel', async (req, res, next) => {
  try {
    if (!(await exibicaoDoTunel.mostrarTunel())) return res.redirect('/client');
  } catch (err) {
    return next(err);
  }
  return serveSpaPage('tunnel')(req, res, next);
});
router.get('/billing', serveSpaPage('client-billing'));
// Checkout transparente: o pagamento acontece aqui dentro, sem sair do site.
router.get('/checkout', serveSpaPage('client-checkout'));
router.get('/commissions', serveSpaPage('client-commissions'));
router.get('/tutorial', serveSpaPage('tutorial'));
router.get('/support', serveSpaPage('client-support'));
// Tela "Lives" (a que vai pros clientes) - em teste, so o admin e as contas do
// painel novo abrem. Ver routes/api/livesApiRoutes.js para o que trocar quando abrir.
router.get('/lives', requirePainelNovo.pagina('/client'), serveSpaPage('client-lives'));

// Painel remodelado (08/10/2026), em teste com o admin e a Rise Style (ver
// lib/painelNovo). Quem nao esta no teste cai na tela antiga equivalente.
router.get('/youtube', requirePainelNovo.pagina('/client/youtube-channels'), serveSpaPage('youtube-videos'));
router.get('/social', requirePainelNovo.pagina('/client/tiktok-account'), serveSpaPage('social-networks'));
// Volta do navegador depois de autorizar o Instagram/Facebook na Outstand.
router.get(
  '/social/retorno/:network',
  requirePainelNovo.pagina('/client/tiktok-account'),
  asyncHandler(socialAccountsApiController.retorno)
);

module.exports = router;
