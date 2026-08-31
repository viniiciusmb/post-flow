// Abrir um checkout de assinatura na Stripe.
//
// Fica num servico, e nao dentro do controller de cobranca, porque DOIS
// caminhos precisam da mesma coisa: o botao "assinar" de dentro do painel e o
// cadastro vindo da landing (a pessoa escolhe o plano antes de ter conta, e o
// checkout tem que abrir assim que a conta nasce). Duplicar isso significaria
// duas versoes da resolucao de customer - e e justamente ali que mora o
// conserto do customer orfao, que ja quebrou a producao uma vez.
'use strict';

const clientSubscriptionsRepository = require('../repositories/clientSubscriptionsRepository');
const subscriptionPlansRepository = require('../repositories/subscriptionPlansRepository');
const usersRepository = require('../repositories/usersRepository');
const stripeService = require('./stripeService');
const asaasBillingService = require('./asaasBillingService');
const logger = require('../lib/logger');
const { ROLES } = require('../config/constants');

// Cria o customer na Stripe na primeira vez que o cliente faz qualquer
// acao de pagamento (assinar, comprar avulso, cadastrar cartao) e guarda o
// id pra reaproveitar dai em diante.
async function resolveStripeCustomerId(clientUserId, subscription) {
  // O id salvo so serve se o customer ainda existir DESTE lado da Stripe.
  // Trocar a chave de teste pela de producao (ou trocar de conta) deixa todo
  // id antigo apontando pro vazio - e ai TODO botao de pagamento daquele
  // cliente morria com "Algo deu errado" generico, sem pista nenhuma na tela.
  // Em vez de exigir conserto manual no banco a cada troca de chave, o proprio
  // fluxo detecta e recria o customer na hora.
  if (subscription.stripe_customer_id) {
    if (await stripeService.customerExists(subscription.stripe_customer_id)) {
      return subscription.stripe_customer_id;
    }
    logger.warn(
      `Customer da Stripe ${subscription.stripe_customer_id} (cliente #${clientUserId}) nao existe mais nesta conta/modo - recriando e limpando os vinculos antigos.`
    );
    await clientSubscriptionsRepository.clearStripeLinks(clientUserId);
  }

  const user = await usersRepository.findById(clientUserId);
  const customerId = await stripeService.ensureCustomer(null, {
    email: user.email,
    name: user.business_name,
    clientUserId,
  });
  await clientSubscriptionsRepository.setStripeCustomer(clientUserId, customerId);
  return customerId;
}

// Devolve a URL do checkout, ou null quando nao da pra abrir um (Stripe fora,
// plano inexistente, plano sem preco criado la). Devolver null em vez de
// lancar e proposital: no cadastro vindo da landing, nada disso pode custar a
// CONTA da pessoa - ela acabou de se cadastrar, e o certo e cair na tela de
// planos, nao numa pagina de erro.
async function criarCheckoutDeAssinatura({ clientUserId, planKey, origin, user }) {
  const plan = await subscriptionPlansRepository.findByKey(String(planKey || ''));
  if (!plan) return null;

  await clientSubscriptionsRepository.getOrCreate(clientUserId);

  // Mesmo destino do botao de dentro do painel: a NOSSA tela de checkout. Ela
  // ja sabe se o cliente tem cartao salvo, se ainda tem direito ao primeiro
  // mes promocional e qual plano foi escolhido - nada disso precisa ser
  // recalculado aqui.
  //
  // Antes esta funcao tinha a propria versao (Stripe) enquanto o botao ja
  // usava o Asaas: o mesmo cliente ia parar em provedores diferentes
  // dependendo de ter clicado no plano na landing ou dentro do sistema.
  if (asaasBillingService.clientePodeUsarAsaas(user || { role: 'client' })) {
    return `/client/checkout?plano=${encodeURIComponent(plan.key)}`;
  }

  if (!stripeService.isConfigured() || !plan.stripe_price_id) return null;
  const subscription = await clientSubscriptionsRepository.getOrCreate(clientUserId);
  const customerId = await resolveStripeCustomerId(clientUserId, subscription);
  const session = await stripeService.createCheckoutSessionForSubscription({
    customerId,
    priceId: plan.stripe_price_id,
    successUrl: `${origin}/client/billing?assinatura=sucesso`,
    cancelUrl: `${origin}/client/billing?assinatura=cancelado`,
    metadata: { clientUserId: String(clientUserId), planKey: plan.key },
  });
  return session.url;
}

// Pra onde mandar alguem que acabou de entrar ou de se cadastrar.
//
// Quem clicou num plano na landing escolheu ANTES de ter conta: o plano ficou
// guardado na sessao (ver affiliateAttribution) e so agora existe conta pra
// abrir um checkout. Antes o fluxo terminava no painel, e quem quis assinar
// tinha que caçar a tela de planos e escolher tudo de novo.
//
// Nada disso pode custar o acesso: se o checkout nao abrir por qualquer
// motivo, cai na tela de planos, nunca numa pagina de erro - a conta ja existe
// e a pessoa ja esta logada.
async function destinoDepoisDeEntrar({ user, planKey, origin, returnTo = null }) {
  if (user.role === ROLES.ADMIN) return '/admin';

  // O PLANO VEM PRIMEIRO. Ele so existe na sessao porque a pessoa acabou de
  // clicar num plano na landing - e a intencao mais explicita e mais recente
  // que existe. O destino lembrado e passivo (ela tentou abrir uma pagina e
  // foi barrada), entao nunca pode passar na frente.
  //
  // Ao contrario disso, quem clicava em "Assinar" na landing e criava a conta
  // caia no inicio do painel: um returnTo guardado dias antes sequestrava o
  // cadastro inteiro e a pessoa nunca via o checkout.
  if (planKey) {
    try {
      const url = await criarCheckoutDeAssinatura({ clientUserId: user.id, planKey, origin, user });
      // Nada disso pode custar o acesso: se o checkout nao abrir, cai na tela
      // de planos, nunca numa pagina de erro - a conta ja existe e a pessoa
      // ja esta logada.
      return url || '/client/billing';
    } catch (err) {
      logger.error(`Nao consegui abrir o checkout do plano "${planKey}" pro cliente ${user.id}:`, err);
      return '/client/billing';
    }
  }

  // Quem foi parar no login porque tentou abrir uma pagina do painel sem
  // sessao volta pra onde queria ir - inclusive quem estava voltando da tela
  // de pagamento.
  if (returnTo) return returnTo;

  return '/client';
}

// 30 minutos. O destino lembrado serve pra emendar uma ida ao login que
// acabou de acontecer - tipicamente voltar de um pagamento. A sessao dura
// dias; sem prazo, uma pagina que a pessoa tentou abrir na semana passada
// ainda estaria esperando pra sequestrar o proximo login dela.
const VALIDADE_DO_RETORNO_MS = 30 * 60 * 1000;

// Uso unico E com prazo: se o destino ficasse guardado, um login futuro
// mandaria a pessoa pra uma pagina antiga sem ela ter pedido nada.
function consumirReturnTo(req) {
  const guardado = req.session && req.session.returnTo;
  if (req.session) delete req.session.returnTo;
  if (!guardado) return null;

  // Formato antigo (string pura) de sessoes criadas antes do carimbo de hora:
  // descartado, porque nao da pra saber se ja venceu.
  if (typeof guardado === 'string') return null;
  if (!guardado.url || typeof guardado.em !== 'number') return null;
  if (Date.now() - guardado.em > VALIDADE_DO_RETORNO_MS) return null;
  return guardado.url;
}

module.exports = {
  resolveStripeCustomerId,
  criarCheckoutDeAssinatura,
  destinoDepoisDeEntrar,
  consumirReturnTo,
  VALIDADE_DO_RETORNO_MS,
};
