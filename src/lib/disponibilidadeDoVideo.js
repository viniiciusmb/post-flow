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

module.exports = { podeBaixarAgora, motivoDaEspera, AINDA_SEM_ARQUIVO };
