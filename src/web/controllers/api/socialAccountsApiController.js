// Conexão das contas do Instagram e do Facebook (via Outstand).
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
// No Facebook a volta não traz conta nenhuma, e sim um token de sessão: um
// login carrega várias Páginas e o cliente ainda precisa escolher quais. O
// token fica guardado na sessão (nunca na URL, que vai pro histórico e pros
// logs), e a escolha acontece numa segunda etapa.
'use strict';

const outstandService = require('../../../services/outstandService');
const socialAccountsRepository = require('../../../repositories/socialAccountsRepository');
const logger = require('../../../lib/logger');

const REDES = ['instagram', 'facebook'];
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
    return res.status(503).json({ error: 'A conexão com Instagram e Facebook ainda não está disponível.' });
  }
  return res.status(502).json({ error: 'O serviço de conexão não respondeu agora. Tente de novo em instantes.' });
}

async function listar(req, res) {
  const contas = await socialAccountsRepository.listActive(req.session.user.id);
  res.json({ disponivel: outstandService.configurado(), contas: contas.map(paraApi) });
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

function tokenDoFacebook(req) {
  const p = req.session.conexaoSocial;
  return pendenteValida(req, 'facebook') && p.sessionToken ? p.sessionToken : null;
}

async function paginasDoFacebook(req, res) {
  const token = tokenDoFacebook(req);
  if (!token) return res.status(409).json({ error: 'A autorização expirou. Conecte o Facebook de novo.' });
  try {
    const dados = await outstandService.paginasPendentes(token);
    const paginas = (dados.availablePages || [])
      .filter((p) => !p.type || p.type === 'page')
      .map((p) => ({ id: String(p.id), name: p.name, username: p.username || null, pictureUrl: p.profilePictureUrl || null, category: p.category || null }));
    res.json({ paginas });
  } catch (err) {
    erroDaOutstand(res, err, 'paginas do facebook');
  }
}

async function conectarPaginas(req, res) {
  const token = tokenDoFacebook(req);
  if (!token) return res.status(409).json({ error: 'A autorização expirou. Conecte o Facebook de novo.' });
  const ids = Array.isArray(req.body.pageIds) ? req.body.pageIds.map(String).filter(Boolean).slice(0, 20) : [];
  if (ids.length === 0) return res.status(400).json({ error: 'Escolha pelo menos uma Página.' });
  try {
    const contas = await outstandService.finalizarPendente(token, ids);
    delete req.session.conexaoSocial;
    let conectadas = 0;
    let deOutroCliente = 0;
    for (const conta of contas) {
      if (conta.network && conta.network !== 'facebook') continue;
      const vinculada = await socialAccountsRepository.upsert({
        clientUserId: req.session.user.id,
        network: 'facebook',
        outstandAccountId: conta.id,
        username: conta.username,
        displayName: conta.nickname,
        accountType: conta.accountType,
      });
      if (vinculada) conectadas += 1;
      else deOutroCliente += 1;
    }
    const lista = await socialAccountsRepository.listActive(req.session.user.id);
    res.json({ conectadas, deOutroCliente, contas: lista.map(paraApi) });
  } catch (err) {
    erroDaOutstand(res, err, 'finalizar facebook');
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
  const lista = await socialAccountsRepository.listActive(req.session.user.id);
  res.json({ contas: lista.map(paraApi) });
}

module.exports = { listar, iniciarConexao, retorno, paginasDoFacebook, conectarPaginas, desconectar };
