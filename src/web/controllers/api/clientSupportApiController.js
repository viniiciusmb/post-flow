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

// Com "Accept: text/event-stream" a resposta vem em etapas (o que a Flora
// esta fazendo agora) e termina com a resposta inteira; sem ele, um JSON so.
// O cabecalho do stream so e enviado no primeiro evento: erro de validacao
// (mensagem vazia, limite do dia) continua saindo como um JSON com status.
async function send(req, res) {
  const id = idDeConversa(req.body && req.body.conversationId);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Conversa inválida.' });
  const texto = req.body && typeof req.body.message === 'string' ? req.body.message : '';
  const emEtapas = String(req.headers.accept || '').includes('text/event-stream');

  let aberto = false;
  function evento(dados) {
    if (!aberto) {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        // no-transform: o middleware de compressao nao segura o stream.
        'Cache-Control': 'no-cache, no-transform',
        'X-Accel-Buffering': 'no',
      });
      aberto = true;
    }
    res.write(`data: ${JSON.stringify(dados)}\n\n`);
  }

  try {
    const r = await suporteService.enviarMensagem({
      clientUserId: req.session.user.id,
      conversationId: id,
      texto,
      aoProgresso: emEtapas ? evento : undefined,
    });
    if (!emEtapas) return res.json(r);
    evento({ etapa: 'fim', ...r });
    return res.end();
  } catch (err) {
    if (err instanceof suporteService.SuporteError) {
      if (aberto) {
        evento({ etapa: 'erro', error: err.message });
        return res.end();
      }
      return res.status(err.status).json({ error: err.message });
    }
    if (aberto) {
      evento({ etapa: 'erro', error: 'Algo deu errado. Tente de novo.' });
      return res.end();
    }
    throw err;
  }
}

module.exports = { current, send };
