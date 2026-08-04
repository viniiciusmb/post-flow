'use strict';

const ROLES = Object.freeze({
  ADMIN: 'admin',
  CLIENT: 'client',
});

const POSTING_STATUS = Object.freeze({
  PENDING: 'pending',
  QUEUED: 'queued',
  PROCESSING: 'processing',
  POSTED: 'posted',
  ERROR: 'error',
});

const DRIVE_FOLDER_TYPE = Object.freeze({
  CLIENT: 'client',
});

// Dados publicos da empresa. Aparecem na landing, na pagina de contato, nos
// Termos e na Politica de Privacidade - e sao exatamente os mesmos que vao no
// formulario de verificacao do Google e do TikTok, entao tem que bater.
// Um lugar so pra nao ficar divergindo entre as paginas.
const CONTACT = Object.freeze({
  // ATENCAO: este endereco e o REMETENTE dos e-mails (Resend). Se o dominio
  // daqui nao estiver verificado na Resend, a recuperacao de senha para de
  // funcionar EM SILENCIO: a Resend recusa o envio e a tela continua dizendo
  // "o link ja esta a caminho".
  //
  // Conferido em 04/08/2026 contra a API da Resend: postflowclips.com envia,
  // postflowtiktok.com foi removido de la e nao envia mais.
  supportEmail: 'contato@postflowclips.com',

  // Dominio publico do produto. Fonte unica: canonical, Open Graph, dados
  // estruturados, sitemap, robots, llms.txt e os links dos e-mails saem daqui.
  // O dominio antigo (postflowtiktok.com) continua servindo o sistema - o que
  // muda e qual deles o site declara ser o oficial.
  siteUrl: 'https://postflowclips.com',
  responseTime: 'até 2 dias úteis',
});

// Pessoa jurídica por trás do Post Flow. Aparece no rodapé de todas as páginas
// públicas e nos documentos legais.
//
// Não é burocracia: um site que não diz quem está por trás dele perde confiança
// de quem vai cadastrar cartão, e "identidade do desenvolvedor" é item de
// checagem tanto na verificação OAuth do Google quanto na revisão de aplicativo
// do TikTok. Sem isso, os Termos também não têm parte contratante definida.
const COMPANY = Object.freeze({
  legalName: 'Kleos Digital LTDA',
  cnpj: '62.111.132/0001-48',
  address: 'Rua Mistral, 332, Edif. The Point, sala 209A · Despraiado · Cuiabá/MT · CEP 78.048-222',
  city: 'Cuiabá/MT',
});

module.exports = { ROLES, POSTING_STATUS, DRIVE_FOLDER_TYPE, CONTACT, COMPANY };
