// Criptografia dos tokens do TikTok/Google guardados no banco (AES-256-GCM).
// Todo lugar do codigo que precisa ler/gravar um token deve passar por aqui,
// para que o valor "cru" nunca apareca em logs ou em outras camadas.
'use strict';

const crypto = require('crypto');
const config = require('../config');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // recomendado para GCM

function getKey() {
  const key = Buffer.from(config.encryptionKey, 'hex');
  if (key.length !== 32) {
    throw new Error(
      'APP_ENCRYPTION_KEY invalida: precisa ser uma string hex de 32 bytes (64 caracteres). ' +
        'Gere uma nova com: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
    );
  }
  return key;
}

// Retorna { encrypted, iv } prontos para salvar em duas colunas do banco.
// O "auth tag" do GCM vai embutido no final do texto criptografado.
function encrypt(plainText) {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(String(plainText), 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    encrypted: Buffer.concat([ciphertext, authTag]).toString('base64'),
    iv: iv.toString('base64'),
  };
}

function decrypt(encrypted, iv) {
  const raw = Buffer.from(encrypted, 'base64');
  const authTag = raw.subarray(raw.length - 16);
  const ciphertext = raw.subarray(0, raw.length - 16);

  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(authTag);

  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

module.exports = { encrypt, decrypt };
