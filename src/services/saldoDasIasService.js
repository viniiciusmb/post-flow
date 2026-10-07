// Saldo de cada conta de IA, pra tela de Custos avisar ANTES de acabar.
//
// Saldo acabado nao da erro na tela de ninguem: o video simplesmente falha (ou,
// na transcricao, cai pro provedor de reserva, que e mais caro). Foi assim que
// a conta da OpenAI zerou em 21/08/2026 e ninguem percebeu por dias.
//
// Dois tipos de numero, e a tela diz qual e qual:
//   - REAL: a DeepInfra informa o saldo pela API.
//   - ESTIMADO: OpenAI e Anthropic NAO informam saldo com a chave que o sistema
//     usa (so com chave de administrador da organizacao, que nao vale o
//     risco). O admin informa o saldo quando recarrega, e daqui pra frente o
//     sistema desconta o que ele mesmo gastou (tabela ai_gastos). Se a mesma
//     conta for usada por outro sistema, o saldo real e MENOR que o estimado.
//   - A Groq e usada no plano gratuito: nao tem saldo.
'use strict';

const config = require('../config');
const logger = require('../lib/logger');
const settingsRepository = require('../repositories/settingsRepository');
const gastoDeIa = require('./gastoDeIaService');

// Abaixo disso a tela pinta de vermelho (pedido do fundador, 07/10/2026).
const LIMITE_ALERTA_USD = 5;
const CHAVE_INFORMADO = 'saldo_ia_informado';
const PROVEDORES_ESTIMADOS = ['openai', 'anthropic', 'elevenlabs'];
const CACHE_MS = 5 * 60 * 1000;
const TIMEOUT_MS = 10_000;

const NOMES = {
  deepinfra: 'DeepInfra',
  groq: 'Groq',
  openai: 'OpenAI',
  anthropic: 'Anthropic (Claude)',
  elevenlabs: 'ElevenLabs',
};

const USOS = {
  deepinfra: 'Transcrição de todos os vídeos e lives (principal)',
  groq: 'Transcrição — reserva gratuita',
  openai: 'IA das lives, voz e imagens do vídeo narrado, reserva da transcrição',
  anthropic: 'Escolha dos cortes e títulos, roteiro do narrado, Flora',
  elevenlabs: 'Voz do vídeo narrado (opcional)',
};

const cache = new Map();

async function comCache(chave, fn, forcar) {
  const item = cache.get(chave);
  if (!forcar && item && Date.now() - item.em < CACHE_MS) return item.valor;
  const valor = await fn();
  cache.set(chave, { em: Date.now(), valor });
  return valor;
}

async function getJson(url, chave) {
  const r = await fetch(url, { headers: { Authorization: `Bearer ${chave}` }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  const dados = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${r.status}`);
  return dados;
}

// "2026.10". Consulta o mes passado E o atual: o consumo do mes anterior pode
// ainda nao ter sido faturado (descontado do credito) no comeco do mes. Sem o
// "to", a API devolve um mes so.
function periodo(mesesAtras = 0, agora = new Date()) {
  const d = new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth() - mesesAtras, 1));
  return `${d.getUTCFullYear()}.${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

// O credito da DeepInfra (stripe_balance negativo = credito a favor) so baixa
// quando o mes e faturado. Ate la, o consumo fica em /payment/usage num mes
// sem fatura ("invoice_id" vazio ou "INVALID"). Saldo de verdade = credito
// menos o que ja foi usado e ainda nao faturado.
function calcularSaldoDeepinfra(checklist, uso) {
  const credito = -Number(checklist.stripe_balance || 0);
  const naoFaturadoCentavos = (uso.months || [])
    .filter((m) => !m.invoice_id || m.invoice_id === 'INVALID')
    .reduce((s, m) => s + (Number(m.total_cost) || 0), 0);
  return {
    saldoUsd: credito - naoFaturadoCentavos / 100,
    suspenso: Boolean(checklist.suspended),
  };
}

async function saldoDeepinfra(forcar) {
  const base = { provedor: 'deepinfra', nome: NOMES.deepinfra, uso: USOS.deepinfra, tipo: 'real' };
  if (!config.deepinfra.apiKey) return { ...base, configurado: false };
  try {
    return await comCache(
      'deepinfra',
      async () => {
        const [checklist, uso] = await Promise.all([
          getJson('https://api.deepinfra.com/payment/checklist', config.deepinfra.apiKey),
          getJson(`https://api.deepinfra.com/payment/usage?from=${periodo(1)}&to=${periodo(0)}`, config.deepinfra.apiKey),
        ]);
        return { ...base, configurado: true, ...calcularSaldoDeepinfra(checklist, uso), consultadoEm: new Date().toISOString() };
      },
      forcar
    );
  } catch (err) {
    logger.warn(`Saldo da DeepInfra: nao consegui consultar (${err.message}).`);
    return { ...base, configurado: true, saldoUsd: null, erro: 'Não consegui consultar a DeepInfra agora.' };
  }
}

async function statusGroq(forcar) {
  const base = { provedor: 'groq', nome: NOMES.groq, uso: USOS.groq, tipo: 'gratuito', saldoUsd: null };
  if (!config.groq.apiKey) return { ...base, configurado: false };
  try {
    return await comCache(
      'groq',
      async () => {
        await getJson('https://api.groq.com/openai/v1/models', config.groq.apiKey);
        return { ...base, configurado: true, chaveOk: true };
      },
      forcar
    );
  } catch (err) {
    return { ...base, configurado: true, chaveOk: false, erro: `A Groq recusou a chave (${err.message}).` };
  }
}

async function saldoEstimado(provedor, informados) {
  const base = { provedor, nome: NOMES[provedor], uso: USOS[provedor], tipo: 'estimado' };
  const chave = config[provedor]?.apiKey;
  if (!chave) return { ...base, configurado: false };
  const informado = informados?.[provedor];
  if (!informado || !Number.isFinite(Number(informado.usd)) || !informado.em) {
    return { ...base, configurado: true, saldoUsd: null, semInformacao: true };
  }
  const gastoDesde = await gastoDeIa.totalDesde(provedor, informado.em);
  return {
    ...base,
    configurado: true,
    saldoUsd: Number(informado.usd) - gastoDesde,
    informadoUsd: Number(informado.usd),
    informadoEm: informado.em,
    gastoDesdeUsd: gastoDesde,
  };
}

async function listar({ forcar = false } = {}) {
  const informados = (await settingsRepository.getValue(CHAVE_INFORMADO, {})) || {};
  const [deepinfra, groq, ...estimados] = await Promise.all([
    saldoDeepinfra(forcar),
    statusGroq(forcar),
    ...PROVEDORES_ESTIMADOS.map((p) => saldoEstimado(p, informados)),
  ]);
  const gastos30 = await gastoDeIa.porProvedorNosUltimosDias(30);
  const provedores = [deepinfra, groq, ...estimados]
    // ElevenLabs e opcional: so aparece se a chave existir.
    .filter((p) => p.configurado || p.provedor !== 'elevenlabs')
    .map((p) => {
      const gasto30dUsd = gastos30.get(p.provedor) || 0;
      const porDia = gasto30dUsd / 30;
      return {
        ...p,
        gasto30dUsd,
        // "No ritmo atual dura N dias" - so faz sentido com saldo e consumo.
        diasRestantes: p.saldoUsd !== null && p.saldoUsd !== undefined && porDia > 0 ? Math.max(0, p.saldoUsd / porDia) : null,
        abaixoDoLimite:
          Boolean(p.configurado) &&
          ((typeof p.saldoUsd === 'number' && p.saldoUsd < LIMITE_ALERTA_USD) || Boolean(p.suspenso)),
      };
    });
  return {
    limiteAlertaUsd: LIMITE_ALERTA_USD,
    provedores,
    algumAbaixo: provedores.some((p) => p.abaixoDoLimite),
  };
}

// O admin informa o saldo que ve no painel do provedor (normalmente logo
// depois de recarregar). A partir dai o sistema desconta o proprio gasto.
async function informarSaldo(provedor, usd) {
  if (!PROVEDORES_ESTIMADOS.includes(provedor)) {
    const e = new Error('Esse provedor informa o saldo sozinho ou não tem saldo.');
    e.status = 400;
    throw e;
  }
  const valor = Number(usd);
  if (!Number.isFinite(valor) || valor < 0 || valor > 1_000_000) {
    const e = new Error('Informe um valor em dólar, como 20 ou 12,50.');
    e.status = 400;
    throw e;
  }
  const informados = (await settingsRepository.getValue(CHAVE_INFORMADO, {})) || {};
  informados[provedor] = { usd: valor, em: new Date().toISOString() };
  await settingsRepository.setValue(CHAVE_INFORMADO, informados);
}

module.exports = {
  listar,
  informarSaldo,
  calcularSaldoDeepinfra,
  periodo,
  LIMITE_ALERTA_USD,
  PROVEDORES_ESTIMADOS,
  _limparCache: () => cache.clear(),
};
