// O e-mail de suporte aparece no servidor e no painel (que é um pacote estático
// e não consegue ler a constante do servidor em tempo de execução). São duas
// cópias, e duas cópias divergem — foi assim que o endereço antigo sobreviveu
// escrito em cinco lugares até a troca de domínio.
//
// Este teste é o que impede a divergência: mudar um sem o outro quebra o build.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { CONTACT } = require('../../src/config/constants');

test('o e-mail de suporte do painel é o mesmo do servidor', () => {
  const arquivo = path.join(__dirname, '../../web-client/src/lib/contato.ts');
  const conteudo = fs.readFileSync(arquivo, 'utf8');
  const noPainel = conteudo.match(/EMAIL_SUPORTE = "([^"]+)"/)[1];

  assert.equal(
    noPainel,
    CONTACT.supportEmail,
    'web-client/src/lib/contato.ts saiu do valor de src/config/constants.js'
  );
});
