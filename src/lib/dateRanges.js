// Filtro de periodo compartilhado por todos os dashboards (admin e cliente):
// hoje, ontem, ultimos 7 dias, este mes, mes passado. O front manda a chave
// (?range=) e o backend resolve pro intervalo [since, until] real.
'use strict';

const RANGE_KEYS = ['today', 'yesterday', 'last7days', 'this_month', 'last_month'];
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

function resolveRange(rangeKey) {
  const key = RANGE_KEYS.includes(rangeKey) ? rangeKey : DEFAULT_RANGE;
  const now = new Date();

  switch (key) {
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
