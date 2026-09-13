// Para onde os cortes de um vídeo vão: a regra de UMA só, usada por todo mundo.
//
// Existem dois caminhos e eles nunca podem discordar:
//   - o pipeline, que cria a postagem quando o corte termina de renderizar;
//   - os botões "enviar pra fila" da tela de Cortes, que o cliente aperta
//     depois, quando o corte já está pronto.
//
// Se cada um tivesse a própria conta, o botão mandaria o corte para um perfil
// diferente daquele em que ele sairia sozinho — e o cliente não teria como
// saber disso antes de o vídeo já estar publicado.
//
// A regra: vídeo de canal vai para a conta vinculada ao canal (uma só); vídeo
// avulso (upload ou link colado) vai para as contas que o cliente escolheu no
// momento do envio.
'use strict';

const youtubeChannelsRepository = require('../repositories/youtubeChannelsRepository');
const tiktokAccountsRepository = require('../repositories/tiktokAccountsRepository');
const sourceVideoTiktokTargetsRepository = require('../repositories/sourceVideoTiktokTargetsRepository');

async function contasDoVideo(sourceVideo) {
  if (sourceVideo.youtube_channel_id) {
    const channel = await youtubeChannelsRepository.findById(sourceVideo.youtube_channel_id);
    const account =
      channel && channel.tiktok_account_id ? await tiktokAccountsRepository.findById(channel.tiktok_account_id) : null;
    return account ? [account] : [];
  }

  const accountIds = await sourceVideoTiktokTargetsRepository.listBySourceVideoId(sourceVideo.id);
  return (await Promise.all(accountIds.map((id) => tiktokAccountsRepository.findById(id)))).filter(Boolean);
}

module.exports = { contasDoVideo };
