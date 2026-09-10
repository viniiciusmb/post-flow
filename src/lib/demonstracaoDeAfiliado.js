'use strict';

// Painel de afiliado preenchido com uma base de exemplo, para as contas
// listadas em settings.affiliate_demo_user_ids.
//
// Nada aqui é gravado. Não existe cliente fantasma, não existe lançamento de
// comissão, não existe saldo sacável de verdade: a conta na demonstração
// continua com os mesmos zeros no banco, e o painel do admin, os relatórios de
// custo e a contabilidade seguem contando só o que aconteceu de verdade.
//
// Duas escolhas importantes:
//
//   1. É DETERMINÍSTICO. Os mesmos números aparecem a cada visita (semente
//      fixa por usuário). Se sorteasse a cada carregamento, um F5 mudaria o
//      saldo na tela - que é o jeito mais rápido de perceber que os dados não
//      são reais.
//   2. Tudo é SIMULADO a partir de três taxas, não escrito à mão. Os cliques
//      viram cadastros, parte dos cadastros vira assinatura, e o churn
//      cancela algumas ao longo dos meses. Números digitados um a um se
//      contradizem: era o caso da versão anterior, com 14 indicações e 6
//      assinantes que não vinham de conversão nenhuma.
//
// Para desligar: apague a chave affiliate_demo_user_ids em settings.

const CHAVE = 'affiliate_demo_user_ids';

// ---------------------------------------------------------------------------
// As taxas que geram tudo (definidas pelo fundador)
// ---------------------------------------------------------------------------
const DIAS_DE_HISTORICO = 180;
// De cada 100 cliques, 8 criam conta e 3 chegam a assinar. A distância entre
// os dois é o que faz a tela mostrar gente que se cadastrou e ainda não
// assinou - que é o retrato normal de um programa de indicação.
const CLIQUE_VIRA_CADASTRO = 0.08;
const CLIQUE_VIRA_ASSINATURA = 0.03;
// Chance de um assinante cancelar em cada mês.
const CHURN_MENSAL = 0.07;
// Parte dos assinantes ativos está com a mensalidade atrasada. Existe na vida
// real e a tela tem um cartão para isso.
const TAXA_DE_ATRASO = 0.06;
// Quanto do que já foi ganho já saiu em saque. É uma FRAÇÃO do total ganho, e
// não um valor fixo: com valores cravados, um percentual de comissão baixo
// deixaria o saldo disponível NEGATIVO - o afiliado teria sacado mais do que
// ganhou, o que é impossível.
const FRACAO_JA_SACADA = 0.55;

// Gerador com semente (mulberry32): mesma semente, mesma sequência, sempre.
function gerador(semente) {
  let a = semente >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function diasAtras(n, base) {
  const d = new Date(base);
  d.setDate(d.getDate() - n);
  return d;
}

function mesesDepois(data, n) {
  const d = new Date(data);
  d.setMonth(d.getMonth() + n);
  return d;
}

// Quantos meses inteiros se passaram entre duas datas.
function mesesEntre(de, ate) {
  let n = 0;
  while (mesesDepois(de, n + 1) <= ate) n += 1;
  return n;
}

async function ehDemo(settingsRepository, userId) {
  const lista = await settingsRepository.getValue(CHAVE, null);
  if (!Array.isArray(lista)) return false;
  return lista.map(Number).includes(Number(userId));
}

// Os dois lugares onde o afiliado divulga. O primeiro é o link padrão, que
// todo afiliado já tem; o segundo é o que a funcionalidade nova permite criar.
// A bio recebe mais tráfego porque está sempre visível; a página de vendas
// converte mais, mas é vista por menos gente.
const LINKS_DEMO = [
  { label: 'Link da bio', isDefault: true, peso: 0.65 },
  { label: 'Link da página de vendas', isDefault: false, peso: 0.35 },
];

const PLANOS_DEMO = [
  { chave: 'starter', nome: 'Starter', precoCents: 9990, peso: 0.4 },
  { chave: 'pro', nome: 'Pro', precoCents: 15990, peso: 0.4 },
  { chave: 'max', nome: 'Max', precoCents: 22990, peso: 0.2 },
];

// Nomes de negócio para os indicados. Ciclam com um sufixo quando a simulação
// gera mais gente do que a lista tem - só os ~20 mais recentes aparecem na
// tela, o resto existe apenas nas contagens.
const NOMES = [
  'Cortes do Léo', 'Studio Vertical', 'Canal Sem Roteiro', 'Aline Podcasts', 'Mateus Gameplay',
  'Doce Rotina', 'Bruno Fitness', 'Rota 77 Viagens', 'Papo de Obra', 'Nayara Makes',
  'Kombi Food', 'Tiago Investe', 'Clipes da Ana', 'Oficina do Zé', 'Marcela Idiomas',
  'Império dos Games', 'Casa & Cia Reformas', 'Dr. Financeiro', 'Pedal Livre', 'Cozinha da Vovó',
  'Rafa Skate', 'Universo Pet', 'Camila Decor', 'Só Notícia Boa', 'Bastidores FC',
  'Mundo Maker', 'Vida de Autônomo', 'Trilha Sonora', 'Bel Fotografia', 'Zona de Treino',
  'Sabor Caseiro', 'Giro Automotivo', 'Mente Sã', 'História do Brasil', 'Loja do Seu João',
  'Palco Aberto', 'Rota Cervejeira', 'Dicas da Sil', 'Motolog', 'Papo Reto Tech',
  'Vitrine Fitness', 'Chá das Cinco', 'Segunda Chance', 'Barbearia do Tico', 'Lu Organiza',
  'Canal do Pescador', 'Astro Curioso', 'Mão na Massa', 'Pedra Noventa', 'Bora Correr',
  'Diário da Roça', 'Nutri em Casa', 'Estúdio 42', 'Jogo Rápido', 'Fala, Professor',
  'Doce & Sal', 'Truque de Marceneiro', 'Viver Fora', 'Retrô Mania', 'Clube da Leitura',
  'Serra Acima', 'Beleza sem Filtro', 'Papo de Mãe', 'Guia do Calouro', 'Mecânica Fácil',
  'Sertão Digital', 'Voz do Bairro', 'Conta Comigo', 'Ateliê da Lê', 'Rodas & Trilhas',
  'Boteco do Zeca', 'Cria da Quebrada', 'Vitrine Pet', 'Manhã Produtiva', 'Bicho do Mato',
  'Feira Livre', 'Sala de Aula', 'Clima Tenso', 'Doutor Games', 'Costura na Prática',
  'Praia & Sol', 'Guitarra em Casa', 'Bicho Solto', 'Copa do Bairro', 'Vida de Freela',
  'Mar Aberto', 'Café com Código', 'Reforma Já', 'Mundo Fitness', 'Sabores do Norte',
];

function nomeDoIndicado(i) {
  const base = NOMES[i % NOMES.length];
  const volta = Math.floor(i / NOMES.length);
  return volta === 0 ? base : `${base} ${volta + 1}`;
}

// Escolhe um item por peso, com um sorteio determinístico.
function porPeso(itens, sorteio) {
  let acumulado = 0;
  for (const item of itens) {
    acumulado += item.peso;
    if (sorteio <= acumulado) return item;
  }
  return itens[itens.length - 1];
}

// Cliques dia a dia. Fim de semana rende menos e há picos esporádicos (o vídeo
// que viralizou) - uma reta perfeita seria a primeira coisa a denunciar que o
// número é inventado.
function cliquesPorDia(semente, agora, dias = DIAS_DE_HISTORICO) {
  const rnd = gerador(semente);
  const serie = [];
  for (let i = dias; i >= 0; i--) {
    const dia = diasAtras(i, agora);
    const fds = dia.getDay() === 0 || dia.getDay() === 6;
    const base = fds ? 2 : 4;
    const pico = rnd() < 0.05 ? Math.floor(rnd() * 16) : 0;
    serie.push({ dia, clicks: base + Math.floor(rnd() * 4) + pico });
  }
  return serie;
}

// O coração da demonstração: transforma a série de cliques numa base de
// indicados, aplicando as três taxas.
//
// Os cadastros são espalhados PROPORCIONALMENTE aos cliques (um cadastro a
// cada N cliques acumulados), então o dia que teve pico traz mais gente - e
// não uma distribuição uniforme, que não teria relação nenhuma com o gráfico
// logo acima na tela.
function simularBase(semente, agora) {
  const serie = cliquesPorDia(semente, agora);
  const totalCliques = serie.reduce((s, p) => s + p.clicks, 0);

  const quantosCadastros = Math.max(1, Math.round(totalCliques * CLIQUE_VIRA_CADASTRO));
  const quantosAssinantes = Math.max(1, Math.round(totalCliques * CLIQUE_VIRA_ASSINATURA));
  const cliquesPorCadastro = totalCliques / quantosCadastros;
  // A cada quantos cadastros um assina - espalha os assinantes pela lista
  // inteira em vez de concentrá-los no começo.
  const passoDeAssinatura = quantosCadastros / quantosAssinantes;

  // Um gerador POR DECISÃO, cada um com semente própria. Com um só, o número
  // de sorteios gastos numa decisão desloca a fase da seguinte: o loop de
  // churn consome uma quantidade variável, e a inadimplência logo depois dele
  // saía com o triplo da taxa configurada (6% virando 22% na medição). Cada
  // taxa precisa ser independente das outras para valer o que diz valer.
  const sorteioDeLink = gerador(semente + 977);
  const sorteioDePlano = gerador(semente + 4211);
  const sorteioDeChurn = gerador(semente + 8123);
  const sorteioDeAtraso = gerador(semente + 15497);
  const indicados = [];
  let acumulado = 0;
  let proximoCadastro = cliquesPorCadastro;

  for (const ponto of serie) {
    acumulado += ponto.clicks;
    while (acumulado >= proximoCadastro && indicados.length < quantosCadastros) {
      const i = indicados.length;
      const link = porPeso(LINKS_DEMO.map((l, idx) => ({ ...l, idx })), sorteioDeLink());
      const assina = Math.floor(i / passoDeAssinatura) !== Math.floor((i + 1) / passoDeAssinatura);
      indicados.push({
        nome: nomeDoIndicado(i),
        entrada: new Date(ponto.dia),
        link: link.idx,
        plano: assina ? porPeso(PLANOS_DEMO, sorteioDePlano()) : null,
      });
      proximoCadastro += cliquesPorCadastro;
    }
  }

  // Churn: cada assinante tem CHURN_MENSAL de chance de cancelar em cada mês
  // que passou desde a assinatura. `mesesPagos` fica gravado porque é ele que
  // decide quantas mensalidades aquele indicado chegou a gerar.
  for (const ind of indicados) {
    if (!ind.plano) {
      ind.status = 'sem_plano';
      continue;
    }
    const mesesDeVida = mesesEntre(ind.entrada, agora);
    let cancelouNoMes = null;
    for (let m = 1; m <= mesesDeVida; m++) {
      if (sorteioDeChurn() < CHURN_MENSAL) {
        cancelouNoMes = m;
        break;
      }
    }
    if (cancelouNoMes !== null) {
      ind.status = 'cancelado';
      ind.mesesPagos = cancelouNoMes;
    } else {
      // Um em cada poucos ativos está com a mensalidade atrasada - existe na
      // vida real e a tela tem um cartão para isso.
      ind.status = sorteioDeAtraso() < TAXA_DE_ATRASO ? 'inadimplente' : 'ativo';
      if (ind.status === 'inadimplente') ind.mesesPagos = Math.max(1, mesesDeVida);
    }
  }

  // Garante movimento HOJE. O padrão dos dashboards é "hoje": sem uma venda e
  // uma recorrência caindo hoje, o painel abre com todos os cartões de dinheiro
  // zerados e parece um sistema parado - o oposto do que a demonstração existe
  // para mostrar.
  const ativos = indicados.filter((i) => i.status === 'ativo');
  if (ativos.length >= 2) {
    // O mais novo passa a ter assinado hoje (vira a "venda nova" do dia)...
    ativos[ativos.length - 1].entrada = new Date(agora);
    // ...e um antigo passa a fazer aniversário hoje (vira a "recorrência").
    const antigo = ativos[0];
    antigo.entrada = mesesDepois(new Date(agora), -Math.max(1, mesesEntre(antigo.entrada, agora)));
  }

  return { serie, indicados, totalCliques };
}

// A comissão de cada indicado, mês a mês, do jeito que ela nasceria de
// verdade: uma "primeira" na assinatura e uma "recorrencia" por mês seguinte,
// parando no teto de meses configurado, no cancelamento, ou em hoje.
function lancamentosDe(indicado, { percentFirst, percentRecurring, maxMonths, agora }) {
  if (!indicado.plano) return [];
  const teto = maxMonths && maxMonths > 0 ? maxMonths : 24;

  let meses = 1 + mesesEntre(indicado.entrada, agora);
  if (indicado.mesesPagos) meses = Math.min(meses, indicado.mesesPagos);
  meses = Math.min(meses, teto);

  const lancamentos = [];
  for (let i = 0; i < meses; i++) {
    const kind = i === 0 ? 'primeira' : 'recorrencia';
    const percent = kind === 'primeira' ? percentFirst : percentRecurring;
    lancamentos.push({
      referredBusinessName: indicado.nome,
      referredEmail: null,
      amountPaidCents: indicado.plano.precoCents,
      commissionPercent: percent,
      commissionCents: Math.round((indicado.plano.precoCents * percent) / 100),
      kind,
      createdAt: mesesDepois(indicado.entrada, i),
    });
  }
  return lancamentos;
}

function noPeriodo(data, since, until) {
  const t = new Date(data).getTime();
  if (since && t < new Date(since).getTime()) return false;
  if (until && t > new Date(until).getTime()) return false;
  return true;
}

// Recebe o painel REAL já montado e devolve uma cópia com a base de exemplo no
// lugar dos números. Os links de verdade do afiliado continuam aparecendo com
// o endereço real deles - o que muda são só os números pendurados neles. Assim
// copiar o link e testar continua funcionando.
function aplicar(painelReal, { userId, since, until, maxMonths }) {
  const agora = new Date();
  const semente = Number(userId) * 7919 + 13;
  const percentFirst = painelReal.percent.first;
  const percentRecurring = painelReal.percent.recurring;

  const { serie, indicados, totalCliques } = simularBase(semente, agora);

  // Links: os de VERDADE dele primeiro (com o endereço real, para copiar e
  // testar continuar funcionando), completando com os do exemplo. Os
  // secundários entram na ordem em que foram criados, para um link novo não
  // empurrar os outros de posição.
  const reais = painelReal.links.filter((l) => !l.archivedAt);
  const padraoReal = reais.find((l) => l.isDefault);
  const secundariosReais = reais
    .filter((l) => !l.isDefault)
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

  // Rótulo do exemplo que o afiliado já usa de verdade não é emprestado de
  // novo: dois links com o mesmo nome na tela é o mesmo que nenhum nome.
  const rotulosEmUso = new Set(reais.map((l) => (l.label || '').trim().toLowerCase()).filter(Boolean));
  const rotulosLivres = LINKS_DEMO.map((m) => m.label).filter((l) => l && !rotulosEmUso.has(l.toLowerCase()));

  const slots = LINKS_DEMO.map((modelo, i) => {
    const real = i === 0 ? padraoReal : secundariosReais[i - 1];
    return {
      real,
      peso: modelo.peso,
      isDefault: modelo.isDefault,
      label: real && real.label ? real.label : rotulosLivres.shift() || modelo.label,
      indice: i,
    };
  });
  // Links reais além dos do exemplo aparecem também, com pouco movimento:
  // esconder um link que a pessoa acabou de criar seria pior que mostrá-lo com
  // número baixo.
  for (const extra of secundariosReais.slice(LINKS_DEMO.length - 1)) {
    slots.push({ real: extra, peso: 0.03, isDefault: false, label: extra.label, indice: -1 });
  }
  const pesoTotal = slots.reduce((s2, l) => s2 + l.peso, 0);

  const seriePeriodo = serie.filter((p) => noPeriodo(p.dia, since, until));
  const cliquesPeriodo = seriePeriodo.reduce((s, p) => s + p.clicks, 0);

  const lancamentos = indicados
    .flatMap((ind) => lancamentosDe(ind, { percentFirst, percentRecurring, maxMonths, agora }))
    .sort((a, b) => b.createdAt - a.createdAt);

  const doPeriodo = lancamentos.filter((l) => noPeriodo(l.createdAt, since, until));
  const soma = (lista, campo) => lista.reduce((s, l) => s + l[campo], 0);
  const primeirasPeriodo = doPeriodo.filter((l) => l.kind === 'primeira');
  const recorrentesPeriodo = doPeriodo.filter((l) => l.kind === 'recorrencia');

  const ativos = indicados.filter((i) => i.status === 'ativo');
  const mrrBaseCents = ativos.reduce((s, i) => s + i.plano.precoCents, 0);

  const totalGanhoCents = soma(lancamentos, 'commissionCents');
  const sacadoCents = Math.round(totalGanhoCents * FRACAO_JA_SACADA);
  const saques = [
    { amountCents: Math.round(sacadoCents * 0.56), diasAtras: 96 },
    { amountCents: sacadoCents - Math.round(sacadoCents * 0.56), diasAtras: 38 },
  ].filter((w) => w.amountCents > 0);

  const indicadosPeriodo = indicados.filter((i) => noPeriodo(i.entrada, since, until));

  return {
    ...painelReal,
    links: slots.map((slot) => {
      const fatia = slot.peso / pesoTotal;
      const cliquesDoLink = Math.round(cliquesPeriodo * fatia);
      const totalDoLink = Math.round(totalCliques * fatia);
      const dele = slot.indice >= 0 ? indicados.filter((ind) => ind.link === slot.indice) : [];
      const nomesDele = new Set(dele.map((ind) => ind.nome));
      return {
        id: slot.real ? slot.real.id : -(slot.indice + 1),
        code: slot.real ? slot.real.code : `DEMO${slot.indice}${String(semente % 997).padStart(3, '0')}`,
        url: slot.real ? slot.real.url : `${painelReal.link.url.split('?')[0]}?ref=DEMO${slot.indice}`,
        label: slot.label,
        isDefault: slot.isDefault,
        archivedAt: null,
        clicksTotal: totalDoLink,
        clicksPeriod: cliquesDoLink,
        // Visitante único é sempre menos que clique: parte das visitas é a
        // mesma pessoa voltando.
        visitorsPeriod: Math.round(cliquesDoLink * 0.78),
        referralCount: dele.length,
        activeCount: dele.filter((ind) => ind.status === 'ativo').length,
        commissionCents: lancamentos
          .filter((lan) => nomesDele.has(lan.referredBusinessName))
          .reduce((s2, lan) => s2 + lan.commissionCents, 0),
        createdAt: slot.real ? slot.real.createdAt : diasAtras(DIAS_DE_HISTORICO, agora),
      };
    }),
    balance: {
      availableCents: totalGanhoCents - sacadoCents,
      reservedCents: 0,
      totalEarnedCents: totalGanhoCents,
    },
    clicks: {
      period: cliquesPeriodo,
      visitorsPeriod: Math.round(cliquesPeriodo * 0.78),
      total: totalCliques,
      byDay: seriePeriodo,
    },
    referralCount: indicados.length,
    periodReferralCount: indicadosPeriodo.length,
    subscriptions: {
      active: ativos.length,
      canceled: indicados.filter((i) => i.status === 'cancelado').length,
      overdue: indicados.filter((i) => i.status === 'inadimplente').length,
      withoutPlan: indicados.filter((i) => i.status === 'sem_plano').length,
      mrrBaseCents,
      mrrCents: Math.round((mrrBaseCents * percentRecurring) / 100),
    },
    sales: {
      count: primeirasPeriodo.length,
      commissionCents: soma(primeirasPeriodo, 'commissionCents'),
      paidCents: soma(primeirasPeriodo, 'amountPaidCents'),
    },
    recurring: {
      count: recorrentesPeriodo.length,
      commissionCents: soma(recorrentesPeriodo, 'commissionCents'),
      paidCents: soma(recorrentesPeriodo, 'amountPaidCents'),
    },
    periodTotalCents: soma(doPeriodo, 'commissionCents'),
    activeSubscriptionCount: ativos.length,
    recentCommissions: doPeriodo.slice(0, 30).map((l, i) => ({
      id: -(i + 1),
      referredEmail: l.referredEmail,
      referredBusinessName: l.referredBusinessName,
      amountPaidCents: l.amountPaidCents,
      commissionPercent: l.commissionPercent,
      commissionCents: l.commissionCents,
      kind: l.kind,
      reversedAt: null,
      createdAt: l.createdAt,
    })),
    // Os 20 mais recentes, igual à consulta real (listRecentByReferrer).
    recentReferrals: [...indicados]
      .sort((a, b) => b.entrada - a.entrada)
      .slice(0, 20)
      .map((ind, i) => ({
        id: -(i + 1),
        email: null,
        businessName: ind.nome,
        subscriptionStatus: ind.status,
        planName: ind.plano ? ind.plano.nome : null,
        linkLabel: slots[ind.link] && slots[ind.link].isDefault ? null : (slots[ind.link] || {}).label || null,
        linkCode: slots[ind.link] && slots[ind.link].real ? slots[ind.link].real.code : null,
        createdAt: ind.entrada,
      })),
    recentWithdrawals: saques.map((w, i) => ({
      id: -(i + 1),
      amountCents: w.amountCents,
      status: 'pago',
      requestedAt: diasAtras(w.diasAtras, agora),
      resolvedAt: diasAtras(w.diasAtras - 2, agora),
    })),
  };
}

module.exports = {
  ehDemo,
  aplicar,
  CHAVE,
  LINKS_DEMO,
  simularBase,
  CLIQUE_VIRA_CADASTRO,
  CLIQUE_VIRA_ASSINATURA,
  CHURN_MENSAL,
};
