// Checkout transparente — a tela de pagamento do Post Flow.
//
// Três compras passam por aqui e todas terminam do mesmo jeito: mensalidade,
// crédito avulso e conexões extras. A regra do arquivo é que o VALOR NUNCA VEM
// DA TELA — o cliente manda o que quer comprar, e o preço é recalculado aqui a
// partir do banco. Se o valor viesse no corpo da requisição, dava para assinar
// o plano maior por um centavo.
//
// Cartão: o número passa por esta requisição uma única vez, vai direto para a
// tokenização e não é gravado nem registrado em log em lugar nenhum.
'use strict';

const precosDasConexoes = require('../../../lib/precoDasConexoesExtras');
const logger = require('../../../lib/logger');
const checkoutService = require('../../../services/checkoutService');
const asaasService = require('../../../services/asaasService');
const subscriptionPlansRepository = require('../../../repositories/subscriptionPlansRepository');
const clientSubscriptionsRepository = require('../../../repositories/clientSubscriptionsRepository');
const usersRepository = require('../../../repositories/usersRepository');
const youtubeChannelsRepository = require('../../../repositories/youtubeChannelsRepository');
const tiktokAccountsRepository = require('../../../repositories/tiktokAccountsRepository');
const { promocaoDisponivel } = require('../../../lib/promocaoDePrimeiroMes');
const planLimitsService = require('../../../services/planLimitsService');
const creditsService = require('../../../services/creditsService');
const cpfCnpj = require('../../../lib/cpfCnpj');
const { COMPANY } = require('../../../config/constants');
const { CREDITO } = require('./clientBillingApiController');

const { DadosInvalidosError } = checkoutService;
const { AsaasError } = asaasService;

// Quantas conexões extras dá para comprar de uma vez. Teto baixo de propósito:
// o campo é numérico e um erro de digitação (10 virar 100) seria uma cobrança
// de milhares de reais feita sem querer.
const MAX_SLOTS_POR_COMPRA = 10;

// Traduz a exceção na resposta HTTP certa. Sem isto, erro de preenchimento e
// "Asaas fora do ar" caíam os dois no 500 genérico — e "Algo deu errado" é o
// pior texto possível numa tela de pagamento.
function responderErro(res, err) {
  if (err instanceof DadosInvalidosError) return res.status(400).json({ error: err.message });
  if (err instanceof AsaasError) {
    return res.status(err.isCulpaDoCliente ? 400 : 502).json({ error: err.message, codigo: err.code });
  }
  throw err;
}

// Tudo que a tela de checkout precisa para se montar sozinha: os planos com os
// dois degraus de preço, o cartão já salvo (se houver), o que o cliente já usa
// hoje e os dados dele para preencher o formulário. Uma requisição só — a tela
// de pagamento é o pior lugar do sistema para uma cascata de carregamentos.
async function contexto(req, res) {
  const clientUserId = req.session.user.id;
  const [plans, subscription, user, canais, contas] = await Promise.all([
    subscriptionPlansRepository.listActive(),
    clientSubscriptionsRepository.getOrCreate(clientUserId),
    usersRepository.findById(clientUserId),
    youtubeChannelsRepository.countByClientId(clientUserId),
    tiktokAccountsRepository.listActiveByClientId(clientUserId),
  ]);

  const limites = planLimitsService.limitesDe(subscription);
  const contasAtivas = contas.length;
  const taxas = creditsService.taxasDoPlano(subscription);

  res.json({
    asaasDisponivel: asaasService.isConfigured(),
    plans: plans.map((p) => ({
      key: p.key,
      name: p.name,
      priceCents: p.price_cents,
      firstMonthPriceCents: p.first_month_price_cents,
      weeklyMinutesNormal: p.weekly_minutes_normal,
      weeklyMinutesBonus: p.weekly_minutes_bonus,
      maxYoutubeChannels: p.max_youtube_channels,
      maxTiktokAccounts: p.max_tiktok_accounts,
      overageCentsNormal: p.overage_cents_normal,
      overageCentsBonus: p.overage_cents_bonus,
      extraChannelPriceCents: p.extra_channel_price_cents,
      extraTiktokPriceCents: p.extra_tiktok_price_cents,
      extraBothPriceCents: p.extra_both_price_cents,
    })),
    subscription: {
      planKey: subscription.plan_key || null,
      planName: subscription.plan_name || null,
      status: subscription.status,
      // Tem direito à promoção de estreia? A tela precisa saber para não
      // anunciar um desconto que não vai acontecer. Mesma função que
      // checkoutService usa para CALCULAR o valor cobrado — se as duas
      // pudessem discordar, a tela mostraria um preço e o cartão veria outro.
      promoDisponivel: promocaoDisponivel(subscription),
      extraChannels: Number(subscription.extra_channels) || 0,
      extraTiktokAccounts: Number(subscription.extra_tiktok_accounts) || 0,
      precosExtras: precosDasConexoes.precosDoPlano(subscription),
      limites: { canais: limites.canais, contas: limites.contas },
      emUso: { canais, contas: contasAtivas },
      overageCardEnabled: subscription.overage_card_enabled,
    },
    card: subscription.asaas_card_token
      ? {
          brand: subscription.asaas_card_brand,
          last4: subscription.asaas_card_last4,
          exp: subscription.asaas_card_exp,
        }
      : null,
    // Só o que ajuda a preencher o formulário. O documento volta formatado
    // porque é assim que a pessoa reconhece o próprio CPF.
    perfil: {
      nome: user.business_name || '',
      email: user.email,
      cpfCnpj: user.cpf_cnpj ? cpfCnpj.formatar(user.cpf_cnpj) : '',
    },
    package: {
      minMinutes: CREDITO.MIN_MINUTOS,
      stepMinutes: CREDITO.PASSO_MINUTOS,
      maxMinutes: CREDITO.MAX_MINUTOS,
      centsPerMinute: taxas.normal,
    },
    overage: { rateCentsNormal: taxas.normal, rateCentsBonus: taxas.bonus },
    // Quem esta prestes a digitar um cartao procura saber de quem e a empresa.
    // Vem do servidor (fonte unica em config/constants) em vez de escrito na
    // tela, senao um dia o CNPJ do rodape e o do checkout divergem.
    empresa: { nome: COMPANY.legalName, cnpj: COMPANY.cnpj },
    maxSlotsPorCompra: MAX_SLOTS_POR_COMPRA,
  });
}

// Cadastra (ou troca) o cartão salvo. Fica separado do pagamento porque tem
// vida própria: é ele que liga a cobrança automática de excedente, e o cliente
// pode querer só isso, sem comprar nada agora.
async function salvarCartao(req, res) {
  try {
    const salvo = await checkoutService.salvarCartao({
      clientUserId: req.session.user.id,
      dadosDoTitular: req.body.titular || {},
      cartao: req.body.cartao || {},
      remoteIp: req.ip,
      email: req.session.user.email,
    });
    res.json({ card: { brand: salvo.brand, last4: salvo.last4 } });
  } catch (err) {
    return responderErro(res, err);
  }
}

async function removerCartao(req, res) {
  await clientSubscriptionsRepository.clearAsaasCard(req.session.user.id);
  res.json({ card: null });
}

// O item que está sendo comprado, resolvido a partir do que a tela pediu — e
// com o preço vindo SEMPRE do banco.
async function resolverItem(req, clientUserId) {
  const tipo = String(req.body.tipo || '');

  if (tipo === 'plano') {
    const plan = await subscriptionPlansRepository.findByKey(String(req.body.planKey || ''));
    if (!plan) throw new DadosInvalidosError('Plano inválido.');
    return { tipo, plan };
  }

  if (tipo === 'creditos') {
    const minutes = CREDITO.minutosPedidos(req.body.minutos);
    const subscription = await clientSubscriptionsRepository.getOrCreate(clientUserId);
    const priceCents = minutes * creditsService.taxasDoPlano(subscription).normal;
    return { tipo, minutes, priceCents, bucket: req.body.bucket === 'bonus' ? 'bonus' : 'normal' };
  }

  if (tipo === 'extras') {
    // Dois contadores independentes desde 01/09/2026: canal do YouTube e conta
    // do TikTok. O cliente pode levar só um dos dois, ou os dois (que sai mais
    // barato - ver lib/precoDasConexoesExtras).
    const canais = Math.trunc(Number(req.body.canais) || 0);
    const contas = Math.trunc(Number(req.body.contas) || 0);
    if (canais < 0 || contas < 0 || canais + contas < 1) {
      throw new DadosInvalidosError('Escolha pelo menos uma conexão para adicionar.');
    }
    if (canais > MAX_SLOTS_POR_COMPRA || contas > MAX_SLOTS_POR_COMPRA) {
      throw new DadosInvalidosError(`Escolha no máximo ${MAX_SLOTS_POR_COMPRA} de cada por compra.`);
    }
    return { tipo, canais, contas };
  }

  throw new DadosInvalidosError('Não entendi o que você quer comprar.');
}

// O pagamento em si. Um endpoint para as três compras e os dois meios de
// pagamento: a alternativa seria seis rotas quase idênticas, e a chance de uma
// delas esquecer a validação de valor.
async function pagar(req, res) {
  const clientUserId = req.session.user.id;
  const metodo = req.body.metodo === 'pix' ? 'pix' : 'cartao';

  try {
    const item = await resolverItem(req, clientUserId);

    // Cartão novo mandado junto do pagamento: salva primeiro (é o que gera o
    // token) e cobra em seguida. Quem já tem cartão salvo não manda nada e o
    // pagamento usa o token guardado.
    if (metodo === 'cartao' && req.body.cartao && req.body.cartao.number) {
      await checkoutService.salvarCartao({
        clientUserId,
        dadosDoTitular: req.body.titular || {},
        cartao: req.body.cartao,
        remoteIp: req.ip,
        email: req.session.user.email,
      });
    }

    if (item.tipo === 'plano') {
      if (metodo === 'pix') {
        // Mensalidade por PIX é o PIX Automático (um QR paga a primeira e
        // autoriza as próximas). Fica no controller de cobrança, que é onde
        // esse fluxo já vive inteiro.
        return res.status(400).json({ error: 'Use a opção de PIX Automático para assinar por PIX.' });
      }
      const r = await checkoutService.assinarComCartaoSalvo({ clientUserId, plan: item.plan, remoteIp: req.ip });
      return res.json({ ...r, tipo: 'plano', planName: item.plan.name });
    }

    if (item.tipo === 'creditos') {
      if (metodo === 'pix') {
        const r = await checkoutService.comprarCreditoComPix({
          clientUserId,
          minutes: item.minutes,
          bucket: item.bucket,
          priceCents: item.priceCents,
          dadosDoTitular: req.body.titular || {},
          email: req.session.user.email,
        });
        return res.json({ ...r, tipo: 'creditos' });
      }
      const r = await checkoutService.comprarCreditoComCartao({
        clientUserId,
        minutes: item.minutes,
        bucket: item.bucket,
        priceCents: item.priceCents,
        remoteIp: req.ip,
      });
      return res.json({ ...r, tipo: 'creditos' });
    }

    // extras — só no cartão: é uma assinatura recorrente, e recorrência por
    // PIX exigiria uma segunda autorização de PIX Automático só para o
    // adicional.
    if (metodo === 'pix') {
      return res.status(400).json({ error: 'Conexões extras só podem ser pagas no cartão.' });
    }
    const r = await checkoutService.comprarExtras({
      clientUserId,
      canais: item.canais,
      contas: item.contas,
      remoteIp: req.ip,
    });
    return res.json({ ...r, tipo: 'extras' });
  } catch (err) {
    return responderErro(res, err);
  }
}

// A tela pergunta se o PIX já caiu. Confere no Asaas em vez de só olhar o
// nosso banco: quem acabou de pagar fica olhando a tela, e esperar o aviso do
// Asaas chegar viraria "paguei e não aconteceu nada".
async function statusDoPagamento(req, res) {
  const r = await checkoutService.conferirPagamentoPendente(String(req.params.id), req.session.user.id);
  res.json(r);
}

async function removerExtras(req, res) {
  const canais = Math.max(0, Math.trunc(Number(req.body.canais) || 0));
  const contas = Math.max(0, Math.trunc(Number(req.body.contas) || 0));
  if (canais + contas < 1) {
    return res.status(400).json({ error: 'Escolha o que quer remover.' });
  }
  try {
    const totais = await checkoutService.removerExtras({ clientUserId: req.session.user.id, canais, contas });
    res.json({ extraChannels: totais.canais, extraTiktokAccounts: totais.contas });
  } catch (err) {
    logger.error(`Falha ao remover conexoes extras do cliente ${req.session.user.id}:`, err);
    return responderErro(res, err);
  }
}

module.exports = {
  contexto,
  salvarCartao,
  removerCartao,
  pagar,
  statusDoPagamento,
  removerExtras,
  MAX_SLOTS_POR_COMPRA,
};
