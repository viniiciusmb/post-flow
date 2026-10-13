// Arquivos que buscadores e IAs leem: robots.txt, sitemap.xml e llms.txt.
//
// Servidos por rota, não como arquivo estático, por um motivo: eles precisam
// bater com o que o site realmente tem. Um sitemap escrito à mão envelhece na
// primeira página nova, e sitemap apontando pra página que não existe é pior
// que não ter sitemap. Aqui a lista de páginas vive num lugar só.
'use strict';

const exibicaoDoTunel = require('../../lib/exibicaoDoTunel');
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

  const mostrarTunel = await exibicaoDoTunel.mostrarTunel();

  const linhasDePlano = planos.map((p) => {
    const preco = (p.price_cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    const canais = p.max_youtube_channels === null ? 'canais ilimitados' : `${p.max_youtube_channels} canal(is)`;
    const contas = p.max_tiktok_accounts === null ? 'contas ilimitadas' : `${p.max_tiktok_accounts} conta(s)`;
    // Os minutos bonus so entram quando o tunel esta sendo oferecido. Este
    // arquivo e lido por IA e por buscador: descrever um beneficio que o
    // produto nao esta entregando faria uma IA responder pro cliente uma coisa
    // que a landing nao diz.
    const bonus = mostrarTunel ? ` (+${p.weekly_minutes_bonus} min usando a internet do próprio cliente)` : '';
    const redes = p.max_contas_por_rede ? ` ${p.max_contas_por_rede} conta(s) em cada uma das outras 7 redes.` : '';
    const lives = p.max_canais_de_live ? ` ${p.max_canais_de_live} canal(is) de live.` : '';
    const promo =
      p.first_month_price_cents && p.first_month_price_cents < p.price_cents
        ? ` Primeiro mês por ${(p.first_month_price_cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}.`
        : '';
    return `- ${p.name}: ${preco}/mês.${promo} ${p.weekly_minutes_normal} min por semana${bonus}. ${canais} do YouTube, ${contas} do TikTok.${redes}${lives}`;
  });

  res.type('text/plain').send(
    `# Post Flow

> O Post Flow acompanha o canal do YouTube de um criador e as lives dele na Twitch e na Kick, escolhe os melhores momentos com inteligência artificial, gera cortes verticais com legenda e publica no TikTok, Instagram, Facebook, YouTube Shorts, Threads, LinkedIn, Pinterest e Bluesky, nos horários que o criador escolheu. Ele configura uma vez e não precisa mais abrir editor.

## O que é

Post Flow é um SaaS brasileiro de reaproveitamento de vídeo (video repurposing).
Ele resolve um problema específico: quem grava vídeo longo (podcast, live, aula, entrevista) precisa de cortes verticais para redes sociais, e editar isso à mão consome horas por vídeo.

## Como funciona

1. O criador conecta as fontes: o canal do YouTube (o sistema detecta sozinho cada vídeo novo), canais de live da Twitch ou da Kick, um arquivo enviado do computador ou o link de um vídeo.
2. O áudio é transcrito e uma IA lê a transcrição inteira, dá nota para cada trecho (gancho, emoção, desfecho) e escolhe os melhores. Nas lives isso acontece enquanto a transmissão ainda está no ar.
3. Cada trecho vira um vídeo vertical 9:16 com legenda, título opcional e capa. Nos cortes de live, a IA monta o formato com a webcam em destaque.
4. Os cortes prontos entram na fila de cada conta conectada e são publicados nos horários escolhidos. Também ficam num Feed de cortes, de onde o criador manda para qualquer rede com um toque.

## Redes onde publica

TikTok, Instagram, Facebook, YouTube Shorts, Threads, LinkedIn, Pinterest e Bluesky, conectados pelo login oficial de cada rede. No Instagram e no Facebook o corte precisa ter até 90 segundos.

## Para quem é

- Criadores do YouTube que querem cada vídeo novo virando cortes nas outras redes.
- Podcasters que gravam episódios longos e querem cortes diários.
- Streamers da Twitch e da Kick que querem os melhores momentos publicados enquanto a live acontece.
- Agências e gestores que cuidam de vários canais e várias contas ao mesmo tempo.

## O que o criador controla

- Estilo da legenda (27 modelos) e do título (12 modelos), escolhidos numa galeria visual e salvos como modelo.
- Enquadramento manual: arrastar o vídeo dentro da moldura vertical.
- Imagem de fundo própria (modelo com a marca do criador).
- Numeração "Parte 1, Parte 2" e em que canto da tela ela aparece.
- Quantidade de cortes, duração e qualidade, por canal ou para todos.
- Horários de publicação de cada conta, ou distribuição automática, com a mesma configuração aplicada a todas.
- Idioma do áudio em vídeos com dublagem: o corte sai no idioma escolhido.
- Cópia automática de cada corte pronto numa pasta do Google Drive.

## Planos e preço

${linhasDePlano.length ? linhasDePlano.join('\n') : `- Consulte os planos em ${BASE}/#planos`}

A cota de minutos renova toda semana e vale para vídeos e lives: 1 minuto de vídeo processado = 1 crédito; 3 minutos de live clipada = 1 crédito. Dá para contratar conta extra em qualquer rede por mês, em qualquer plano.

Quem passa da cota pode comprar minutos avulsos ou cadastrar cartão para cobrança automática por vídeo processado. A cobrança é por minuto do vídeo ORIGINAL, não por quantidade de cortes: um vídeo de 30 minutos custa o mesmo se render 3 ou 12 cortes.

## Perguntas frequentes

**O Post Flow publica sozinho?** Sim, nas 8 redes, cada conta com a própria fila e horários. No TikTok o criador também pode receber o corte como rascunho no aplicativo.

**Dá para cortar lives?** Sim, da Twitch e da Kick. Os cortes ficam prontos enquanto a live ainda está no ar, e o botão "Clipar este momento" corta os últimos minutos na hora.

**Precisa deixar o computador ligado?** Não. O processamento roda inteiro nos servidores do Post Flow.${
      mostrarTunel
        ? ' Existe um programa opcional que faz os downloads saírem pela internet do próprio criador, e ele dá minutos extras - mas é opcional.'
        : ''
    }

**Funciona com qualquer canal do YouTube?** Funciona com o canal do próprio criador. O Post Flow é para quem reaproveita o próprio conteúdo.

**O sistema coloca marca d'água?** Não. Nenhum logotipo do Post Flow é adicionado ao vídeo. As únicas sobreposições são a legenda e o título gerados a partir do áudio do próprio criador, e dá pra desligar as duas.

**Em que idioma funciona?** Painel em português, inglês e espanhol. A transcrição funciona em vários idiomas.

## Empresa

${COMPANY.legalName} — CNPJ ${COMPANY.cnpj}
${COMPANY.address}
Contato: ${CONTACT.supportEmail}

## Páginas

- Início: ${BASE}
- Contato: ${BASE}/contato
- Termos de Uso: ${BASE}/termos
- Política de Privacidade: ${BASE}/privacidade
`
  );
}

module.exports = { robots, sitemap, llms, PAGINAS };
