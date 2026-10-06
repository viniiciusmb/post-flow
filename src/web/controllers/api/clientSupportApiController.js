// Suporte com IA - lado do cliente. O id do cliente vem SEMPRE da sessao; o
// corpo da requisicao so traz o texto e (opcionalmente) qual conversa.
'use strict';

const suporteService = require('../../../services/suporte/suporteService');

function idDeConversa(valor) {
  if (valor === undefined || valor === null || valor === '') return null;
  const id = Number(valor);
  return Number.isInteger(id) && id > 0 ? id : NaN;
}

async function current(req, res) {
  const id = idDeConversa(req.query.conversationId);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Conversa inválida.' });
  const conversa = await suporteService.conversaAtual(req.session.user.id, id);
  res.json({ conversation: conversa, limits: { maxChars: suporteService.MAX_CARACTERES_POR_MENSAGEM } });
}

async function send(req, res) {
  const id = idDeConversa(req.body && req.body.conversationId);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Conversa inválida.' });
  const texto = req.body && typeof req.body.message === 'string' ? req.body.message : '';
  try {
    const r = await suporteService.enviarMensagem({ clientUserId: req.session.user.id, conversationId: id, texto });
    res.json(r);
  } catch (err) {
    if (err instanceof suporteService.SuporteError) return res.status(err.status).json({ error: err.message });
    throw err;
  }
}

module.exports = { current, send };
