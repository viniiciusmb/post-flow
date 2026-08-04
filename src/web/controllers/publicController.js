// Paginas publicas: landing, termos, privacidade e contato.
//
// Sao as unicas paginas do sistema que qualquer pessoa (e os revisores do
// Google e do TikTok) enxerga sem login. Antes disso, a raiz do site so
// redirecionava pro /login.
'use strict';

const subscriptionPlansRepository = require('../../repositories/subscriptionPlansRepository');
const logger = require('../../lib/logger');
const { CONTACT, COMPANY } = require('../../config/constants');

// Data em que os documentos legais foram revisados pela ultima vez. Precisa
// ser atualizada A MAO sempre que o texto de termos/privacidade mudar - e o
// que diz ao usuario (e ao revisor da plataforma) que o documento nao esta
// abandonado.
const LEGAL_UPDATED_AT = '02/08/2026';

// Se o banco estiver fora do ar, a landing nao pode cair junto: melhor mostrar
// a pagina sem a tabela de precos do que devolver erro 500 pra quem chegou
// pela primeira vez (ou pra um revisor do Google).
const PLANOS_RESERVA = [];

// As perguntas ficam num lugar só: elas aparecem na página E viram FAQPage nos
// dados estruturados. Escrever nos dois lugares garantiria que um dia iam
// divergir, e resposta diferente da que está na página é exatamente o que faz
// o Google (e a IA) desconfiar do dado estruturado.
const PERGUNTAS = [
  {
    p: 'O Post Flow publica sozinho no TikTok?',
    r: 'Sim. Você escolhe entre receber o corte como rascunho no aplicativo do TikTok, pra finalizar por lá, ou publicar direto no seu perfil sem abrir o aplicativo. Na publicação direta você define privacidade e o que as pessoas podem fazer antes de cada corte sair.',
  },
  {
    p: 'Preciso deixar meu computador ligado?',
    r: 'Não. Todo o processamento acontece nos nossos servidores. Existe um programa opcional que faz os downloads saírem pela sua internet e te dá minutos extras no plano, mas ele é opcional e você escolhe se o vídeo espera o seu computador ou não.',
  },
  {
    p: 'Quantos cortes saem de cada vídeo?',
    r: 'Depende do vídeo e do que você configurar: só os melhores trechos, o vídeo inteiro fatiado, ou uma quantidade fixa. A cobrança é por minuto do vídeo original, então a quantidade de cortes não muda o preço.',
  },
  {
    p: 'Em quanto tempo o corte fica pronto?',
    r: 'Depende do tamanho do vídeo e da fila. Um vídeo de 30 minutos costuma levar alguns minutos entre detectar, transcrever, escolher os trechos e renderizar. Você acompanha a porcentagem de cada corte na tela.',
  },
  {
    p: 'O Post Flow coloca marca d\'água nos meus vídeos?',
    r: 'Não. Nenhum logotipo nosso é adicionado ao vídeo. As únicas coisas sobrepostas são a legenda e o título gerados a partir do seu próprio áudio, e você pode desligar as duas.',
  },
  {
    p: 'Posso usar mais de um canal e mais de uma conta do TikTok?',
    r: 'Pode. Cada canal do YouTube publica na conta do TikTok que você vincular a ele, e cada conta tem o próprio agendamento. A quantidade depende do plano.',
  },
  {
    p: 'O Post Flow serve para cortar vídeo de outra pessoa?',
    r: 'Não. A ferramenta existe para quem já produz o próprio conteúdo e quer automatizar a etapa de recortar e publicar. Ao usar o serviço você declara que tem direito sobre o material que manda processar. Não moderamos conteúdo antes da publicação e não nos responsabilizamos por uso indevido de material de terceiros.',
  },
  {
    p: 'Preciso dar minha senha do YouTube ou do TikTok?',
    r: 'Não. A conexão com o TikTok e com o Google Drive usa o login oficial de cada plataforma. Você autoriza na tela deles e o Post Flow nunca vê sua senha. Dá para revogar quando quiser, no painel ou nas configurações da sua conta.',
  },
  {
    p: 'O que exatamente vocês acessam no meu Google Drive?',
    r: 'Só a pasta que você escolher para receber os cortes prontos. O Post Flow usa uma permissão que alcança apenas os arquivos que ele próprio cria: o resto do seu Drive continua invisível para nós.',
  },
  {
    p: 'Os cortes ficam guardados para sempre?',
    r: 'Não. Depois de publicados eles são apagados do nosso servidor automaticamente, num prazo que você define. Se quiser guardar, use a exportação para o Google Drive, onde os arquivos ficam com você.',
  },
  {
    p: 'E se eu quiser revisar antes de publicar?',
    r: 'Você pode desligar a postagem automática e publicar manualmente, ou mandar cada corte pronto para uma pasta do seu Google Drive, separada por canal.',
  },
  {
    p: 'Posso cancelar quando quiser?',
    r: `Pode, sem multa e sem falar com ninguém. O acesso continua até o fim do período já pago. Para apagar a conta e todos os dados, é só escrever para ${CONTACT.supportEmail}.`,
  },
];

async function landing(req, res) {
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
        inLanguage: 'pt-BR',
        url: CONTACT.siteUrl,
        description:
          'Acompanha seu canal do YouTube, corta os melhores trechos de cada vídeo novo com IA, gera vídeos verticais com legenda e publica no seu TikTok automaticamente.',
        publisher: { '@id': `${CONTACT.siteUrl}/#organizacao` },
        featureList: [
          'Detecção automática de vídeo novo no canal do YouTube',
          'Seleção dos melhores trechos por inteligência artificial',
          'Corte vertical 9:16 com legenda queimada',
          'Publicação automática no TikTok',
          'Agendamento por horário',
          'Exportação para o Google Drive',
        ],
        offers: plans.map((p) => ({
          '@type': 'Offer',
          name: p.name,
          price: (p.price_cents / 100).toFixed(2),
          priceCurrency: 'BRL',
          category: 'Assinatura mensal',
          url: `${CONTACT.siteUrl}/#planos`,
        })),
      },
      {
        '@type': 'FAQPage',
        '@id': `${CONTACT.siteUrl}/#perguntas`,
        mainEntity: PERGUNTAS.map((item) => ({
          '@type': 'Question',
          name: item.p,
          acceptedAnswer: { '@type': 'Answer', text: item.r },
        })),
      },
      {
        '@type': 'HowTo',
        '@id': `${CONTACT.siteUrl}/#como-funciona`,
        name: 'Como transformar vídeos do YouTube em cortes publicados no TikTok',
        description:
          'As quatro etapas do Post Flow, da conexão do canal até o corte publicado no TikTok.',
        step: [
          { '@type': 'HowToStep', position: 1, name: 'Conecte o canal', text: 'Cole o endereço do seu canal do YouTube. A partir daí o Post Flow percebe sozinho quando você publica um vídeo novo.' },
          { '@type': 'HowToStep', position: 2, name: 'A IA escolhe os trechos', text: 'O áudio é transcrito e uma inteligência artificial lê a transcrição inteira procurando os trechos que funcionam sozinhos.' },
          { '@type': 'HowToStep', position: 3, name: 'Corte, legenda e capa', text: 'Cada trecho vira um vídeo vertical 9:16 com legenda queimada, título opcional e capa.' },
          { '@type': 'HowToStep', position: 4, name: 'Publicação no seu horário', text: 'Os cortes prontos entram numa fila e são publicados na sua conta do TikTok nos horários que você escolheu.' },
        ],
      },
    ],
  };

  res.render('public/landing', {
    title: 'Cortes automáticos do YouTube pro TikTok',
    metaDescription:
      'O Post Flow acompanha seu canal do YouTube, corta os melhores trechos com IA, legenda no formato vertical e publica no seu TikTok automaticamente. Você grava uma vez; o resto acontece sozinho.',
    canonical: CONTACT.siteUrl,
    structuredData: `<script type="application/ld+json">${JSON.stringify(dadosEstruturados)}</script>`,
    perguntas: PERGUNTAS,
    plans,
    contact: CONTACT,
    company: COMPANY,
  });
}

function terms(req, res) {
  res.render('legal/terms', {
    title: 'Termos de Uso',
    canonical: `${CONTACT.siteUrl}/termos`,
    metaDescription: 'Termos de Uso do Post Flow.',
    updatedAt: LEGAL_UPDATED_AT,
    contact: CONTACT,
    company: COMPANY,
  });
}

function privacy(req, res) {
  res.render('legal/privacy', {
    title: 'Política de Privacidade',
    canonical: `${CONTACT.siteUrl}/privacidade`,
    metaDescription:
      'Como o Post Flow trata seus dados: o que guardamos, por quanto tempo, com quem compartilhamos e como apagar tudo.',
    updatedAt: LEGAL_UPDATED_AT,
    contact: CONTACT,
    company: COMPANY,
  });
}

function contact(req, res) {
  res.render('public/contact', {
    title: 'Contato e suporte',
    metaDescription: `Fale com o suporte do Post Flow por ${CONTACT.supportEmail}. Respondemos ${CONTACT.responseTime}.`,
    canonical: `${CONTACT.siteUrl}/contato`,
    contact: CONTACT,
    company: COMPANY,
  });
}

module.exports = { landing, terms, privacy, contact, LEGAL_UPDATED_AT };
