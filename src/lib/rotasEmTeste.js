// Rotas das novidades que estão em teste com o admin e a Rise Style (painel
// novo). Erro de servidor nelas vai pra tela "Erros em teste" (operação
// painel_novo_api), separada dos erros do que todo cliente já usa.
//
// Quando uma novidade abrir pra todos, a rota dela sai desta lista e o erro
// volta a ser só do log técnico, como as outras.
'use strict';

// Vazia desde 12/10/2026: o painel novo abriu para todos, e erro de servidor
// nessas rotas vai pra tela "Erros" como qualquer outro.
const PREFIXOS = [];

function ehRotaEmTeste(caminho) {
  return PREFIXOS.some((p) => caminho === p || caminho.startsWith(`${p}/`));
}

// "/api/client/social-postings/123/cancelar" -> "/api/client/social-postings/:id/cancelar":
// sem isso cada id viraria um erro diferente na lista.
function rotaSemIds(caminho) {
  return caminho.replace(/\/\d+(?=\/|$)/g, '/:id');
}

module.exports = { ehRotaEmTeste, rotaSemIds, PREFIXOS };
