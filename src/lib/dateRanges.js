// Filtro de periodo compartilhado por todos os dashboards (admin e cliente):
// hoje, ontem, ultimos 7 dias, este mes, mes passado, tudo, e um intervalo
// escolhido a mao. O front manda a chave (?range=) e o backend resolve pro
// intervalo [since, until] real.
'use strict';

const RANGE_KEYS = ['today', 'yesterday', 'last7days', 'this_month', 'last_month', 'all', 'custom'];

// "Desde sempre" precisa de uma data, e nao de null, pra nao espalhar um
// "if (since)" por toda consulta que usa isto. 2020 e bem antes do projeto
// existir - qualquer registro do sistema esta depois disso.
const COMECO_DE_TUDO = new Date('2020-01-01T00:00:00.000Z');
const DEFAULT_RANGE = 'today';

// O SERVIDOR RODA EM UTC, e é isso que torna esta constante obrigatória.
//
// Antes, "hoje" era calculado com setHours(0,0,0,0), que usa o fuso do
// processo. Às 21h de Brasília o servidor já virou o dia: o filtro "Hoje"
// passava a significar "das 21h de ontem até agora" e escondia o dia inteiro
// de trabalho, enquanto "Ontem" mostrava o dia de hoje pela metade. Todo fim
// de tarde os números do painel ficavam errados, e voltavam ao normal sozinhos
// de manhã - o tipo de defeito que se atribui a "o sistema está estranho".
//
// O produto é brasileiro (cobra em real, PIX, CNPJ), então o dia do painel é o
// dia de Brasília, não o do datacenter.
const FUSO_DO_PAINEL = 'America/Sao_Paulo';

// Que dia é hoje NAQUELE fuso, independente de onde o servidor está.
function hojeNoFuso(agora = new Date()) {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: FUSO_DO_PAINEL,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(agora);
  const pega = (tipo) => Number(partes.find((p) => p.type === tipo).value);
  return { ano: pega('year'), mes: pega('month'), dia: pega('day') };
}

// Quantos minutos aquele fuso está atrás/à frente do UTC no instante dado -
// lido do próprio Intl, então horário de verão (se voltar a existir) é
// respeitado sem tabela nossa.
function offsetMinutos(instante) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: FUSO_DO_PAINEL,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instante);
  const p = (tipo) => Number(fmt.find((x) => x.type === tipo).value);
  const comoUtc = Date.UTC(p('year'), p('month') - 1, p('day'), p('hour'), p('minute'), p('second'));
  return (comoUtc - Math.floor(instante.getTime() / 1000) * 1000) / 60000;
}

// O instante exato em que começa (ou termina) um dia do calendário brasileiro.
// Calculado em dois passos porque o offset depende do próprio instante: a
// primeira conta chuta com o offset de agora e a segunda corrige usando o
// offset do dia certo (o que importa na virada do horário de verão).
function instanteNoFuso({ ano, mes, dia }, fimDoDia = false) {
  const hora = fimDoDia ? 23 : 0;
  const minuto = fimDoDia ? 59 : 0;
  const segundo = fimDoDia ? 59 : 0;
  const ms = fimDoDia ? 999 : 0;
  const chute = Date.UTC(ano, mes - 1, dia, hora, minuto, segundo, ms);
  const off = offsetMinutos(new Date(chute));
  return new Date(chute - off * 60000);
}

// Soma dias a uma data de calendário (sem hora), atravessando mês e ano.
function somarDias({ ano, mes, dia }, n) {
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  d.setUTCDate(d.getUTCDate() + n);
  return { ano: d.getUTCFullYear(), mes: d.getUTCMonth() + 1, dia: d.getUTCDate() };
}

function inicioDoDia(data) {
  return instanteNoFuso(data, false);
}

function fimDoDia(data) {
  return instanteNoFuso(data, true);
}

// custom aceita as datas em ISO (YYYY-MM-DD) vindas do front. Data invalida
// ou intervalo virado cai no padrao em vez de devolver erro: um filtro de tela
// nao pode derrubar a pagina inteira por causa de um dia digitado errado.
function partesDeIso(texto) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(texto || ''));
  if (!m) return null;
  const [, ano, mes, dia] = m.map(Number);
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;
  return { ano, mes, dia };
}

function resolveRange(rangeKey, { since: sinceBruto, until: untilBruto } = {}) {
  const key = RANGE_KEYS.includes(rangeKey) ? rangeKey : DEFAULT_RANGE;
  const hoje = hojeNoFuso();

  switch (key) {
    case 'all':
      return { range: key, since: COMECO_DE_TUDO, until: fimDoDia(hoje) };
    case 'custom': {
      const de = partesDeIso(sinceBruto);
      const ate = partesDeIso(untilBruto);
      if (!de || !ate) return resolveRange(DEFAULT_RANGE);
      const desde = inicioDoDia(de);
      const ateInstante = fimDoDia(ate);
      if (desde > ateInstante) return resolveRange(DEFAULT_RANGE);
      return { range: key, since: desde, until: ateInstante };
    }
    case 'today':
      return { range: key, since: inicioDoDia(hoje), until: fimDoDia(hoje) };
    case 'yesterday': {
      const ontem = somarDias(hoje, -1);
      return { range: key, since: inicioDoDia(ontem), until: fimDoDia(ontem) };
    }
    case 'this_month':
      return { range: key, since: inicioDoDia({ ...hoje, dia: 1 }), until: fimDoDia(hoje) };
    case 'last_month': {
      const primeiroDesteMes = { ...hoje, dia: 1 };
      const ultimoDoPassado = somarDias(primeiroDesteMes, -1);
      return {
        range: key,
        since: inicioDoDia({ ...ultimoDoPassado, dia: 1 }),
        until: fimDoDia(ultimoDoPassado),
      };
    }
    case 'last7days':
    default: {
      // Inclui hoje: "últimos 7 dias" são hoje e os seis anteriores.
      const inicio = somarDias(hoje, -6);
      return { range: key, since: inicioDoDia(inicio), until: fimDoDia(hoje) };
    }
  }
}

module.exports = { resolveRange, RANGE_KEYS, DEFAULT_RANGE, FUSO_DO_PAINEL, hojeNoFuso };
