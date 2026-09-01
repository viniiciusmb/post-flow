// Garante que o canal tem uma pasta de destino no Drive que a gente CONSEGUE
// usar de verdade.
//
// O problema que isto resolve (01/09/2026): a tela pedia pro cliente colar o
// link de uma pasta do Drive dele. Isso nunca poderia funcionar desde
// 02/08/2026, quando o escopo `drive.readonly` foi removido: com `drive.file`,
// o Post Flow só enxerga o que ELE MESMO criou. Uma pasta feita à mão pelo
// cliente responde 404 "File not found" — nem "sem permissão", simplesmente
// não existe do nosso ponto de vista. O link era aceito, gravado, e os cortes
// nunca chegavam lá.
//
// A saída é inverter quem cria a pasta: nós criamos, o cliente encontra ela
// pronta no Drive dele. Não precisa de escopo restrito (que custaria auditoria
// de segurança paga todo ano), não precisa do seletor do Google, e o cliente
// pode mover ou renomear a pasta depois — o acesso é pelo id, que não muda.
'use strict';

const driveFoldersRepository = require('../repositories/driveFoldersRepository');
const driveConnectionsRepository = require('../repositories/driveConnectionsRepository');
const googleService = require('./googleService');
const logger = require('../lib/logger');

// Nome da pasta no Drive do cliente. Leva o nome do canal porque um cliente com
// três canais teria três pastas, e "Post Flow" em todas seria impossível de
// distinguir na tela do Drive.
function nomeDaPasta(channel) {
  const canal = String(channel.channel_name || '').trim();
  return canal ? `Post Flow - ${canal}` : `Post Flow - canal ${channel.id}`;
}

// Devolve { id, name, webViewLink, criada } ou lança com mensagem de gente.
//
// `criada` diz se a pasta nasceu agora — a tela usa isso pra dizer "criamos a
// pasta" em vez de "já estava lá", que são coisas diferentes pra quem vai
// procurar no Drive.
async function garantirPasta(channel, connection) {
  const accessToken = await driveConnectionsRepository.getValidAccessToken(googleService, connection);
  if (!accessToken) {
    throw new Error('A conexão com o Google Drive não está mais válida. Reconecte em Configurações.');
  }

  const atual = await driveFoldersRepository.findExportFolderByChannelId(channel.id);

  // Já existe uma pasta gravada. Confere se ela ainda é utilizável ANTES de
  // reaproveitar: pasta apagada pelo cliente, ou pasta antiga cadastrada por
  // link (que nunca foi acessível), devolvem null aqui e viram uma pasta nova.
  // Sem essa conferência, o cliente continuaria com uma configuração que a tela
  // mostra como pronta e que nunca entrega arquivo nenhum.
  if (atual) {
    const viva = await googleService.getFolder(accessToken, atual.drive_folder_id);
    if (viva) return { ...viva, criada: false };
    logger.info(
      `Canal ${channel.id}: a pasta de destino ${atual.drive_folder_id} não é acessível ` +
        `(apagada, ou cadastrada por link antes de 01/09/2026) - criando uma nova.`
    );
  }

  const nova = await googleService.createFolder(accessToken, nomeDaPasta(channel));
  await driveFoldersRepository.upsertChannelExportFolder({
    youtubeChannelId: channel.id,
    driveFolderId: nova.id,
    folderName: nova.name,
    connectionId: connection.id,
  });
  return { ...nova, criada: true };
}

module.exports = { garantirPasta, nomeDaPasta };
