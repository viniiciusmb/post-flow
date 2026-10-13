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
const errorReportService = require('../../../services/errorReportService');
const saudeDasContasSociaisService = require('../../../services/saudeDasContasSociaisService');
const planLimitsService = require('../../../services/planLimitsService');
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
    conferidaEm: row.conferida_em || null,
    precisaReconectar: Boolean(row.precisa_reconectar_em),
    motivoReconectar: row.motivo_reconectar || null,
    // Passou do limite do plano (trocou pra um menor, cancelou): a fila desta
    // conta fica parada. Ver socialAccountsRepository.dentroDoPlanoSql.
    foraDoPlano: row.dentro_do_plano === false,
  };
}

function ehAdmin(req) {
  return Boolean(req.session.user && req.session.user.role === 'admin');
}

function nomeDaRede(network) {
  return (redesSociais.info(network) || {}).nome || network;
}

// O que a volta trouxe na URL, sem nada que seja credencial (token de sessão,
// code). Vai pro registro do erro: é o que diz em que ponto a conexão quebrou.
function parametrosDaVolta(query) {
  const seguros = {};
  for (const [k, v] of Object.entries(query || {})) {
    seguros[k] = /session|token|code|state/i.test(k) ? '[omitido]' : String(v).slice(0, 500);
  }
  return seguros;
}

// Registra uma falha de conexão com tudo que se sabe dela. Nunca lança.
function registrarFalhaDeConexao(req, { network, etapa, mensagem, err = null, extra = {} }) {
  const clientUserId = req.session && req.session.user ? req.session.user.id : null;
  logger.warn(`Conexao ${network || '?'} do cliente #${clientUserId} falhou (${etapa}): ${mensagem}`);
  errorReportService.report({
    operation: errorReportService.OPERACOES.SOCIAL_CONEXAO,
    entityType: 'social_conexao',
    clientUserId,
    error: err || new Error(mensagem),
    message: `${nomeDaRede(network)} - ${mensagem}`,
    contexto: {
      rede: network,
      etapa,
      clienteId: clientUserId,
      conexaoIniciadaHaSegundos: req.session && req.session.conexaoSocial ? Math.round((Date.now() - req.session.conexaoSocial.desde) / 1000) : null,
      navegador: req.get ? req.get('user-agent') : null,
      ...extra,
    },
  });
}

// Quem passou do limite também fica registrado (grupo "Erros em teste"): não é
// defeito, mas é o sinal de quem quer um plano maior.
function registrarLimite(req, network, motivo, extra = {}) {
  errorReportService.report({
    operation: errorReportService.OPERACOES.LIMITE_DO_PLANO,
    entityType: 'social_conexao',
    clientUserId: req.session.user.id,
    error: new Error(motivo),
    message: `Tentou conectar mais uma conta do ${nomeDaRede(network)} além do plano`,
    contexto: { rede: network, ...extra },
  });
}

function origem(req) {
  return `${req.protocol}://${req.get('host')}`;
}

function erroDaOutstand(res, err, acao, req = null, network = null) {
  logger.error(`Outstand (${acao}): ${err.message}`);
  // Conexão de rede social: toda falha vai pro painel de erros com o contexto
  // inteiro (inclusive a resposta crua da Outstand, que vem no próprio erro).
  if (req) registrarFalhaDeConexao(req, { network, etapa: acao, mensagem: err.message, err });
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

// Limite do plano pra tela: "1 de 1 conta do Instagram", e o botão de
// conectar desabilitado quando a rede já está cheia. É o MESMO número que o
// servidor usa pra barrar (planLimitsService), nunca um calculado na tela.
async function limitesParaApi(req) {
  const l = await planLimitsService.limitesDasNovidadesDoCliente(req.session.user.id, { admin: ehAdmin(req) });
  // `porRede`: o limite EFETIVO de cada rede (plano + extras comprados).
  const porRede = {};
  for (const rede of REDES) porRede[rede] = planLimitsService.limiteNaRede(l, rede);
  return { semPlano: l.semPlano, contasPorRede: l.contasPorRede, porRede, extras: l.extrasPorRede, plano: l.plano };
}

async function listar(req, res) {
  const [contas, limites] = await Promise.all([listaComResumo(req.session.user.id), limitesParaApi(req)]);
  res.json({ disponivel: outstandService.configurado(), contas, limites });
}

async function iniciarConexao(req, res) {
  const { network } = req.params;
  if (!REDES.includes(network)) return res.status(400).json({ error: 'Rede inválida.' });
  logger.info(`Conexao ${network} iniciada pelo cliente #${req.session.user.id}`);
  try {
    const naRede = await socialAccountsRepository.contarNaRede(req.session.user.id, network);
    // Reconectar uma conta que JÁ é do cliente (o login dela venceu) não é
    // conta nova: não passa pelo limite. Guardado na sessão pra volta saber
    // que a conta que chegar substitui esta.
    const idReconectar = Number(req.body && req.body.reconectar);
    const reconectando = Number.isFinite(idReconectar) && idReconectar > 0
      ? await socialAccountsRepository.findOwned(idReconectar, req.session.user.id)
      : null;
    const ehReconexao = Boolean(reconectando && reconectando.network === network);
    const limite = ehReconexao
      ? { allowed: true }
      : await planLimitsService.checkSocialAccountLimit(req.session.user.id, network, naRede, { admin: ehAdmin(req) });
    if (!limite.allowed) {
      registrarLimite(req, network, limite.reason, { contasNaRede: naRede, limite: limite.limite, etapa: 'iniciar' });
      return res.status(403).json({ error: limite.reason, limite: true });
    }
    const jaTem = naRede > 0;
    const url = await outstandService.urlDeAutorizacao({
      network,
      userId: req.session.user.id,
      redirectUri: `${origem(req)}/client/social/retorno/${network}`,
      // Na reconexão, a mesma conta: não força escolher outra.
      outraConta: jaTem && !ehReconexao,
    });
    req.session.conexaoSocial = { network, desde: Date.now(), ...(ehReconexao ? { reconectar: Number(reconectando.id) } : {}) };
    res.json({ url });
  } catch (err) {
    erroDaOutstand(res, err, 'iniciar conexao', req, network);
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

// Conta nova passa pelo limite do plano; reconectar a mesma conta, não (ela já
// está contada). Conferido aqui de novo, e não só ao iniciar: dá pra abrir duas
// conexões ao mesmo tempo em duas abas.
async function cabeNoPlano(req, network, outstandAccountId, extra = {}) {
  if (await socialAccountsRepository.jaConectadaPor(req.session.user.id, outstandAccountId)) return { ok: true };
  // Reconexão que voltou com OUTRO id na Outstand: entra no lugar da antiga
  // (que é desconectada em seguida), então o total não muda.
  const p = req.session.conexaoSocial;
  if (p && p.reconectar && p.network === network) return { ok: true, substitui: p.reconectar };
  const naRede = await socialAccountsRepository.contarNaRede(req.session.user.id, network);
  const limite = await planLimitsService.checkSocialAccountLimit(req.session.user.id, network, naRede, {
    admin: ehAdmin(req),
  });
  if (limite.allowed) return { ok: true };
  registrarLimite(req, network, limite.reason, { contasNaRede: naRede, limite: limite.limite, etapa: 'vincular', ...extra });
  return { ok: false, motivo: limite.reason };
}

async function vincularConta(req, network, accountId) {
  const conta = await outstandService.buscarConta(accountId);
  if (!conta || conta.network !== network) {
    registrarFalhaDeConexao(req, {
      network,
      etapa: 'conferir_conta',
      mensagem: conta ? `a conta voltou como sendo de outra rede (${conta.network})` : 'a conta conectada não foi encontrada na Outstand',
      extra: { contaOutstand: accountId, redeDaConta: conta ? conta.network : null },
    });
    return { erro: 'conta' };
  }
  if (conta.tenant_id !== outstandService.tenantDe(req.session.user.id)) {
    registrarFalhaDeConexao(req, {
      network,
      etapa: 'conferir_dono',
      mensagem: 'a conta conectada não pertence a este cliente (tenant diferente)',
      extra: { contaOutstand: accountId, tenantDaConta: conta.tenant_id, tenantEsperado: outstandService.tenantDe(req.session.user.id) },
    });
    return { erro: 'conta' };
  }
  const cabe = await cabeNoPlano(req, network, conta.id, { contaOutstand: conta.id, usuario: conta.username });
  if (!cabe.ok) {
    // Fica na Outstand sem ninguém usar; removida pra não pesar na conta de lá.
    await outstandService.removerConta(conta.id).catch(() => {});
    return { erro: 'limite' };
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
  if (!vinculada) {
    registrarFalhaDeConexao(req, {
      network,
      etapa: 'vincular',
      mensagem: 'esta conta já está conectada por outro cliente do Post Flow',
      extra: { contaOutstand: conta.id, usuario: conta.username },
    });
    return { erro: 'outro_cliente' };
  }
  if (cabe.substitui && Number(cabe.substitui) !== Number(vinculada.id)) {
    await socialAccountsRepository.markDisconnected(cabe.substitui, req.session.user.id);
  }
  return { ok: true };
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
  if (!pendenteValida(req, network)) {
    const p = req.session.conexaoSocial;
    registrarFalhaDeConexao(req, {
      network,
      etapa: 'voltar',
      mensagem: !p
        ? 'voltou da autorização sem uma conexão iniciada nesta sessão (sessão perdida ou link aberto em outro navegador)'
        : p.network !== network
          ? `voltou da autorização do ${nomeDaRede(network)}, mas a conexão iniciada era do ${nomeDaRede(p.network)}`
          : 'voltou da autorização depois de 35 minutos (prazo vencido)',
      extra: { parametros: parametrosDaVolta(req.query) },
    });
    return res.redirect(telaDaRede(network, { erro: 'sessao' }));
  }

  if (req.query.error || req.query.success === 'false') {
    registrarFalhaDeConexao(req, {
      network,
      etapa: 'autorizar',
      mensagem: `a rede ou a Outstand devolveu erro: ${String(req.query.error || req.query.error_description || 'success=false').slice(0, 300)}`,
      extra: { parametros: parametrosDaVolta(req.query) },
    });
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
    if (!req.query.account_id) {
      registrarFalhaDeConexao(req, {
        network,
        etapa: 'voltar',
        mensagem: 'a volta não trouxe a conta conectada (sem account_id nem session)',
        extra: { parametros: parametrosDaVolta(req.query) },
      });
      delete req.session.conexaoSocial;
      return res.redirect(telaDaRede(network, { erro: 'conta' }));
    }
    const r = await vincularConta(req, network, String(req.query.account_id));
    delete req.session.conexaoSocial;
    return res.redirect(telaDaRede(network, r.ok ? { conectada: '1' } : { erro: r.erro }));
  } catch (err) {
    registrarFalhaDeConexao(req, {
      network,
      etapa: 'vincular',
      mensagem: err.message,
      err,
      extra: { parametros: parametrosDaVolta(req.query) },
    });
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
  if (!p) {
    registrarFalhaDeConexao(req, { network: req.session.conexaoSocial && req.session.conexaoSocial.network, etapa: 'listar_paginas', mensagem: 'a autorização expirou antes de escolher as páginas' });
    return res.status(409).json({ error: 'A autorização expirou. Conecte a rede de novo.' });
  }
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
    if (paginas.length === 0) {
      registrarFalhaDeConexao(req, {
        network: p.network,
        etapa: 'listar_paginas',
        mensagem:
          p.network === 'facebook'
            ? 'o login não trouxe nenhuma Página do Facebook (o cliente pode não administrar nenhuma Página)'
            : 'o login não trouxe nenhuma conta pra escolher',
        extra: { totalRecebido: (dados.availablePages || []).length, tipos: (dados.availablePages || []).map((x) => x.type || null) },
      });
    }
    res.json({ rede: p.network, paginas });
  } catch (err) {
    erroDaOutstand(res, err, 'listar paginas', req, p.network);
  }
}

// POST /pendente { pageIds }
async function conectarPaginas(req, res) {
  const p = pendente(req);
  if (!p) {
    registrarFalhaDeConexao(req, { network: req.session.conexaoSocial && req.session.conexaoSocial.network, etapa: 'finalizar', mensagem: 'a autorização expirou antes de confirmar as páginas escolhidas' });
    return res.status(409).json({ error: 'A autorização expirou. Conecte a rede de novo.' });
  }
  const network = p.network;
  const ids = Array.isArray(req.body.pageIds) ? req.body.pageIds.map(String).filter(Boolean).slice(0, 20) : [];
  if (ids.length === 0) return res.status(400).json({ error: 'Escolha pelo menos uma opção.' });
  // Escolher mais páginas do que o plano comporta: recusado ANTES de pedir à
  // Outstand, senão as contas seriam criadas lá e ficariam sem dono aqui.
  const naRede = await socialAccountsRepository.contarNaRede(req.session.user.id, network);
  const limite = await planLimitsService.checkSocialAccountLimit(req.session.user.id, network, naRede + ids.length - 1, {
    admin: ehAdmin(req),
  });
  if (!limite.allowed) {
    const sobra = Math.max(0, (limite.limite || 0) - naRede);
    const motivo =
      sobra > 0
        ? `Seu plano permite ${limite.limite} ${limite.limite === 1 ? 'conta' : 'contas'} em cada rede social. Escolha no máximo ${sobra} ${sobra === 1 ? 'página' : 'páginas'}, ou troque de plano em "Plano e uso".`
        : limite.reason;
    registrarLimite(req, network, motivo, { contasNaRede: naRede, escolhidas: ids.length, limite: limite.limite, etapa: 'finalizar' });
    return res.status(403).json({ error: motivo, limite: true });
  }
  try {
    const contas = await outstandService.finalizarPendente(p.sessionToken, ids);
    delete req.session.conexaoSocial;
    if (contas.length === 0) {
      registrarFalhaDeConexao(req, {
        network,
        etapa: 'finalizar',
        mensagem: 'a Outstand confirmou a escolha mas não devolveu nenhuma conta conectada',
        extra: { escolhidas: ids.length },
      });
    }
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
      else {
        deOutroCliente += 1;
        registrarFalhaDeConexao(req, {
          network,
          etapa: 'vincular',
          mensagem: 'esta página já está conectada por outro cliente do Post Flow',
          extra: { contaOutstand: conta.id, usuario: conta.username || conta.nickname || null },
        });
      }
    }
    res.json({ conectadas, deOutroCliente, contas: await listaComResumo(req.session.user.id) });
  } catch (err) {
    erroDaOutstand(res, err, 'finalizar', req, network);
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
      return erroDaOutstand(res, err, 'desconectar', req, conta.network);
    }
  }
  await socialAccountsRepository.markDisconnected(id, req.session.user.id);
  res.json({ contas: await listaComResumo(req.session.user.id) });
}

// POST /:id/testar - "Testar conexão": usa o login da conta agora mesmo.
async function testar(req, res) {
  const id = Number(req.params.id);
  const conta = Number.isFinite(id) ? await socialAccountsRepository.findOwned(id, req.session.user.id) : null;
  if (!conta) return res.status(404).json({ error: 'Conta não encontrada.' });
  if (!outstandService.configurado()) return res.status(503).json({ error: 'A conexão com as redes sociais ainda não está disponível.' });
  const resultado = await saudeDasContasSociaisService.conferir(conta);
  const atual = await socialAccountsRepository.findOwned(id, req.session.user.id);
  res.json({ resultado, conta: paraApi(atual) });
}

module.exports = { listar, iniciarConexao, retorno, paginasPendentes, conectarPaginas, desconectar, testar };
