// Onde mora o vídeo-fonte baixado UMA vez e reaproveitado por todos os
// clientes que monitoram o mesmo canal do YouTube.
//
// Fica numa pasta própria, fora das pastas por vídeo (workDir/<id>), por um
// motivo concreto: o sistema apaga workDir/<id> inteiro quando o cliente
// exclui um vídeo, e apaga local_video_path direto na retenção automática. Se
// o arquivo compartilhado morasse dentro da pasta de quem baixou primeiro, o
// primeiro cliente a excluir o vídeo dele levaria junto o arquivo que os
// outros ainda vão usar.
'use strict';

const path = require('path');
const config = require('../config');
const idiomaDoAudio = require('./idiomaDoAudio');

const NOME_PASTA = '_compartilhado';

function dir() {
  return path.join(config.videoProcessing.workDir, NOME_PASTA);
}

// Nome pelo ID do vídeo do YouTube MAIS o idioma do áudio (não pelo ID do
// source_video): a identidade do arquivo é "este vídeo, nesta trilha", não
// quem o pediu primeiro.
//
// O idioma entra no NOME, e não só na linha do banco, porque é o disco que
// guarda a diferença: o mesmo vídeo dublado em português e em inglês são dois
// arquivos, e um nome só faria o segundo download sobrescrever o primeiro —
// entregando o idioma errado a quem já estava usando o arquivo.
//
// 'original' fica sem sufixo, para que os arquivos que já estão em disco
// continuem sendo encontrados exatamente onde estão.
function pathFor(youtubeVideoId, ext = '.mp4', audioLanguage = idiomaDoAudio.ORIGINAL) {
  // O ID do YouTube é [a-zA-Z0-9_-]{11}, mas isso vem de fora - sanitiza
  // mesmo assim para nunca montar caminho com '..' ou barra.
  const seguro = String(youtubeVideoId).replace(/[^a-zA-Z0-9_-]/g, '');
  const codigo = idiomaDoAudio.normalizar(audioLanguage);
  const sufixo = codigo === idiomaDoAudio.ORIGINAL ? '' : `.${codigo}`;
  return path.join(dir(), `${seguro}${sufixo}${ext}`);
}

function isShared(filePath) {
  if (!filePath) return false;
  return path.resolve(filePath).startsWith(path.resolve(dir()) + path.sep);
}

module.exports = { dir, pathFor, isShared, NOME_PASTA };
