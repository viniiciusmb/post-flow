// Aceita tanto o link completo que o Google Drive gera ao compartilhar uma
// pasta (https://drive.google.com/drive/folders/ID?usp=sharing) quanto o ID
// puro, e sempre devolve so o ID. Admin nao-tecnico so vai colar o link.
'use strict';

function extractDriveFolderId(input) {
  const value = String(input || '').trim();
  const match = value.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (match) return match[1];
  return value;
}

module.exports = { extractDriveFolderId };
