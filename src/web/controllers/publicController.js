// Paginas publicas: landing, termos, privacidade e contato.
//
// Sao as unicas paginas do sistema que qualquer pessoa (e os revisores do
// Google e do TikTok) enxerga sem login. Antes disso, a raiz do site so
// redirecionava pro /login.
'use strict';

const exibicaoDoTunel = require('../../lib/exibicaoDoTunel');
const subscriptionPlansRepository = require('../../repositories/subscriptionPlansRepository');
const logger = require('../../lib/logger');
const { CONTACT, COMPANY } = require('../../config/constants');

// Data em que os documentos legais foram revisados pela ultima vez. Precisa
// ser atualizada A MAO sempre que o texto de termos/privacidade mudar - e o
// que diz ao usuario (e ao revisor da plataforma) que o documento nao esta
// abandonado.
const LEGAL_UPDATED_AT = '21/08/2026';

// Se o banco estiver fora do ar, a landing nao pode cair junto: melhor mostrar
// a pagina sem a tabela de precos do que devolver erro 500 pra quem chegou
// pela primeira vez (ou pra um revisor do Google).
const PLANOS_RESERVA = [];

// As perguntas ficam num lugar só: elas aparecem na página E viram FAQPage nos
// dados estruturados. Escrever nos dois lugares garantiria que um dia iam
// divergir, e resposta diferente da que está na página é exatamente o que faz
// o Google (e a IA) desconfiar do dado estruturado.
//
// Agora vêm do dicionário do idioma da requisição (src/i18n), pelo mesmo
// motivo: o dado estruturado tem que dizer o mesmo que a página que o visitante
// está lendo, senão a incoerência é entre idiomas em vez de entre arquivos.

// Substitui {empresa}, {cnpj}, {endereco}, {email}, {site}, {tempo} e {data}
// pelos dados reais. Fica aqui, e nao no dicionario, porque esses valores nao
// sao traduziveis: repeti-los em tres idiomas so criaria a chance de um deles
// ficar com um CNPJ velho.
function criarPreenchedor() {
  const valores = {
    empresa: COMPANY.legalName,
    cnpj: COMPANY.cnpj,
    endereco: COMPANY.address,
    email: CONTACT.supportEmail,
    site: CONTACT.siteUrl,
    tempo: CONTACT.responseTime,
    data: LEGAL_UPDATED_AT,
  };
  return (texto) =>
    String(texto).replace(/\{(\w+)\}/g, (bruto, nome) =>
      Object.prototype.hasOwnProperty.call(valores, nome) ? valores[nome] : bruto
    );
}

async function landing(req, res) {
  const t = res.locals.t;
  const mostrarTunel = await exibicaoDoTunel.mostrarTunel();

  // Uma das perguntas cita o programa que faz o download sair pela internet do
  // cliente. Com o tunel escondido, ela responde a mesma coisa sem citar o
  // programa - a pergunta continua valendo ("preciso deixar o computador
  // ligado?"), so a metade que oferece o opcional e que sai.
  //
  // A troca acontece AQUI, e nao na pagina, porque este mesmo array vira o
  // FAQPage dos dados estruturados: resposta diferente da que esta na tela e
  // exatamente o que faz o Google desconfiar do dado estruturado.
  const perguntas = t('perguntas').map((item) =>
    !mostrarTunel && item.rSemTunel ? { p: item.p, r: item.rSemTunel } : { p: item.p, r: item.r }
  );
  // Precos vem do banco (subscription_plans) em vez de escritos na pagina, pra
  // que a landing nunca fique divergindo do que o sistema realmente cobra.
  let plans = PLANOS_RESERVA;
  try {
    plans = await subscriptionPlansRepository.listActive();
  } catch (err) {
    logger.error('Nao consegui carregar os planos pra landing (seguindo sem a tabela de precos):', err.message);
  }

  // Um SoftwareApplication com os preços de verdade (vindos do banco) é o que
  // permite ao Google e a uma IA responder "quanto custa o Post Flow" sem
  // chutar. Preço escrito à mão aqui divergiria do sistema no primeiro reajuste.
  const dadosEstruturados = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'SoftwareApplication',
        '@id': `${CONTACT.siteUrl}/#produto`,
        name: 'Post Flow',
        applicationCategory: 'MultimediaApplication',
        applicationSubCategory: 'Edição e publicação de vídeo',
        operatingSystem: 'Web',
        inLanguage: res.locals.htmlLang,
        url: CONTACT.siteUrl,
        description: t('landing.metaDescricao'),
        publisher: { '@id': `${CONTACT.siteUrl}/#organizacao` },
        featureList: t('landing.recursos').map((r) => r.h),
        // O preco declarado e o RECORRENTE, nao o promocional do primeiro mes:
        // e ele que o cliente paga em quase toda a vida da assinatura, e um
        // dado estruturado que anuncia o preco de estreia faria o Google (e as
        // IAs que leem isto) responderem "custa R$59,90/mes", que nao e
        // verdade. A promocao entra na descricao, onde e informacao e nao
        // promessa de preco.
        offers: plans.map((p) => ({
          '@type': 'Offer',
          name: p.name,
          price: (p.price_cents / 100).toFixed(2),
          priceCurrency: 'BRL',
          category: 'Assinatura mensal',
          url: `${CONTACT.siteUrl}/#planos`,
          ...(p.first_month_price_cents && p.first_month_price_cents < p.price_cents
            ? {
                description: `Primeiro mes por R$ ${(p.first_month_price_cents / 100)
                  .toFixed(2)
                  .replace('.', ',')}.`,
              }
            : {}),
        })),
      },
      {
        '@type': 'FAQPage',
        '@id': `${CONTACT.siteUrl}/#perguntas`,
        mainEntity: perguntas.map((item) => ({
          '@type': 'Question',
          name: item.p,
          acceptedAnswer: { '@type': 'Answer', text: item.r },
        })),
      },
      {
        '@type': 'HowTo',
        '@id': `${CONTACT.siteUrl}/#como-funciona`,
        name: t('landing.comoFuncionaTitulo'),
        description: t('landing.lead'),
        step: t('landing.passos').map((passo, i) => ({
          '@type': 'HowToStep',
          position: i + 1,
          name: passo.h,
          text: passo.p,
        })),
      },
    ],
  };

  res.render('public/landing', {
    title: t('landing.tituloPagina'),
    metaDescription: t('landing.metaDescricao'),
    canonical: CONTACT.siteUrl,
    structuredData: `<script type="application/ld+json">${JSON.stringify(dadosEstruturados)}</script>`,
    perguntas,
    plans,
    // Esconde a linha "N minutos usando sua internet" das caixas de preco.
    // Anunciar na landing minutos que o produto nao esta oferecendo e a pior
    // versao do problema: vira promessa de venda. So exibicao - ver
    // lib/exibicaoDoTunel.
    mostrarTunel,
    contact: CONTACT,
    company: COMPANY,
  });
}

function terms(req, res) {
  const doc = res.locals.t('termos');
  res.render('legal/documento', {
    doc,
    preencher: criarPreenchedor(),
    title: doc.titulo,
    canonical: `${CONTACT.siteUrl}/termos`,
    metaDescription: doc.titulo + ' · Post Flow',
    contact: CONTACT,
    company: COMPANY,
  });
}

function privacy(req, res) {
  const doc = res.locals.t('privacidade');
  res.render('legal/documento', {
    doc,
    preencher: criarPreenchedor(),
    title: doc.titulo,
    canonical: `${CONTACT.siteUrl}/privacidade`,
    metaDescription: doc.titulo + ' · Post Flow',
    contact: CONTACT,
    company: COMPANY,
  });
}

function contact(req, res) {
  const t = res.locals.t;
  res.render('public/contact', {
    title: t('contato.titulo'),
    metaDescription: t('contato.metaDescricao'),
    canonical: `${CONTACT.siteUrl}/contato`,
    contact: CONTACT,
    company: COMPANY,
  });
}

module.exports = { landing, terms, privacy, contact, LEGAL_UPDATED_AT };
