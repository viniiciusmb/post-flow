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
// Video que existe mas ainda nao e NOSSO pra baixar: exclusivo de membros do
// canal, do Premium, ou que exige login.
//
// Nao e erro nem coisa passageira - e um estado proprio, com selo proprio na
// tela (status 'somente_membros'). Ate 01/09/2026 'members-only' morava na
// lista de PERMANENTES e o video virava erro definitivo: o cliente via "Nao deu
// pra processar este video" num video que nao tem defeito nenhum, e o pior, o
// marco d'agua do canal passava por cima dele - quando o canal abrisse o video,
// ninguem mais olharia pra ele.
//
// O caminho principal e nem chegar aqui (o channelCheckJob ja cadastra com o
// selo, sem enfileirar). Isto e a rede de seguranca pro caso de o video virar
// exclusivo DEPOIS de ter entrado na fila.
const SINAIS_DE_SO_PARA_MEMBROS = [
  'members-only',
  'members only',
  'join this channel to get access',
  'this video is available to this channel',
];

function ehSoParaMembros(err) {
  const texto = String((err && err.message) || err || '').toLowerCase();
  return SINAIS_DE_SO_PARA_MEMBROS.some((sinal) => texto.includes(sinal));
}

const SINAIS_PERMANENTES = [
  // Conta da OpenAI sem saldo, chave invalida.
  'no credits remaining',
  'insufficient_quota',
  'invalid_api_key',
  'incorrect api key',
  // Video que nao da pra baixar por natureza, nao por azar.
  'private video',
  'video unavailable',
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
  // Estreia marcada / transmissao ao vivo que ainda nao virou arquivo. Ate
  // 27/08/2026 "this live event will begin" estava na lista de PERMANENTES,
  // o que era exatamente o contrario da verdade: esse video vai existir daqui
  // a pouco - so nao existe AGORA. Um video da conta risestyle foi perdido
  // assim. O caminho principal e nem chegar aqui (channelCheckJob adia a
  // estreia sem cadastrar), isto e a rede de seguranca pro caso de o yt-dlp
  // nao ter avisado na checagem.
  'premieres in',
  'this live event will begin',
  'this live stream recording is not available',
  'live event will begin',
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

module.exports = { ehSoParaMembros, ehPassageiro, MAX_TENTATIVAS };
