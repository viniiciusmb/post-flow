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
//   2. Tudo é DERIVADO de uma única base: uma lista de indicados (com plano,
//      status e data) gera os lançamentos, que geram os totais, o saldo e o
//      MRR. Números escritos à mão um a um se contradizem no primeiro filtro
//      de período - o total do mês não bateria com a soma do extrato.
//
// Para desligar: apague a chave affiliate_demo_user_ids em settings.

const CHAVE = 'affiliate_demo_user_ids';

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

async function ehDemo(settingsRepository, userId) {
  const lista = await settingsRepository.getValue(CHAVE, null);
  if (!Array.isArray(lista)) return false;
  return lista.map(Number).includes(Number(userId));
}

// Os quatro lugares de divulgação que o afiliado típico usa. O primeiro é o
// link padrão que ele já tem de verdade - os outros três são os que a
// funcionalidade nova permite criar.
const LINKS_DEMO = [
  { label: null, isDefault: true, peso: 0.10 },
  { label: 'Bio do TikTok', isDefault: false, peso: 0.47 },
  { label: 'Descrição do YouTube', isDefault: false, peso: 0.28 },
  { label: 'Grupo do WhatsApp', isDefault: false, peso: 0.15 },
];

// Os indicados. A data de entrada de cada um é montada como "X meses e Y dias
// atrás" em vez de um número solto de dias, e o Y é o que importa: como a
// mensalidade cai sempre no mesmo dia do mês, é o Y que decide se aquele
// indicado gera recorrência DENTRO do período que a tela está mostrando.
// Alguns com Y pequeno (pagaram nos últimos dias) e outros espalhados pelo mês
// dão um extrato que não fica vazio no filtro padrão nem parece que todo mundo
// paga no mesmo dia.
//
// A distribuição (6 assinando, 2 que cancelaram, 1 atrasado e cinco que só
// criaram conta) é o retrato normal de um programa de indicação rodando há uns
// meses - não um cenário perfeito onde todo cadastro vira cliente.
const INDICADOS_DEMO = [
  { nome: 'Cortes do Léo', plano: 'pro', precoCents: 15990, status: 'ativo', meses: 5, dias: 2, link: 1 },
  { nome: 'Studio Vertical', plano: 'max', precoCents: 22990, status: 'ativo', meses: 4, dias: 4, link: 2 },
  { nome: 'Canal Sem Roteiro', plano: 'pro', precoCents: 15990, status: 'ativo', meses: 3, dias: 6, link: 1 },
  { nome: 'Aline Podcasts', plano: 'starter', precoCents: 9990, status: 'ativo', meses: 2, dias: 11, link: 3 },
  { nome: 'Mateus Gameplay', plano: 'pro', precoCents: 15990, status: 'ativo', meses: 1, dias: 19, link: 1 },
  { nome: 'Doce Rotina', plano: 'starter', precoCents: 9990, status: 'ativo', meses: 0, dias: 3, link: 2 },
  { nome: 'Bruno Fitness', plano: 'starter', precoCents: 9990, status: 'cancelado', meses: 5, dias: 9, mesesPagos: 3, link: 1 },
  { nome: 'Rota 77 Viagens', plano: 'pro', precoCents: 15990, status: 'cancelado', meses: 4, dias: 16, mesesPagos: 2, link: 3 },
  { nome: 'Papo de Obra', plano: 'starter', precoCents: 9990, status: 'inadimplente', meses: 2, dias: 23, mesesPagos: 2, link: 2 },
  { nome: 'Nayara Makes', plano: null, status: 'sem_plano', meses: 1, dias: 27, link: 1 },
  { nome: 'Kombi Food', plano: null, status: 'sem_plano', meses: 1, dias: 13, link: 2 },
  { nome: 'Tiago Investe', plano: null, status: 'sem_plano', meses: 0, dias: 26, link: 1 },
  { nome: 'Clipes da Ana', plano: null, status: 'sem_plano', meses: 0, dias: 15, link: 3 },
  { nome: 'Oficina do Zé', plano: null, status: 'sem_plano', meses: 0, dias: 5, link: 2 },
];

// Quanto do que já foi ganho já saiu em saque. É uma FRAÇÃO do total ganho, e
// não um valor fixo: com valores cravados, um percentual de comissão baixo
// deixaria o saldo disponível NEGATIVO na tela - o afiliado teria sacado mais
// do que ganhou, que é impossível.
const FRACAO_JA_SACADA = 0.55;

// A comissão de cada indicado, mês a mês, do jeito que ela nasceria de
// verdade: uma "primeira" na assinatura e uma "recorrencia" por mês seguinte,
// parando no teto de meses configurado, no cancelamento, ou em hoje.
function entradaDe(indicado, agora) {
  return diasAtras(indicado.dias, mesesDepois(agora, -indicado.meses));
}

function lancamentosDe(indicado, { percentFirst, percentRecurring, maxMonths, agora }) {
  if (!indicado.plano) return [];
  const inicio = entradaDe(indicado, agora);
  const teto = maxMonths && maxMonths > 0 ? maxMonths : 24;

  let meses = 0;
  while (meses < teto && mesesDepois(inicio, meses) <= agora) meses += 1;
  if (indicado.mesesPagos) meses = Math.min(meses, indicado.mesesPagos);

  const lancamentos = [];
  for (let i = 0; i < meses; i++) {
    const kind = i === 0 ? 'primeira' : 'recorrencia';
    const percent = kind === 'primeira' ? percentFirst : percentRecurring;
    lancamentos.push({
      referredBusinessName: indicado.nome,
      referredEmail: null,
      amountPaidCents: indicado.precoCents,
      commissionPercent: percent,
      commissionCents: Math.round((indicado.precoCents * percent) / 100),
      kind,
      createdAt: mesesDepois(inicio, i),
    });
  }
  return lancamentos;
}

// Cliques dia a dia dos últimos 180 dias. Fim de semana rende menos e há
// picos esporádicos (o vídeo que viralizou) - uma reta perfeita seria a
// primeira coisa a denunciar que o número é inventado.
function cliquesPorDia(semente, agora, dias = 180) {
  const rnd = gerador(semente);
  const serie = [];
  for (let i = dias; i >= 0; i--) {
    const dia = diasAtras(i, agora);
    const fds = dia.getDay() === 0 || dia.getDay() === 6;
    const base = fds ? 4 : 8;
    const pico = rnd() < 0.06 ? Math.floor(rnd() * 34) : 0;
    serie.push({ dia, clicks: base + Math.floor(rnd() * 9) + pico });
  }
  return serie;
}

function noPeriodo(data, since, until) {
  const t = new Date(data).getTime();
  if (since && t < new Date(since).getTime()) return false;
  if (until && t > new Date(until).getTime()) return false;
  return true;
}

// Recebe o painel REAL já montado e devolve uma cópia com a base de exemplo no
// lugar dos números. Os links de verdade do afiliado (inclusive os que ele
// criar) continuam aparecendo com o endereço real deles - o que muda são só os
// números pendurados neles. Assim copiar o link e testar continua funcionando.
function aplicar(painelReal, { userId, since, until, maxMonths }) {
  const agora = new Date();
  const semente = Number(userId) * 7919 + 13;
  const percentFirst = painelReal.percent.first;
  const percentRecurring = painelReal.percent.recurring;

  // Links: os de VERDADE dele primeiro (com o endereço real, para copiar e
  // testar continuar funcionando), completando com os lugares de divulgação do
  // exemplo até dar quatro. O que muda são só os números pendurados neles.
  //
  // Os secundários entram na ordem em que foram criados (do mais antigo para o
  // mais novo): assim um link novo não empurra os outros de posição, e o
  // número que a pessoa viu ontem naquele link continua lá.
  const reais = painelReal.links.filter((l) => !l.archivedAt);
  const padraoReal = reais.find((l) => l.isDefault);
  const secundariosReais = reais
    .filter((l) => !l.isDefault)
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

  // Rótulo do exemplo que o afiliado já usa de verdade não é emprestado de
  // novo: dois links com o mesmo nome na tela é o mesmo que nenhum nome, já
  // que o nome existe só para dizer QUAL deles trouxe a venda.
  const rotulosEmUso = new Set(reais.map((l) => (l.label || '').trim().toLowerCase()).filter(Boolean));
  const rotulosLivres = LINKS_DEMO.map((m) => m.label).filter((l) => l && !rotulosEmUso.has(l.toLowerCase()));

  const slots = LINKS_DEMO.map((modelo, i) => {
    const real = i === 0 ? padraoReal : secundariosReais[i - 1];
    return {
      real,
      peso: modelo.peso,
      isDefault: modelo.isDefault,
      label: real && real.label ? real.label : modelo.label && rotulosLivres.shift(),
      indice: i,
    };
  });
  // Links reais além dos quatro do exemplo: aparecem também, com pouco
  // movimento. Esconder um link que a pessoa acabou de criar seria pior que
  // mostrá-lo com número baixo.
  for (const extra of secundariosReais.slice(3)) {
    slots.push({ real: extra, peso: 0.03, isDefault: false, label: extra.label, indice: -1 });
  }
  const pesoTotal = slots.reduce((s2, l) => s2 + l.peso, 0);

  const serie = cliquesPorDia(semente, agora);
  const seriePeriodo = serie.filter((p) => noPeriodo(p.dia, since, until));
  const cliquesPeriodo = seriePeriodo.reduce((s, p) => s + p.clicks, 0);
  const cliquesTotal = serie.reduce((s, p) => s + p.clicks, 0);

  const lancamentos = INDICADOS_DEMO.flatMap((ind) =>
    lancamentosDe(ind, { percentFirst, percentRecurring, maxMonths, agora })
  ).sort((a, b) => b.createdAt - a.createdAt);

  const doPeriodo = lancamentos.filter((l) => noPeriodo(l.createdAt, since, until));
  const soma = (lista, campo) => lista.reduce((s, l) => s + l[campo], 0);
  const primeirasPeriodo = doPeriodo.filter((l) => l.kind === 'primeira');
  const recorrentesPeriodo = doPeriodo.filter((l) => l.kind === 'recorrencia');

  const ativos = INDICADOS_DEMO.filter((i) => i.status === 'ativo');
  const mrrBaseCents = ativos.reduce((s, i) => s + i.precoCents, 0);

  const totalGanhoCents = soma(lancamentos, 'commissionCents');
  // Dois saques já pagos, somando a fração combinada do total ganho. Derivados
  // do ganho para o saldo disponível nunca ficar negativo.
  const sacadoCents = Math.round(totalGanhoCents * FRACAO_JA_SACADA);
  const saques = [
    { amountCents: Math.round(sacadoCents * 0.56), diasAtras: 96 },
    { amountCents: sacadoCents - Math.round(sacadoCents * 0.56), diasAtras: 38 },
  ].filter((w) => w.amountCents > 0);

  const indicadosPeriodo = INDICADOS_DEMO.filter((i) => noPeriodo(entradaDe(i, agora), since, until));

  return {
    ...painelReal,
    links: slots.map((slot) => {
      const fatia = slot.peso / pesoTotal;
      const cliquesDoLink = Math.round(cliquesPeriodo * fatia);
      const totalDoLink = Math.round(cliquesTotal * fatia);
      const indicados = slot.indice >= 0 ? INDICADOS_DEMO.filter((ind) => ind.link === slot.indice) : [];
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
        referralCount: indicados.length,
        activeCount: indicados.filter((ind) => ind.status === 'ativo').length,
        commissionCents: lancamentos
          .filter((lan) => indicados.some((ind) => ind.nome === lan.referredBusinessName))
          .reduce((s2, lan) => s2 + lan.commissionCents, 0),
        createdAt: slot.real ? slot.real.createdAt : diasAtras(180, agora),
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
      total: cliquesTotal,
      byDay: seriePeriodo,
    },
    referralCount: INDICADOS_DEMO.length,
    periodReferralCount: indicadosPeriodo.length,
    subscriptions: {
      active: ativos.length,
      canceled: INDICADOS_DEMO.filter((i) => i.status === 'cancelado').length,
      overdue: INDICADOS_DEMO.filter((i) => i.status === 'inadimplente').length,
      withoutPlan: INDICADOS_DEMO.filter((i) => i.status === 'sem_plano').length,
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
      createdAt: l.createdAt,
    })),
    recentReferrals: [...INDICADOS_DEMO]
      .sort((a, b) => entradaDe(b, agora) - entradaDe(a, agora))
      .map((ind, i) => ({
        id: -(i + 1),
        email: null,
        businessName: ind.nome,
        subscriptionStatus: ind.status,
        planName: ind.plano ? ind.plano[0].toUpperCase() + ind.plano.slice(1) : null,
        linkLabel: LINKS_DEMO[ind.link].isDefault ? null : slots[ind.link].label,
        linkCode: slots[ind.link].real ? slots[ind.link].real.code : null,
        createdAt: entradaDe(ind, agora),
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

module.exports = { ehDemo, aplicar, CHAVE, INDICADOS_DEMO, LINKS_DEMO, entradaDe };
