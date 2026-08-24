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
const DEFAULT_RANGE = 'last7days';

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfDay(date) {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

// custom aceita as datas em ISO (YYYY-MM-DD) vindas do front. Data invalida
// ou intervalo virado cai no padrao em vez de devolver erro: um filtro de tela
// nao pode derrubar a pagina inteira por causa de um dia digitado errado.
function resolveRange(rangeKey, { since: sinceBruto, until: untilBruto } = {}) {
  const key = RANGE_KEYS.includes(rangeKey) ? rangeKey : DEFAULT_RANGE;
  const now = new Date();

  switch (key) {
    case 'all':
      return { range: key, since: COMECO_DE_TUDO, until: endOfDay(now) };
    case 'custom': {
      const de = new Date(sinceBruto);
      const ate = new Date(untilBruto);
      if (Number.isNaN(de.getTime()) || Number.isNaN(ate.getTime()) || de > ate) {
        return resolveRange(DEFAULT_RANGE);
      }
      return { range: key, since: startOfDay(de), until: endOfDay(ate) };
    }
    case 'today':
      return { range: key, since: startOfDay(now), until: endOfDay(now) };
    case 'yesterday': {
      const y = new Date(now);
      y.setDate(y.getDate() - 1);
      return { range: key, since: startOfDay(y), until: endOfDay(y) };
    }
    case 'this_month':
      return { range: key, since: new Date(now.getFullYear(), now.getMonth(), 1), until: endOfDay(now) };
    case 'last_month': {
      const since = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const until = new Date(now.getFullYear(), now.getMonth(), 0);
      return { range: key, since, until: endOfDay(until) };
    }
    case 'last7days':
    default: {
      const since = new Date(now);
      since.setDate(since.getDate() - 6);
      return { range: key, since: startOfDay(since), until: endOfDay(now) };
    }
  }
}

module.exports = { resolveRange, RANGE_KEYS, DEFAULT_RANGE };
