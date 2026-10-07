// Anota de qual conta de IA saiu cada gasto (tabela ai_gastos).
//
// Chamado por cada servico no momento em que a API responde. Nunca lanca e
// nunca e esperado por quem chama: anotar o gasto e contabilidade, e perder a
// anotacao e muito menos grave do que travar um video ou uma resposta da Flora
// por causa dela.
'use strict';

const pool = require('../db/pool');
const logger = require('../lib/logger');

const PROVEDORES = ['deepinfra', 'groq', 'openai', 'anthropic', 'elevenlabs'];

function registrar(provedor, uso, usd, { audioSegundos = null } = {}) {
  if (!PROVEDORES.includes(provedor)) return Promise.resolve(null);
  const valor = Number(usd) || 0;
  return pool
    .query(
      'INSERT INTO ai_gastos (provedor, uso, usd, audio_segundos) VALUES ($1, $2, $3, $4)',
      [provedor, String(uso || 'outro').slice(0, 60), valor, audioSegundos === null ? null : Number(audioSegundos) || 0]
    )
    .then(() => null)
    .catch((err) => {
      logger.warn(`Nao consegui anotar o gasto de IA (${provedor}/${uso}): ${err.message}`);
      return null;
    });
}

async function totalDesde(provedor, desde) {
  const { rows } = await pool.query(
    'SELECT coalesce(sum(usd), 0)::float8 AS usd FROM ai_gastos WHERE provedor = $1 AND created_at >= $2',
    [provedor, desde]
  );
  return Number(rows[0].usd) || 0;
}

// Gasto por provedor nos ultimos N dias - mostra na tela o ritmo de consumo,
// que e o que diz se o saldo dura uma semana ou um ano.
async function porProvedorNosUltimosDias(dias = 30) {
  const { rows } = await pool.query(
    `SELECT provedor, coalesce(sum(usd), 0)::float8 AS usd
       FROM ai_gastos
      WHERE created_at >= now() - make_interval(days => $1::int)
      GROUP BY provedor`,
    [dias]
  );
  return new Map(rows.map((r) => [r.provedor, Number(r.usd) || 0]));
}

module.exports = { registrar, totalDesde, porProvedorNosUltimosDias, PROVEDORES };
