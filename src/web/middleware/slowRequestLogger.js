// Denuncia requisicao lenta no log.
//
// Hoje existem metricas de CPU/memoria/disco da VPS, mas NENHUMA de tempo de
// resposta do proprio site - se uma tela ficar lenta, nao ha nada gravado pra
// dizer qual rota e desde quando. Isso preenche esse buraco sem dependencia
// nova e sem custo perceptivel: so um timer por requisicao, e so escreve algo
// quando passa do limite.
'use strict';

const logger = require('../../lib/logger');

// 1s e generoso pra uma rota de painel (a maioria responde em dezenas de ms).
// Passar disso e sinal de consulta sem indice, chamada externa presa, ou
// contencao no banco.
const LIMITE_MS = 1000;

// Rotas que sao lentas por natureza e nao interessam aqui: subir um arquivo de
// ate 2GB ou baixar o video do corte demora mesmo.
const IGNORAR = [/\/upload$/, /\/download$/, /\/thumbnail$/];

function middleware(req, res, next) {
  if (IGNORAR.some((r) => r.test(req.path))) return next();

  const inicio = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - inicio) / 1e6;
    if (ms < LIMITE_MS) return;
    // req.route?.path em vez de req.path pra agrupar por rota (/videos/:id) em
    // vez de gerar uma linha diferente por ID.
    const rota = req.route?.path ? `${req.baseUrl}${req.route.path}` : req.path;
    logger.warn(`Requisicao lenta: ${req.method} ${rota} levou ${Math.round(ms)}ms (status ${res.statusCode}).`);
  });
  next();
}

module.exports = { middleware, LIMITE_MS };
