// Conexão das contas de Instagram, Facebook, Threads, LinkedIn, Pinterest,
// Bluesky e YouTube (via Outstand).
//
// O fluxo atravessa três sites (Post Flow -> Outstand -> Meta -> Outstand ->
// Post Flow), e o ponto delicado é a volta: a URL de retorno traz o id da conta
// conectada, e qualquer um pode montar essa URL à mão. Por isso a conta só é
// vinculada quando as TRÊS coisas batem:
//   1. a sessão de quem está voltando iniciou uma conexão desta rede há pouco
//      (`req.session.conexaoSocial`);
//   2. a conta, consultada na Outstand com a NOSSA chave, é desta rede;
//   3. o tenant da conta é o do usuário da sessão - o tenant vai aberto na URL
//      de autorização e pode ser editado, então ele confirma, mas não decide.
//
// No Facebook e no LinkedIn a volta não traz conta nenhuma, e sim um token de
// sessão: um login carrega várias Páginas (ou perfil + páginas de empresa) e o
// cliente ainda precisa escolher quais. O token fica guardado na sessão (nunca
// na URL, que vai pro histórico e pros logs), e a escolha acontece numa
// segunda etapa.
'use strict';

const outstandService = require('../../../services/outstandService');
const socialAccountsRepository = require('../../../repositories/socialAccountsRepository');
const socialPostingsRepository = require('../../../repositories/socialPostingsRepository');
const socialPostingSettingsRepository = require('../../../repositories/socialPostingSettingsRepository');
const redesSociais = require('../../../lib/redesSociais');
const { horariosPadrao } = require('../../../lib/postingSchedule');
const logger = require('../../../lib/logger');

const REDES = redesSociais.LISTA;
// A Outstand mantém a sessão de autorização por 30 minutos; damos 5 de folga
// pra quem demora convertendo a conta em profissional no meio do caminho.
const VALIDADE_MS = 35 * 60 * 1000;

function paraApi(row) {
  return {
    id: Number(row.id),
    network: row.network,
    username: row.username,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    accountType: row.account_type,
    connectedAt: row.connected_at,
  };
}

function origem(req) {
  return `${req.protocol}://${req.get('host')}`;
}

function erroDaOutstand(res, err, acao) {
  logger.error(`Outstand (${acao}): ${err.message}`);
  if (err instanceof outstandService.OutstandError && err.status === 503) {
    return res.status(503).json({ error: 'A conexão com as redes sociais ainda não está disponível.' });
  }
  return res.status(502).json({ error: 'O serviço de conexão não respondeu agora. Tente de novo em instantes.' });
}

// Lista com o resumo da fila de cada conta (pra tela mostrar "3 na fila ·
// próxima às 16:00" sem abrir conta por conta).
async function listaComResumo(clientUserId) {
  const [contas, contagens] = await Promise.all([
    socialAccountsRepository.listActive(clientUserId),
    socialPostingsRepository.contagensPorConta(clientUserId),
  ]);
  const out = [];
  for (const c of contas) {
    const s = await socialPostingSettingsRepository.findOrCreate(c.id);
    const n = contagens.get(Number(c.id));
    out.push({
      ...paraApi(c),
      fila: {
        naFila: n ? n.na_fila : 0,
        publicados: n ? n.publicados : 0,
        erros: n ? n.erros : 0,
        proxima: n ? n.proxima : null,
        publicaSozinho: s.auto_post_enabled,
        pausada: s.paused,
        porDia: s.videos_per_day,
        horarios: s.mode === 'manual' && s.manual_times.length ? s.manual_times : horariosPadrao(s.videos_per_day),
      },
    });
  }
  return out;
}

async function listar(req, res) {
  res.json({ disponivel: outstandService.configurado(), contas: await listaComResumo(req.session.user.id) });
}

async function iniciarConexao(req, res) {
  const { network } = req.params;
  if (!REDES.includes(network)) return res.status(400).json({ error: 'Rede inválida.' });
  logger.info(`Conexao ${network} iniciada pelo cliente #${req.session.user.id}`);
  try {
    const jaTem = (await socialAccountsRepository.listActive(req.session.user.id)).some((c) => c.network === network);
    const url = await outstandService.urlDeAutorizacao({
      network,
      userId: req.session.user.id,
      redirectUri: `${origem(req)}/client/social/retorno/${network}`,
      outraConta: jaTem,
    });
    req.session.conexaoSocial = { network, desde: Date.now() };
    res.json({ url });
  } catch (err) {
    erroDaOutstand(res, err, 'iniciar conexao');
  }
}

function telaDaRede(network, params) {
  const q = new URLSearchParams({ rede: network, ...params });
  return `/client/social?${q.toString()}`;
}

function pendenteValida(req, network) {
  const p = req.session.conexaoSocial;
  return Boolean(p && p.network === network && Date.now() - p.desde <= VALIDADE_MS);
}

async function vincularConta(req, network, accountId) {
  const conta = await outstandService.buscarConta(accountId);
  if (!conta || conta.network !== network) {
    logger.warn(`Conexao ${network}: conta ${accountId} nao encontrada na Outstand ou de outra rede (${conta && conta.network})`);
    return { erro: 'conta' };
  }
  if (conta.tenant_id !== outstandService.tenantDe(req.session.user.id)) {
    logger.warn(`Conexao ${network}: conta ${accountId} e do tenant ${conta.tenant_id}, nao do cliente #${req.session.user.id}`);
    return { erro: 'conta' };
  }
  const vinculada = await socialAccountsRepository.upsert({
    clientUserId: req.session.user.id,
    network,
    outstandAccountId: conta.id,
    networkUniqueId: conta.network_unique_id,
    username: conta.username,
    displayName: conta.nickname,
    avatarUrl: conta.profile_picture_url,
    accountType: conta.accountType,
  });
  return vinculada ? { ok: true } : { erro: 'outro_cliente' };
}

// GET /client/social/retorno/:network - a volta do navegador depois de autorizar.
async function retorno(req, res) {
  const { network } = req.params;
  if (!REDES.includes(network)) return res.redirect('/client/social');
  // Toda volta fica registrada (só os NOMES dos parâmetros e o erro, nunca o
  // token de sessão): a primeira tentativa real falhou sem deixar rastro
  // nenhum, e sem isto não há como saber em que ponto quebrou.
  logger.info(
    `Conexao ${network} voltou para o cliente #${req.session.user.id}: parametros=[${Object.keys(req.query).join(',')}] ` +
      `pendente=${pendenteValida(req, network)} erro="${String(req.query.error || '').slice(0, 300)}"`
  );
  if (!pendenteValida(req, network)) return res.redirect(telaDaRede(network, { erro: 'sessao' }));

  if (req.query.error || req.query.success === 'false') {
    delete req.session.conexaoSocial;
    // O motivo vem da Meta/Outstand e vai pra tela, que é o único jeito de o
    // cliente saber o que fazer (conta pessoal, sem Página...). Limpo de
    // qualquer coisa que não seja texto e cortado: é exibido, nunca executado.
    const motivo = String(req.query.error || req.query.error_description || '')
      .replace(/[^\p{L}\p{N}\s.,:;!?'"()/_-]/gu, '')
      .slice(0, 200);
    return res.redirect(telaDaRede(network, { erro: 'cancelada', ...(motivo ? { motivo } : {}) }));
  }

  try {
    if (req.query.session) {
      req.session.conexaoSocial = { network, desde: req.session.conexaoSocial.desde, sessionToken: String(req.query.session) };
      return res.redirect(telaDaRede(network, { escolher: '1' }));
    }
    if (!req.query.account_id) return res.redirect(telaDaRede(network, { erro: 'conta' }));
    const r = await vincularConta(req, network, String(req.query.account_id));
    delete req.session.conexaoSocial;
    return res.redirect(telaDaRede(network, r.ok ? { conectada: '1' } : { erro: r.erro }));
  } catch (err) {
    logger.error(`Outstand (retorno ${network}): ${err.message}`);
    delete req.session.conexaoSocial;
    return res.redirect(telaDaRede(network, { erro: 'servico' }));
  }
}

// A conexão pendente (Facebook/LinkedIn) da sessão, se ainda vale.
function pendente(req) {
  const p = req.session.conexaoSocial;
  return p && p.sessionToken && pendenteValida(req, p.network) ? p : null;
}

// GET /pendente - as Páginas/perfis que o login trouxe, pra escolher.
async function paginasPendentes(req, res) {
  const p = pendente(req);
  if (!p) return res.status(409).json({ error: 'A autorização expirou. Conecte a rede de novo.' });
  try {
    const dados = await outstandService.paginasPendentes(p.sessionToken);
    const paginas = (dados.availablePages || [])
      // No Facebook só Página publica por aplicativo; no LinkedIn vale perfil e
      // página de empresa.
      .filter((x) => p.network !== 'facebook' || !x.type || x.type === 'page')
      .map((x) => ({
        id: String(x.id),
        name: x.name,
        username: x.username || null,
        pictureUrl: x.profilePictureUrl || null,
        category: x.category || (x.type === 'profile' ? 'Perfil pessoal' : x.type === 'organization' ? 'Página de empresa' : null),
      }));
    res.json({ rede: p.network, paginas });
  } catch (err) {
    erroDaOutstand(res, err, `paginas pendentes ${p.network}`);
  }
}

// POST /pendente { pageIds }
async function conectarPaginas(req, res) {
  const p = pendente(req);
  if (!p) return res.status(409).json({ error: 'A autorização expirou. Conecte a rede de novo.' });
  const network = p.network;
  const ids = Array.isArray(req.body.pageIds) ? req.body.pageIds.map(String).filter(Boolean).slice(0, 20) : [];
  if (ids.length === 0) return res.status(400).json({ error: 'Escolha pelo menos uma opção.' });
  try {
    const contas = await outstandService.finalizarPendente(p.sessionToken, ids);
    delete req.session.conexaoSocial;
    let conectadas = 0;
    let deOutroCliente = 0;
    for (const conta of contas) {
      if (conta.network && conta.network !== network) continue;
      const vinculada = await socialAccountsRepository.upsert({
        clientUserId: req.session.user.id,
        network,
        outstandAccountId: conta.id,
        username: conta.username,
        displayName: conta.nickname,
        avatarUrl: conta.profile_picture_url || conta.profilePictureUrl || null,
        accountType: conta.accountType,
      });
      if (vinculada) conectadas += 1;
      else deOutroCliente += 1;
    }
    res.json({ conectadas, deOutroCliente, contas: await listaComResumo(req.session.user.id) });
  } catch (err) {
    erroDaOutstand(res, err, `finalizar ${network}`);
  }
}

async function desconectar(req, res) {
  const id = Number(req.params.id);
  const conta = Number.isFinite(id) ? await socialAccountsRepository.findOwned(id, req.session.user.id) : null;
  if (!conta) return res.status(404).json({ error: 'Conta não encontrada.' });
  try {
    await outstandService.removerConta(conta.outstand_account_id);
  } catch (err) {
    // Conta que já não existe na Outstand (removida por lá) desconecta aqui
    // mesmo assim - senão ficaria presa na tela pra sempre.
    if (!(err instanceof outstandService.OutstandError && err.status === 404)) {
      return erroDaOutstand(res, err, 'desconectar');
    }
  }
  await socialAccountsRepository.markDisconnected(id, req.session.user.id);
  res.json({ contas: await listaComResumo(req.session.user.id) });
}

module.exports = { listar, iniciarConexao, retorno, paginasPendentes, conectarPaginas, desconectar };
