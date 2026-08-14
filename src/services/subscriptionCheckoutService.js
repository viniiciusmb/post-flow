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
async function criarCheckoutDeAssinatura({ clientUserId, planKey, origin }) {
  if (!stripeService.isConfigured()) return null;

  const plan = await subscriptionPlansRepository.findByKey(String(planKey || ''));
  if (!plan || !plan.stripe_price_id) return null;

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
async function destinoDepoisDeEntrar({ user, planKey, origin }) {
  if (user.role === ROLES.ADMIN) return '/admin';
  if (!planKey) return '/client';

  try {
    const url = await criarCheckoutDeAssinatura({ clientUserId: user.id, planKey, origin });
    return url || '/client/billing';
  } catch (err) {
    logger.error(`Nao consegui abrir o checkout do plano "${planKey}" pro cliente ${user.id}:`, err);
    return '/client/billing';
  }
}

module.exports = { resolveStripeCustomerId, criarCheckoutDeAssinatura, destinoDepoisDeEntrar };
