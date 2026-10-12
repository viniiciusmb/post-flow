// Registra cada página aberta e cada ação de quem usa o painel (migration 114),
// com o resultado: deu certo, foi recusada (a tela explicou) ou quebrou.
//
// Fica num middleware só, e não em cada controller, de propósito: assim toda
// ação nova já nasce monitorada, sem ninguém precisar lembrar de chamar nada.
// Grava a ROTA (com os ids trocados por :id), o status, o tempo e - quando não
// deu certo - a mensagem que o cliente viu. Nunca o corpo da requisição.
//
// A gravação é solta (sem await): o cliente nunca espera por ela, e falhar ao
// gravar só perde uma linha de estatística, nunca derruba a requisição.
'use strict';

const atividade = require('../../lib/atividade');
const atividadeRepository = require('../../repositories/atividadeRepository');
const logger = require('../../lib/logger');

const METODOS_DE_ACAO = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
// Ação sem sessão que ainda assim interessa: tentativa de entrar ou criar
// conta que falhou (fica sem dono, sem e-mail - só que aconteceu).
const ACOES_SEM_SESSAO = [/^\/login$/, /^\/register$/, /^\/api\/auth\/(login|forgot-password|reset-password)$/];

function tipoDa(req, rota) {
  if (METODOS_DE_ACAO.has(req.method)) return 'acao';
  if (req.method !== 'GET') return null;
  if (atividade.ehVoltaDeConexao(rota)) return 'acao';
  // Página do painel: /client... ou /admin..., sem extensão de arquivo.
  if (/^\/(client|admin)(\/|$)/.test(rota) && !/\.[a-z0-9]+$/i.test(rota)) return 'pagina';
  return null;
}

// A volta de uma conexão sempre responde com redirecionamento; o resultado
// está no endereço pra onde ela manda (erro=..., tiktok_error=...).
function resultadoDaVolta(res) {
  const destino = String(res.getHeader('location') || '');
  const q = destino.includes('?') ? new URLSearchParams(destino.split('?')[1]) : new URLSearchParams();
  const erro = q.get('tiktok_error') || q.get('erro') || q.get('error');
  if (!erro) return { resultado: 'ok', mensagem: null };
  return { resultado: 'recusada', mensagem: [erro, q.get('motivo')].filter(Boolean).join(': ').slice(0, 300) };
}

function registroDeAtividade(req, res, next) {
  const rota = atividade.normalizarRota(req.path);
  const tipo = tipoDa(req, rota);
  if (!tipo || atividade.ignorada(rota)) return next();

  // O dono é lido no começo E no fim: no login ele só existe depois; no logout
  // (e na exclusão de conta), só antes.
  const donoAntes = req.session && req.session.user ? req.session.user.id : null;
  const inicio = process.hrtime.bigint();
  let mensagem = null;

  const jsonOriginal = res.json.bind(res);
  res.json = (corpo) => {
    if (res.statusCode >= 400 && corpo && typeof corpo.error === 'string') mensagem = corpo.error.slice(0, 300);
    return jsonOriginal(corpo);
  };

  res.on('finish', () => {
    try {
      const dono = (req.session && req.session.user && req.session.user.id) || donoAntes;
      if (!dono && !ACOES_SEM_SESSAO.some((r) => r.test(rota))) return;
      const status = res.statusCode;
      // Página que redirecionou (tela que o plano não abre, login vencido) não
      // conta como página aberta.
      if (tipo === 'pagina' && status !== 200) return;
      let resultado = status >= 500 ? 'falhou' : status >= 400 ? 'recusada' : 'ok';
      if (tipo === 'acao' && req.method === 'GET') {
        const volta = resultadoDaVolta(res);
        resultado = status >= 500 ? 'falhou' : volta.resultado;
        mensagem = volta.mensagem;
      }
      atividadeRepository
        .registrar({
          userId: dono || null,
          tipo,
          metodo: req.method,
          rota,
          recursoId: atividade.primeiroId(req.path),
          status,
          resultado,
          duracaoMs: Math.round(Number(process.hrtime.bigint() - inicio) / 1e6),
          mensagem: resultado === 'ok' ? null : mensagem,
        })
        .catch((err) => logger.warn(`Nao consegui registrar a atividade ${req.method} ${rota}: ${err.message}`));
    } catch (err) {
      logger.warn(`Registro de atividade falhou: ${err.message}`);
    }
  });
  next();
}

module.exports = registroDeAtividade;
