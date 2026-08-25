// Decide se uma falha no processamento de video merece nova tentativa.
//
// Igual ao erroDePostagem: classifica NO MOMENTO DA FALHA, com o objeto de
// erro em maos. A versao anterior fazia o contrario - guardava so o status e,
// mais tarde, tentava adivinhar a natureza do erro casando uma regex contra
// source_videos.error_message. Quando a mensagem tecnica saiu da tela do
// cliente (passou a ser gravada como NULL), a regex parou de casar com
// qualquer coisa e o retry automatico simplesmente deixou de existir, sem
// nenhum sinal de que tinha parado.
'use strict';

// Nao adianta repetir: o proximo download daria o mesmo resultado, ou o
// problema exige alguem resolver algo fora do sistema.
const SINAIS_PERMANENTES = [
  // Conta da OpenAI sem saldo, chave invalida.
  'no credits remaining',
  'insufficient_quota',
  'invalid_api_key',
  'incorrect api key',
  // Video que nao da pra baixar por natureza, nao por azar.
  'private video',
  'video unavailable',
  'members-only',
  'this live event will begin',
  'is not available in your country',
  'removed by the uploader',
  'age-restricted',
  // Nosso proprio erro de logica: repetir so gasta.
  'nao encontrada',
  'transcricao vazia',
];

// Rede, bloqueio momentaneo do YouTube, sobrecarga. Tentar de novo daqui a
// pouco costuma resolver sozinho.
const SINAIS_PASSAGEIROS = [
  'the page needs to be reloaded',
  'sign in to confirm',
  'unable to download',
  'unable to extract',
  'http error 429',
  'http error 5',
  'proxy',
  'tunnel',
  'timeout',
  'timed out',
  'econnreset',
  'econnrefused',
  'etimedout',
  'enotfound',
  'eai_again',
  'socket hang up',
  'network',
  'fetch failed',
  'temporarily',
  'try again',
  '407',
  '502',
  '503',
  '504',
];

const MAX_TENTATIVAS = 3;

/**
 * @returns {boolean} true quando vale reprocessar sozinho.
 *
 * Erro DESCONHECIDO conta como permanente aqui - ao contrario da postagem.
 * A diferenca e o custo: reprocessar um video refaz download, transcricao e
 * render, e repetir um erro de verdade 3 vezes gasta dinheiro de API a cada
 * volta. Na postagem, repetir custa quase nada. Quando a duvida custa caro, a
 * escolha segura e parar e mostrar o erro.
 */
function ehPassageiro(erro) {
  const texto = String(erro?.message || erro || '').toLowerCase();
  if (!texto) return false;
  for (const sinal of SINAIS_PERMANENTES) {
    if (texto.includes(sinal)) return false;
  }
  for (const sinal of SINAIS_PASSAGEIROS) {
    if (texto.includes(sinal)) return true;
  }
  return false;
}

module.exports = { ehPassageiro, MAX_TENTATIVAS };
