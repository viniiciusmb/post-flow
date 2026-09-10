// O filtro de período de TODOS os dashboards (admin e cliente).
//
// O defeito que estes testes travam: o servidor roda em UTC, e o cálculo usava
// o fuso do processo. Às 21h de Brasília o servidor já virou o dia, então
// "Hoje" passava a significar "das 21h de ontem até agora" - escondendo o dia
// inteiro de trabalho - e "Ontem" mostrava o dia corrente pela metade. Todo
// fim de tarde os números do painel ficavam errados e voltavam ao normal
// sozinhos de manhã.
//
// Por isso os testes rodam contra o RELÓGIO DE VERDADE e conferem invariantes
// (o começo do período é meia-noite em São Paulo, um dia tem 24h, ontem
// termina onde hoje começa) em vez de comparar com carimbos fixos: carimbo
// fixo passaria a falhar amanhã, e o defeito só aparece em certas horas do dia.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { resolveRange, DEFAULT_RANGE, FUSO_DO_PAINEL } = require('../../src/lib/dateRanges');

// Como aquele instante é escrito no relógio de Brasília.
function emSaoPaulo(data) {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: FUSO_DO_PAINEL,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(data);
  const v = (t) => p.find((x) => x.type === t).value;
  return { data: `${v('year')}-${v('month')}-${v('day')}`, hora: `${v('hour')}:${v('minute')}:${v('second')}` };
}

const UM_DIA = 24 * 60 * 60 * 1000;

test('o padrao dos dashboards e HOJE', () => {
  assert.equal(DEFAULT_RANGE, 'today');
  assert.equal(resolveRange(undefined).range, 'today');
  assert.equal(resolveRange('chave-que-nao-existe').range, 'today');
});

test('"hoje" comeca a meia-noite de Brasilia e termina no fim do mesmo dia', () => {
  const { since, until } = resolveRange('today');
  const inicio = emSaoPaulo(since);
  const fim = emSaoPaulo(until);

  assert.equal(inicio.hora, '00:00:00', 'comeca a meia-noite de Brasilia, nao a do servidor');
  assert.equal(fim.hora, '23:59:59');
  assert.equal(inicio.data, fim.data, 'comeco e fim sao o MESMO dia do calendario brasileiro');
  assert.equal(inicio.data, emSaoPaulo(new Date()).data, 'e esse dia e o de hoje aqui');
});

test('"hoje" cobre o dia inteiro, mesmo rodando num servidor em UTC', () => {
  // Este é o teste que pega o defeito: com o cálculo antigo, das 21h à
  // meia-noite de Brasília o intervalo tinha 3 horas em vez de 24.
  const { since, until } = resolveRange('today');
  const duracao = until.getTime() - since.getTime();
  assert.ok(Math.abs(duracao - UM_DIA) < 1000, `o periodo tem que ter 24h, tem ${(duracao / 3600000).toFixed(1)}h`);
});

test('agora esta sempre dentro do periodo "hoje"', () => {
  // Parece óbvio, e era exatamente o que deixava de valer no fim da tarde.
  const { since, until } = resolveRange('today');
  const agora = Date.now();
  assert.ok(agora >= since.getTime() && agora <= until.getTime());
});

test('"ontem" termina no milissegundo anterior ao inicio de "hoje", sem buraco nem sobreposicao', () => {
  const hoje = resolveRange('today');
  const ontem = resolveRange('yesterday');

  assert.equal(ontem.until.getTime() + 1, hoje.since.getTime());
  const duracao = ontem.until.getTime() - ontem.since.getTime();
  assert.ok(Math.abs(duracao - UM_DIA) < 1000);
  assert.equal(emSaoPaulo(ontem.since).hora, '00:00:00');
});

test('"ultimos 7 dias" cobre hoje e os seis anteriores', () => {
  const { since, until } = resolveRange('last7days');
  const dias = (until.getTime() - since.getTime()) / UM_DIA;
  assert.ok(dias > 6.9 && dias < 7.1, `esperava ~7 dias, deu ${dias.toFixed(2)}`);
  assert.equal(emSaoPaulo(until).data, emSaoPaulo(new Date()).data, 'termina hoje');
  assert.equal(emSaoPaulo(since).hora, '00:00:00');
});

test('"este mes" comeca no dia 1 e vai ate o fim de hoje', () => {
  const { since, until } = resolveRange('this_month');
  assert.equal(emSaoPaulo(since).data.slice(-2), '01');
  assert.equal(emSaoPaulo(since).hora, '00:00:00');
  assert.equal(emSaoPaulo(until).data, emSaoPaulo(new Date()).data);
});

test('"mes passado" e o mes inteiro anterior, e termina onde este mes comeca', () => {
  const passado = resolveRange('last_month');
  const atual = resolveRange('this_month');

  assert.equal(emSaoPaulo(passado.since).data.slice(-2), '01');
  assert.equal(passado.until.getTime() + 1, atual.since.getTime(), 'sem buraco entre um mes e o outro');
  const dias = (passado.until.getTime() - passado.since.getTime()) / UM_DIA;
  assert.ok(dias >= 27.9 && dias <= 31.1, `mes com ${dias.toFixed(1)} dias`);
});

test('"maximo" comeca antes do projeto existir e alcanca agora', () => {
  const { since, until } = resolveRange('all');
  assert.ok(since.getFullYear() <= 2020);
  assert.ok(until.getTime() >= Date.now());
});

test('periodo personalizado usa os dias do calendario brasileiro, do primeiro ao ultimo', () => {
  const { since, until, range } = resolveRange('custom', { since: '2026-03-10', until: '2026-03-12' });
  assert.equal(range, 'custom');
  assert.equal(emSaoPaulo(since).data, '2026-03-10');
  assert.equal(emSaoPaulo(since).hora, '00:00:00');
  assert.equal(emSaoPaulo(until).data, '2026-03-12');
  assert.equal(emSaoPaulo(until).hora, '23:59:59');
});

test('personalizado com data invalida ou intervalo virado cai no padrao, sem derrubar a tela', () => {
  assert.equal(resolveRange('custom', { since: 'nao-e-data', until: '2026-03-12' }).range, 'today');
  assert.equal(resolveRange('custom', { since: '2026-03-12', until: '2026-03-10' }).range, 'today');
  assert.equal(resolveRange('custom', {}).range, 'today');
});

test('um dia so no personalizado ainda cobre 24 horas', () => {
  const { since, until } = resolveRange('custom', { since: '2026-06-15', until: '2026-06-15' });
  const duracao = until.getTime() - since.getTime();
  assert.ok(Math.abs(duracao - UM_DIA) < 1000);
});
