// Painel "Atividade" do admin: o que as pessoas fazem no painel e se deu certo.
// Ver middleware/registroDeAtividade e lib/atividade (os nomes legíveis).
'use strict';

const atividadeRepository = require('../../../repositories/atividadeRepository');
const atividade = require('../../../lib/atividade');
const { resolveRange } = require('../../../lib/dateRanges');
const errorReportService = require('../../../services/errorReportService');

function periodo(req) {
  return resolveRange(req.query.range, { since: req.query.since, until: req.query.until });
}

const incluirAdmin = (req) => req.query.admin === '1';

function acaoParaApi(a) {
  return {
    metodo: a.metodo,
    rota: a.rota,
    tipo: a.tipo,
    area: atividade.areaDe(a.rota),
    nome: atividade.rotuloDe(a.tipo, a.metodo, a.rota),
    total: a.total,
    ok: a.ok,
    recusadas: a.recusadas,
    falhas: a.falhas,
    pessoas: a.pessoas,
    duracaoMediaMs: a.duracao_media_ms,
    ultimaVez: a.ultima_vez,
    ultimaMensagem: a.ultima_mensagem,
  };
}

function pessoaParaApi(c) {
  return {
    id: Number(c.id),
    nome: c.business_name || c.email,
    email: c.email,
    admin: c.role === 'admin',
    plano: c.plano || null,
    eventos: c.eventos,
    acoes: c.acoes,
    paginas: c.paginas,
    recusadas: c.recusadas,
    falhas: c.falhas,
    primeiraVez: c.primeira_vez,
    ultimaVez: c.ultima_vez,
  };
}

// GET /api/admin/atividade?range=...&admin=1
async function visaoGeral(req, res) {
  const { range, since, until } = periodo(req);
  const opcoes = { desde: since, ate: until, incluirAdmin: incluirAdmin(req) };
  const [totais, acoes, sistema, pessoas] = await Promise.all([
    atividadeRepository.totais(opcoes),
    atividadeRepository.resumoPorAcao(opcoes),
    atividadeRepository.resultadosDoSistema(opcoes),
    atividadeRepository.clientes(opcoes),
  ]);
  res.json({
    periodo: { range, since, until },
    totais,
    acoes: acoes.map(acaoParaApi),
    sistema,
    pessoas: pessoas.map(pessoaParaApi),
  });
}

// GET /api/admin/atividade/pessoas/:id?range=...
async function linhaDoTempo(req, res) {
  const userId = Number(req.params.id);
  if (!Number.isFinite(userId)) return res.status(400).json({ error: 'Id inválido.' });
  const { since, until } = periodo(req);
  const linhas = await atividadeRepository.linhaDoTempo({ userId, desde: since, ate: until });
  res.json({
    eventos: linhas.map((l) => ({
      quando: l.quando,
      tipo: l.tipo, // pagina | acao | sistema | erro
      resultado: l.resultado,
      nome:
        l.tipo === 'pagina' || l.tipo === 'acao'
          ? atividade.rotuloDe(l.tipo, l.metodo, l.rota)
          : l.tipo === 'erro'
            ? errorReportService.ROTULO_OPERACAO[l.rota] || 'Erro registrado'
            : l.titulo,
      area: l.tipo === 'pagina' || l.tipo === 'acao' ? atividade.areaDe(l.rota) : l.tipo === 'erro' ? 'Erro' : 'Sistema',
      rota: l.tipo === 'pagina' || l.tipo === 'acao' ? `${l.metodo} ${l.rota}` : l.rota,
      itemId: l.recurso_id ? Number(l.recurso_id) : null,
      status: l.status,
      duracaoMs: l.duracao_ms,
      mensagem: l.mensagem,
    })),
  });
}

// GET /api/admin/atividade/agora?problemas=1&admin=1
async function agora(req, res) {
  const linhas = await atividadeRepository.recentes({
    limite: 150,
    incluirAdmin: incluirAdmin(req),
    soProblemas: req.query.problemas === '1',
  });
  res.json({
    eventos: linhas.map((l) => ({
      quando: l.created_at,
      pessoaId: l.user_id ? Number(l.user_id) : null,
      pessoa: l.business_name || l.email || 'Sem login',
      tipo: l.tipo,
      resultado: l.resultado,
      nome: atividade.rotuloDe(l.tipo, l.metodo, l.rota),
      area: atividade.areaDe(l.rota),
      rota: `${l.metodo} ${l.rota}`,
      status: l.status,
      duracaoMs: l.duracao_ms,
      mensagem: l.mensagem,
    })),
  });
}

module.exports = { visaoGeral, linhaDoTempo, agora };
