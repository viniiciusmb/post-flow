// Entrar com Google.
//
// É um caminho de LOGIN, separado do "conectar o Google Drive" (googleController).
// São dois consentimentos diferentes: aqui só pedimos identidade (nome, e-mail),
// nenhum acesso a arquivo. Quem quiser exportar cortes pro Drive autoriza isso
// depois, numa tela própria.
//
// Regra que sustenta o resto: só ligamos uma conta Google a uma conta do Post
// Flow quando o Google confirma que aquele e-mail é verificado. Sem essa
// checagem, alguém com um endereço não confirmado poderia entrar na conta de
// outra pessoa que já usa aquele e-mail aqui.
'use strict';

const crypto = require('crypto');
const googleService = require('../../services/googleService');
const usersRepository = require('../../repositories/usersRepository');
const publicController = require('./publicController');
const affiliateService = require('../../services/affiliateService');
const logger = require('../../lib/logger');
const subscriptionCheckoutService = require('../../services/subscriptionCheckoutService');

function paraLogin(res, mensagem) {
  return res.redirect(`/login?erro=${encodeURIComponent(mensagem)}`);
}

function start(req, res) {
  const state = crypto.randomBytes(16).toString('hex');
  req.session.googleLoginState = state;
  res.redirect(googleService.buildLoginUrl(state));
}

async function callback(req, res) {
  const { code, state, error, error_description: errorDescription } = req.query;

  if (error) {
    return paraLogin(res, errorDescription || 'Você cancelou a entrada com o Google.');
  }
  // O state amarra este retorno ao pedido que saiu deste navegador. Sem ele,
  // um site de terceiro poderia forçar o retorno de OUTRA conta Google e
  // deixar a pessoa logada numa conta que não é dela.
  if (!state || state !== req.session.googleLoginState) {
    return paraLogin(res, 'A sessão expirou. Tente entrar de novo.');
  }
  delete req.session.googleLoginState;

  let perfil;
  try {
    const tokens = await googleService.exchangeLoginCode(code);
    perfil = await googleService.getLoginProfile(tokens.access_token);
  } catch (err) {
    logger.error('Falha no login com Google:', err.message);
    return paraLogin(res, 'Não consegui falar com o Google agora. Tente de novo.');
  }

  if (!perfil.email || !perfil.emailVerified) {
    return paraLogin(res, 'Essa conta Google não tem e-mail confirmado, então não dá pra entrar com ela.');
  }

  const email = perfil.email.toLowerCase();

  // 1. Já entrou com Google antes: identifica pelo `sub`, que nunca muda -
  //    inclusive se a pessoa tiver trocado o e-mail da conta Google desde então.
  let user = await usersRepository.findByGoogleSub(perfil.sub);

  // 2. Primeira vez com Google, mas o e-mail já tem conta aqui: liga as duas.
  //    Isso é seguro porque o Google confirmou o e-mail acima.
  if (!user) {
    const porEmail = await usersRepository.findByEmail(email);
    if (porEmail) {
      user = await usersRepository.linkGoogleAccount(porEmail.id, { sub: perfil.sub, email });
    }
  }

  // 3. Ninguém: cria uma conta de cliente. O aviso dos Termos e da Política
  //    fica ao lado do botão na tela de login, então o clique é o aceite - e
  //    fica gravado qual versão do documento estava valendo.
  if (!user) {
    user = await usersRepository.createFromGoogle({
      email,
      businessName: perfil.name,
      googleSub: perfil.sub,
      termsVersion: publicController.LEGAL_UPDATED_AT,
    });
    logger.info(`Conta criada por login com Google: ${email}`);

    // Precisa acontecer AQUI, antes do regenerate() logo abaixo - regenerate
    // troca o id da sessao e descarta o que estava nela, inclusive a
    // atribuicao de afiliado/UTM capturada por affiliateAttribution.js numa
    // visita anterior (o cookie sameSite=lax sobrevive ao roundtrip do OAuth,
    // entao a sessao antiga ainda esta aqui nesse ponto).
    const attribution = req.session.affiliateAttribution;
    if (attribution) {
      await affiliateService.captureAttribution({
        referredUserId: user.id,
        refCode: attribution.refCode,
        utm: attribution.utm,
        landingPath: attribution.landingPath,
      });
    }
  }

  if (!user.is_active) {
    return paraLogin(res, 'Esta conta está desativada. Fale com o suporte.');
  }

  // Lido ANTES do regenerate: ele descarta a sessao inteira, entao o plano
  // escolhido na landing sumiria junto (mesmo cuidado que a atribuicao de
  // afiliado acima ja tomava).
  const planKey = req.session.planoEscolhido || null;
  const origin = `${req.protocol}://${req.get('host')}`;

  // Sessão nova a cada login, com o id antigo descartado: sem isso, um id de
  // sessão obtido antes do login continuaria valendo depois dele.
  req.session.regenerate(async (err) => {
    if (err) {
      logger.error('Falha ao renovar a sessao no login com Google:', err.message);
      return paraLogin(res, 'Não consegui abrir sua sessão. Tente de novo.');
    }
    req.session.user = { id: user.id, role: user.role, email: user.email };
    res.redirect(await subscriptionCheckoutService.destinoDepoisDeEntrar({ user, planKey, origin }));
  });
}

module.exports = { start, callback };
