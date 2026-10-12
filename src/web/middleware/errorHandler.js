'use strict';

const logger = require('../../lib/logger');
const rotasEmTeste = require('../../lib/rotasEmTeste');
const errorReportService = require('../../services/errorReportService');

// Erro vindo do SDK da Stripe nao tem `status` (usa `statusCode`), entao caia
// sempre no 500 generico "Algo deu errado" - que na tela de pagamento e o pior
// texto possivel: o cliente clica em "Comprar" ou "Cadastrar cartao", nada
// acontece, e nao ha o que fazer com essa frase. A mensagem crua da Stripe
// tambem nao serve pro cliente (vem em ingles e cita id interno), entao ela
// fica so no log e a tela recebe uma frase que diz de qual sistema veio a
// falha e que nao houve cobranca.
function isStripeError(err) {
  return typeof err.type === 'string' && err.type.startsWith('Stripe');
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  logger.error(err);

  if (isStripeError(err)) {
    return req.path.startsWith('/api/')
      ? res.status(502).json({
          error: 'O sistema de pagamento não respondeu como esperado. Nada foi cobrado. Tente de novo em instantes.',
        })
      : res.status(502).render('errors/generic', {
          title: 'Erro',
          message: 'O sistema de pagamento não respondeu como esperado. Nada foi cobrado.',
        });
  }

  const status = err.status || 500;
  const message = status === 500 ? 'Algo deu errado. Tente novamente.' : err.message;

  // Todo erro de servidor vai pro painel de erros: os das novidades em teste
  // pra "Erros em teste", o resto pra "Erros". Sem await: registrar não pode
  // atrasar a resposta, e report() nunca lança. O corpo da requisição NÃO vai
  // (pode ter senha, cartão); só os nomes dos campos.
  if (status >= 500) {
    const emTeste = rotasEmTeste.ehRotaEmTeste(req.path);
    errorReportService.report({
      operation: emTeste ? errorReportService.OPERACOES.PAINEL_NOVO_API : errorReportService.OPERACOES.ERRO_SERVIDOR,
      entityType: 'rota',
      clientUserId: req.session && req.session.user ? req.session.user.id : null,
      error: err,
      message: `${req.method} ${rotasEmTeste.rotaSemIds(req.path)}: ${String(err.message || err).slice(0, 200)}`,
      contexto: {
        metodoHttp: req.method,
        rota: req.originalUrl ? req.originalUrl.split('?')[0] : req.path,
        parametrosDaUrl: Object.keys(req.query || {}),
        camposEnviados: req.body && typeof req.body === 'object' ? Object.keys(req.body).slice(0, 40) : [],
        papel: req.session && req.session.user ? req.session.user.role : null,
        navegador: req.get('user-agent'),
      },
    });
  }

  if (req.path.startsWith('/api/')) {
    return res.status(status).json({ error: message });
  }

  res.status(status).render('errors/generic', { title: 'Erro', message });
}

module.exports = errorHandler;
