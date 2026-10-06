// Qual modelo responde cada mensagem do suporte.
//
// Pedido do fundador (06/10/2026): nao usar o modelo mais caro pra responder
// "quando minha cota renova?". A escolha e uma regra fixa, sem chamada extra
// de IA so pra decidir (isso custaria em toda mensagem o que se quer economizar):
//
//   nivel 0 - Haiku:  duvida de uso, pergunta simples. Le o manual e responde.
//   nivel 1 - Sonnet: ha um problema pra investigar (video que falhou,
//                     creditos que sumiram, postagem parada).
//   nivel 2 - Opus:   o cliente diz que nao resolveu. Sobe um degrau por vez:
//                     quem estava no Haiku vai pro Sonnet, quem estava no
//                     Sonnet vai pro Opus.
//
// Dentro de uma conversa sobre um problema o nivel nao desce: um "sim, pode
// enviar" no meio de uma investigacao continua com o modelo que investigou.
// Conversa nova recomeca do zero.
//
// Seguranca nao depende do modelo: o que cada um pode fazer e decidido pelo
// servidor (ver reembolsoDeCreditoService), entao o Haiku nao consegue fazer
// nada que o Opus nao faria.
'use strict';

const NIVEIS = [
  { nivel: 0, modelo: 'claude-haiku-4-5', preco: { entrada: 1, saida: 5, cacheLeitura: 0.1, cacheEscrita: 1.25 } },
  { nivel: 1, modelo: 'claude-sonnet-5-5', preco: { entrada: 2, saida: 10, cacheLeitura: 0.2, cacheEscrita: 2.5 } },
  { nivel: 2, modelo: 'claude-opus-5-5', preco: { entrada: 4, saida: 20, cacheLeitura: 0.2, cacheEscrita: 5 } },
];

function semAcento(texto) {
  return String(texto || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

// Sinais de que ha um PROBLEMA a investigar, nao so uma duvida.
const PROBLEMA = [
  /\bnao (foi|esta|estao|ta|tava|apareceu|aparece|processou|processa|postou|posta|publicou|publica|cortou|corta|funciona|funcionou|baixou|carrega|entrou|saiu|chegou|veio)\b/,
  /\berr(o|ou|ado)\b/, /\bfalh/, /\bsumi/, /\bdevolv/, /\breembols/, /\bestorn/, /\bcobr/, /\bdescont/,
  /\bgast(ou|aram|ei)\b/, /\btravad/, /\bparad[oa]\b/, /\bbug/, /\bproblema/, /\bperdi\b/, /\bdesaparec/,
  /\bdidn'?t\b/, /\bnot (working|processed|posted)\b/, /\bmissing\b/, /\brefund/, /\bno (se|fue)\b/,
];

// Sinais de que a resposta anterior NAO resolveu.
const INSATISFEITO = [
  /\bainda (nao|continua|esta|ta)\b/, /\bcontinua\b/,
  // "de novo" sozinho nao: "pode processar de novo" e o cliente concordando.
  /\b(deu|falhou|erro|aconteceu|travou|sumiu|parou) (de novo|novamente)\b/,
  /\bnao (resolveu|adiantou|funcionou|deu certo|entendi|e isso|ajudou)\b/, /\bpiorou\b/, /\bja (falei|disse|fiz|tentei)\b/,
  /\bmesma coisa\b/, /\bvoce (nao|errou)\b/, /\bta errado\b/, /\besta errado\b/,
  /\bstill\b/, /\bdidn'?t (help|work)\b/, /\btodavia\b/, /\bsigue\b/,
];

const corresponde = (lista, texto) => lista.some((re) => re.test(texto));

/**
 * @param {object} p
 * @param {string} p.texto              mensagem atual do cliente
 * @param {number|null} p.nivelAnterior nivel usado na resposta anterior desta conversa (null = conversa nova)
 * @returns {{ nivel: number, modelo: string, motivo: string }}
 */
function escolherModelo({ texto, nivelAnterior = null }) {
  const t = semAcento(texto);
  const anterior = Number.isInteger(nivelAnterior) ? nivelAnterior : null;
  let nivel = corresponde(PROBLEMA, t) ? 1 : 0;
  let motivo = nivel === 1 ? 'problema' : 'duvida';

  if (anterior !== null) {
    if (corresponde(INSATISFEITO, t)) {
      nivel = Math.max(nivel, Math.min(2, anterior + 1));
      motivo = 'nao_resolveu';
    } else if (anterior > nivel) {
      nivel = anterior;
      motivo = 'mesma_investigacao';
    }
  }
  return { nivel, modelo: NIVEIS[nivel].modelo, motivo };
}

function dadosDoNivel(nivel) {
  return NIVEIS[Math.max(0, Math.min(NIVEIS.length - 1, nivel))];
}

function nivelDoModelo(modelo) {
  const n = NIVEIS.find((x) => x.modelo === modelo);
  return n ? n.nivel : null;
}

module.exports = { escolherModelo, dadosDoNivel, nivelDoModelo, NIVEIS };
