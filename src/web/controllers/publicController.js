// Paginas publicas: landing, termos, privacidade e contato.
//
// Sao as unicas paginas do sistema que qualquer pessoa (e os revisores do
// Google e do TikTok) enxerga sem login. Antes disso, a raiz do site so
// redirecionava pro /login.
'use strict';

const subscriptionPlansRepository = require('../../repositories/subscriptionPlansRepository');
const logger = require('../../lib/logger');
const { CONTACT } = require('../../config/constants');

// Data em que os documentos legais foram revisados pela ultima vez. Precisa
// ser atualizada A MAO sempre que o texto de termos/privacidade mudar - e o
// que diz ao usuario (e ao revisor da plataforma) que o documento nao esta
// abandonado.
const LEGAL_UPDATED_AT = '02/08/2026';

// Se o banco estiver fora do ar, a landing nao pode cair junto: melhor mostrar
// a pagina sem a tabela de precos do que devolver erro 500 pra quem chegou
// pela primeira vez (ou pra um revisor do Google).
const PLANOS_RESERVA = [];

async function landing(req, res) {
  // Precos vem do banco (subscription_plans) em vez de escritos na pagina, pra
  // que a landing nunca fique divergindo do que o sistema realmente cobra.
  let plans = PLANOS_RESERVA;
  try {
    plans = await subscriptionPlansRepository.listActive();
  } catch (err) {
    logger.error('Nao consegui carregar os planos pra landing (seguindo sem a tabela de precos):', err.message);
  }

  res.render('public/landing', {
    title: 'Cortes automáticos do YouTube pro TikTok',
    metaDescription:
      'O Post Flow acompanha seu canal do YouTube, corta os melhores trechos com IA, legenda no formato vertical e publica no seu TikTok automaticamente.',
    plans,
    contact: CONTACT,
  });
}

function terms(req, res) {
  res.render('legal/terms', {
    title: 'Termos de Uso',
    metaDescription: 'Termos de Uso do Post Flow.',
    updatedAt: LEGAL_UPDATED_AT,
    contact: CONTACT,
  });
}

function privacy(req, res) {
  res.render('legal/privacy', {
    title: 'Política de Privacidade',
    metaDescription:
      'Como o Post Flow trata seus dados: o que guardamos, por quanto tempo, com quem compartilhamos e como apagar tudo.',
    updatedAt: LEGAL_UPDATED_AT,
    contact: CONTACT,
  });
}

function contact(req, res) {
  res.render('public/contact', {
    title: 'Contato e suporte',
    metaDescription: 'Fale com o suporte do Post Flow.',
    contact: CONTACT,
  });
}

module.exports = { landing, terms, privacy, contact, LEGAL_UPDATED_AT };
