// Arquivos que buscadores e IAs leem: robots.txt, sitemap.xml e llms.txt.
//
// Servidos por rota, não como arquivo estático, por um motivo: eles precisam
// bater com o que o site realmente tem. Um sitemap escrito à mão envelhece na
// primeira página nova, e sitemap apontando pra página que não existe é pior
// que não ter sitemap. Aqui a lista de páginas vive num lugar só.
'use strict';

const subscriptionPlansRepository = require('../../repositories/subscriptionPlansRepository');
const { CONTACT, COMPANY } = require('../../config/constants');
const logger = require('../../lib/logger');

const BASE = CONTACT.siteUrl;

// As páginas públicas, com a importância relativa entre elas. `changefreq` e
// `priority` são dicas, não ordens - o buscador decide. Ainda assim dizem qual
// página é a porta de entrada e qual é documento de rodapé.
const PAGINAS = [
  { caminho: '/', prioridade: '1.0', frequencia: 'weekly' },
  { caminho: '/contato', prioridade: '0.5', frequencia: 'monthly' },
  { caminho: '/termos', prioridade: '0.3', frequencia: 'yearly' },
  { caminho: '/privacidade', prioridade: '0.3', frequencia: 'yearly' },
];

function robots(req, res) {
  res.type('text/plain').send(
    [
      'User-agent: *',
      'Allow: /',
      '',
      '# Área logada: não há nada aqui pra buscador, e indexar tela de painel',
      '# só gera resultado quebrado pra quem clica sem estar logado.',
      'Disallow: /client',
      'Disallow: /admin',
      'Disallow: /api',
      'Disallow: /auth',
      'Disallow: /login',
      'Disallow: /redefinir-senha',
      '',
      `Sitemap: ${BASE}/sitemap.xml`,
      '',
    ].join('\n')
  );
}

function sitemap(req, res) {
  const hoje = new Date().toISOString().slice(0, 10);
  const urls = PAGINAS.map(
    (p) => `  <url>
    <loc>${BASE}${p.caminho}</loc>
    <lastmod>${hoje}</lastmod>
    <changefreq>${p.frequencia}</changefreq>
    <priority>${p.prioridade}</priority>
  </url>`
  ).join('\n');

  res.type('application/xml').send(
    `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`
  );
}

// llms.txt: um resumo do site em texto puro, pra modelo de linguagem entender
// o que o produto faz sem ter que interpretar HTML e CSS. Não é padrão oficial
// de ninguém e nenhuma IA é obrigada a ler - é um sinal, não um controle. Mas
// é barato de manter e resolve o problema real: descrição errada de produto
// circulando por aí porque a IA adivinhou lendo o menu do site.
//
// Escrito em frases curtas e afirmativas de propósito: é assim que um trecho
// vira citação, em vez de virar paráfrase torta.
async function llms(req, res) {
  let planos = [];
  try {
    planos = await subscriptionPlansRepository.listActive();
  } catch (err) {
    logger.error('llms.txt sem a tabela de planos:', err.message);
  }

  const linhasDePlano = planos.map((p) => {
    const preco = (p.price_cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    const canais = p.max_youtube_channels === null ? 'canais ilimitados' : `${p.max_youtube_channels} canal(is)`;
    const contas = p.max_tiktok_accounts === null ? 'contas ilimitadas' : `${p.max_tiktok_accounts} conta(s)`;
    return `- ${p.name}: ${preco}/mês. ${p.weekly_minutes_normal} min de vídeo por semana (+${p.weekly_minutes_bonus} min usando a internet do próprio cliente). ${canais} do YouTube, ${contas} do TikTok.`;
  });

  res.type('text/plain').send(
    `# Post Flow

> O Post Flow acompanha o canal do YouTube de um criador, corta os melhores trechos de cada vídeo novo com inteligência artificial, gera vídeos verticais com legenda queimada e publica no TikTok do próprio criador. O criador configura uma vez e não precisa mais abrir editor.

## O que é

Post Flow é um SaaS brasileiro de reaproveitamento de vídeo (video repurposing).
Ele resolve um problema específico: quem grava vídeo longo (podcast, live, aula, entrevista) precisa de cortes verticais para redes sociais, e editar isso à mão consome horas por vídeo.

## Como funciona, em quatro etapas

1. O criador cola o endereço do canal do YouTube dele. O sistema passa a detectar sozinho quando um vídeo novo é publicado.
2. O áudio é transcrito (Whisper) e uma IA (Claude) lê a transcrição inteira procurando os trechos que funcionam sozinhos: gancho, desenvolvimento e fecho.
3. Cada trecho vira um vídeo vertical 9:16 com legenda queimada, título opcional e capa. O corte é feito com ffmpeg.
4. Os cortes prontos entram numa fila e são publicados na conta de TikTok do criador, nos horários que ele escolheu.

Também aceita vídeo enviado do computador e link de vídeo avulso do YouTube.

## Para quem é

- Podcasters que gravam episódios longos e querem cortes diários.
- Criadores de live e de aula que já têm acervo de vídeo longo parado.
- Agências e editores que cuidam de vários canais ao mesmo tempo.

## O que o criador controla

- Estilo da legenda e do título, escolhidos numa galeria visual.
- Enquadramento manual: arrastar o vídeo dentro da moldura vertical.
- Imagem de fundo própria (modelo com a marca do criador).
- Numeração "Parte 1, Parte 2" e em que canto da tela ela aparece.
- Quantidade de cortes, duração e qualidade, por canal ou para todos.
- Horários de publicação, ou distribuição automática.
- Cópia automática de cada corte pronto numa pasta do Google Drive.

## Planos e preço

${linhasDePlano.length ? linhasDePlano.join('\n') : '- Consulte os planos em https://postflowtiktok.com/#planos'}

Quem passa da cota pode comprar minutos avulsos ou cadastrar cartão para cobrança automática por vídeo processado. A cobrança é por minuto do vídeo ORIGINAL, não por quantidade de cortes: um vídeo de 30 minutos custa o mesmo se render 3 ou 12 cortes.

## Perguntas frequentes

**O Post Flow publica sozinho no TikTok?** Sim. O criador escolhe entre receber o corte como rascunho no aplicativo do TikTok ou publicar direto no perfil. Na publicação direta, ele define privacidade e interações antes de cada corte sair.

**Precisa deixar o computador ligado?** Não. O processamento roda nos servidores do Post Flow. Existe um programa opcional que faz os downloads saírem pela internet do próprio criador, e ele dá minutos extras - mas é opcional.

**Funciona com qualquer canal do YouTube?** Funciona com o canal do próprio criador. O Post Flow é para quem reaproveita o próprio conteúdo.

**O sistema coloca marca d'água?** Não. Nenhum logotipo do Post Flow é adicionado ao vídeo. As únicas sobreposições são a legenda e o título gerados a partir do áudio do próprio criador, e dá pra desligar as duas.

**Em que idioma funciona?** Interface e suporte em português do Brasil. A transcrição funciona em vários idiomas.

## Empresa

${COMPANY.legalName} — CNPJ ${COMPANY.cnpj}
${COMPANY.address}
Contato: ${CONTACT.supportEmail}

## Páginas

- Início: ${BASE}/
- Contato: ${BASE}/contato
- Termos de Uso: ${BASE}/termos
- Política de Privacidade: ${BASE}/privacidade
`
  );
}

module.exports = { robots, sitemap, llms, PAGINAS };
