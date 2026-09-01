// "Esse video ja existe como ARQUIVO pra baixar, ou so como pagina?"
//
// Nasceu de uma falha real (27/08/2026, conta risestyle43@gmail.com): o canal
// publicou uma ESTREIA marcada pra dali a ~1h. Pro YouTube ela ja e um video
// (aparece na aba /videos, tem pagina, tem titulo), entao a checagem de canal
// cadastrou e mandou processar na hora. O yt-dlp recusou com
// "Premieres in 58 minutes", o video virou erro permanente, e - o pior - o
// marco d'agua do canal avancou por cima dele: quando a estreia foi ao ar de
// verdade, ninguem mais olhou pra ela. O video foi perdido em silencio.
//
// O yt-dlp ja diz isso de graca no campo `live_status`, tanto na listagem do
// canal quanto na consulta individual. So faltava alguem olhar.
'use strict';

// live_status que significa "tem pagina, nao tem arquivo (ainda)".
const AINDA_SEM_ARQUIVO = new Set([
  // Estreia ou transmissao marcada que ainda nao foi ao ar.
  'is_upcoming',
  // Transmissao acontecendo AGORA. Baixar aqui e pior do que falhar: o yt-dlp
  // ficaria gravando ao vivo ate estourar o tempo limite, gastando banda paga.
  'is_live',
  // Acabou de terminar e o YouTube ainda esta montando a gravacao. O download
  // ate funciona as vezes, mas sai truncado - corte de video pela metade e
  // pior que esperar 20 minutos pela proxima checagem.
  'post_live',
]);

// `availability` que significa "tem pagina, mas nao e SEU pra baixar (ainda)".
//
// Caso real (01/09/2026, canal "Manual do Mundo"): video exclusivo de membros.
// Pro sistema ele chegava como um video normal - a listagem nao traz
// live_status nenhum - e so o download falhava, com "Join this channel to get
// access to members-only content". Virava erro permanente num video que nao tem
// defeito nenhum, e o marco d'agua passava por cima dele.
//
// Estes valores tem uma coisa em comum com a estreia, e e por isso que moram no
// mesmo arquivo: o video PODE virar baixavel depois, sem que nada mude do nosso
// lado. Tratar como erro joga fora um video que so precisava de tempo.
const AINDA_NAO_E_PUBLICO = new Set([
  // Exclusivo de quem paga a associacao do canal.
  'subscriber_only',
  // Exige login (nossa saida nao tem conta logada).
  'needs_auth',
  // Exclusivo do YouTube Premium.
  'premium_only',
]);

/**
 * @param {string|null|undefined} liveStatus valor cru do yt-dlp.
 * @returns {boolean} true quando ja da pra baixar.
 *
 * Ausente conta como disponivel: video normal nao traz esse campo na listagem
 * do canal. Errar pro outro lado (tratar ausente como indisponivel) pararia o
 * sistema inteiro se o yt-dlp mudasse o nome do campo.
 */
function podeBaixarAgora(liveStatus) {
  if (!liveStatus) return true;
  return !AINDA_SEM_ARQUIVO.has(String(liveStatus));
}

/**
 * "Esse video e publico?" - a outra metade da pergunta.
 *
 * Separada de podeBaixarAgora de proposito: as duas dizem "nao da pra baixar
 * agora", mas por motivos diferentes e com tratamentos diferentes na tela. A
 * estreia e ADIADA sem cadastrar (ela vira um video normal em minutos); o video
 * de membros e CADASTRADO com selo proprio, porque pode passar semanas assim e
 * o cliente precisa entender por que aquele video nao virou corte.
 *
 * Ausente conta como publico, pela mesma razao de sempre: video normal nao traz
 * o campo, e errar pro outro lado pararia o sistema inteiro.
 */
function ehPublico(availability) {
  if (!availability) return true;
  return !AINDA_NAO_E_PUBLICO.has(String(availability));
}

// Texto de tela pra quem esta esperando o video abrir.
function motivoDeNaoSerPublico(availability) {
  switch (String(availability)) {
    case 'subscriber_only':
      return 'esse video e exclusivo para membros do canal';
    case 'premium_only':
      return 'esse video e exclusivo do YouTube Premium';
    case 'needs_auth':
      return 'esse video exige login no YouTube para ser assistido';
    default:
      return 'esse video ainda nao esta publico';
  }
}

// Texto curto pra log e pra tela, em portugues de gente.
function motivoDaEspera(liveStatus, releaseAt) {
  const quando =
    releaseAt instanceof Date && !Number.isNaN(releaseAt.getTime())
      ? ` (previsto para ${releaseAt.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })})`
      : '';
  switch (String(liveStatus)) {
    case 'is_upcoming':
      return `esse video ainda e uma estreia/transmissao marcada${quando}`;
    case 'is_live':
      return 'esse video esta sendo transmitido ao vivo agora';
    case 'post_live':
      return 'a transmissao acabou de terminar e o YouTube ainda esta processando a gravacao';
    default:
      return 'esse video ainda nao esta disponivel para download';
  }
}

module.exports = {
  podeBaixarAgora,
  motivoDaEspera,
  AINDA_SEM_ARQUIVO,
  ehPublico,
  motivoDeNaoSerPublico,
  AINDA_NAO_E_PUBLICO,
};
