'use strict';

const crypto = require('crypto');
const tiktokService = require('../../services/tiktokService');
const tiktokAccountsRepository = require('../../repositories/tiktokAccountsRepository');
const backfillPostingsService = require('../../services/backfillPostingsService');
const planLimitsService = require('../../services/planLimitsService');
const errorReportService = require('../../services/errorReportService');
const logger = require('../../lib/logger');

// Toda falha ao conectar o TikTok vai pro painel de erros com o que se sabe
// dela (etapa, o que a TikTok devolveu na URL, navegador). Antes nenhuma era
// registrada: o cliente via a mensagem na tela e ninguém mais ficava sabendo.
function registrarFalha(req, etapa, mensagem, err = null, extra = {}) {
  const clientUserId = req.session && req.session.user ? req.session.user.id : null;
  logger.warn(`Conexao do TikTok do cliente #${clientUserId} falhou (${etapa}): ${mensagem}`);
  errorReportService.report({
    operation: errorReportService.OPERACOES.TIKTOK_CONEXAO,
    entityType: 'tiktok_conexao',
    clientUserId,
    error: err || new Error(mensagem),
    message: `TikTok - ${mensagem}`.slice(0, 300),
    contexto: {
      etapa,
      clienteId: clientUserId,
      parametrosDaVolta: Object.keys(req.query || {}),
      erroDaTiktok: req.query && req.query.error ? String(req.query.error) : null,
      descricaoDaTiktok: req.query && req.query.error_description ? String(req.query.error_description).slice(0, 500) : null,
      navegador: req.get('user-agent'),
      ...extra,
    },
  });
}

// Pra onde voltar depois de conectar. Antes caia sempre no Inicio, mesmo tendo
// saido da tela de Publicacao - a pessoa perdia o lugar e tinha que navegar de
// volta pra ver a conta que acabou de conectar.
//
// Lista fechada de destinos, e NUNCA o valor cru: o endereco vem da URL, e
// redirecionar pra qualquer coisa que chegue ali seria um redirecionamento
// aberto (um link que parece nosso levando pra fora do site).
const RETORNOS_PERMITIDOS = new Set(['/client', '/client/tiktok-account', '/client/youtube-channels', '/client/social', '/client/youtube']);

function destinoDeRetorno(valor) {
  return RETORNOS_PERMITIDOS.has(valor) ? valor : '/client';
}

async function connect(req, res) {
  const voltarPara = destinoDeRetorno(req.query.from);

  // Sem plano, a conexão seria recusada na volta (ver concluirConexao) - mas
  // só depois de a pessoa passar pela tela inteira de autorização do TikTok.
  // Entre 14 e 15/10/2026, 31 pessoas fizeram esse caminho à toa (49 vezes).
  // Quem já tem conta conectada pode estar só reconectando, e isso continua
  // liberado: não dá pra saber qual conta é antes da volta.
  const limite = await planLimitsService.checkTiktokAccountLimit(req.session.user.id, 0);
  if (!limite.allowed) {
    const conectadas = await tiktokAccountsRepository.listActiveByClientId(req.session.user.id);
    if (conectadas.length === 0) {
      errorReportService.report({
        operation: errorReportService.OPERACOES.LIMITE_DO_PLANO,
        entityType: 'tiktok_conexao',
        clientUserId: req.session.user.id,
        error: new Error(limite.reason),
        message: 'Tentou conectar uma conta do TikTok sem plano ativo',
        contexto: { etapa: 'antes_de_ir_pro_tiktok' },
      });
      return res.redirect(`${voltarPara}?tiktok_error=${encodeURIComponent(limite.reason)}`);
    }
  }

  const state = crypto.randomBytes(16).toString('hex');
  req.session.tiktokOAuthState = state;
  // Guardado na sessao, nao carregado pela TikTok: o que volta do OAuth e so o
  // `state`, entao a origem tem que estar do nosso lado.
  req.session.tiktokRetorno = voltarPara;
  res.redirect(tiktokService.buildAuthorizeUrl(state));
}

async function callback(req, res) {
  const { code, state, error, error_description: errorDescription } = req.query;

  const voltarPara = destinoDeRetorno(req.session.tiktokRetorno);

  if (error) {
    registrarFalha(req, 'autorizar', `a TikTok devolveu erro na autorização: ${errorDescription || error}`);
    return res.redirect(`${voltarPara}?tiktok_error=${encodeURIComponent(errorDescription || error)}`);
  }

  if (!state || state !== req.session.tiktokOAuthState) {
    registrarFalha(
      req,
      'voltar',
      !req.session.tiktokOAuthState
        ? 'voltou da autorização sem conexão iniciada nesta sessão (sessão perdida ou outro navegador)'
        : 'o state da volta não confere com o da sessão'
    );
    return res.redirect(`${voltarPara}?tiktok_error=Sessao+expirada,+tente+conectar+novamente`);
  }
  delete req.session.tiktokOAuthState;
  delete req.session.tiktokRetorno;

  let etapa = 'trocar_codigo';
  try {
    return await concluirConexao(req, res, code, voltarPara, (e) => {
      etapa = e;
    });
  } catch (err) {
    registrarFalha(req, etapa, err.message, err);
    return res.redirect(`${voltarPara}?tiktok_error=${encodeURIComponent('Não foi possível concluir a conexão com o TikTok. Tente de novo.')}`);
  }
}

async function concluirConexao(req, res, code, voltarPara, marcarEtapa) {
  const tokens = await tiktokService.exchangeCodeForToken(code);

  // Reconectar a MESMA conta (mesmo open_id) nunca deve esbarrar no limite
  // do plano - so conta contra o limite quando e uma conta NOVA de verdade.
  const existingAccounts = await tiktokAccountsRepository.listActiveByClientId(req.session.user.id);
  const isReconnect = existingAccounts.some((a) => a.tiktok_open_id === tokens.open_id);
  if (!isReconnect) {
    const limitCheck = await planLimitsService.checkTiktokAccountLimit(req.session.user.id, existingAccounts.length);
    if (!limitCheck.allowed) {
      errorReportService.report({
        operation: errorReportService.OPERACOES.LIMITE_DO_PLANO,
        entityType: 'tiktok_conexao',
        clientUserId: req.session.user.id,
        error: new Error(limitCheck.reason),
        message: 'Tentou conectar mais uma conta do TikTok além do plano',
        contexto: { contasConectadas: existingAccounts.length },
      });
      return res.redirect(`${voltarPara}?tiktok_error=${encodeURIComponent(limitCheck.reason)}`);
    }
  }

  marcarEtapa('ler_perfil');
  const userInfo = await tiktokService.getUserInfo(tokens.access_token);
  marcarEtapa('gravar_conta');

  const conta = await tiktokAccountsRepository.upsertForClient({
    clientUserId: req.session.user.id,
    tiktokOpenId: tokens.open_id,
    tiktokUnionId: userInfo.union_id || null,
    displayName: userInfo.display_name || null,
    avatarUrl: userInfo.avatar_url || null,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresIn: tokens.expires_in,
    scopes: (tokens.scope || '').split(',').filter(Boolean),
  });

  // Cortes que ficaram prontos antes desta conta existir nao tinham pra onde
  // ir, e conectar depois nao voltava atras pra busca-los - a fila abria vazia
  // sem explicacao. Ver backfillPostingsService.
  marcarEtapa('enfileirar_cortes_prontos');
  await backfillPostingsService.enfileirarCortesProntos({
    clientUserId: req.session.user.id,
    tiktokAccountId: conta.id,
  });

  return res.redirect(`${voltarPara}?tiktok_connected=1`);
}

module.exports = { connect, callback };
