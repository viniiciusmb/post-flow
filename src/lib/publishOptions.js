'use strict';

// Qual configuracao de publicacao vale pra um corte.
//
// Sao duas camadas, e a ordem importa:
//
//   1. o padrao da CONTA, escolhido uma vez pelo criador na tela de publicacao;
//   2. as opcoes DAQUELE corte, quando ele resolveu tratar um diferente.
//
// A camada 2 ganha quando existe. options_confirmed_at na postagem significa
// "este corte tem opcoes proprias" - se for NULL, o corte simplesmente segue o
// padrao da conta.
//
// O que a TikTok proibe e publicar com uma configuracao que o criador nunca
// viu, nao publicar sem ele reconfirmar corte a corte. Por isso o bloqueio esta
// em publish_options_set_at: enquanto ninguem escolheu nada, nao ha padrao, e
// nada sai.

const NIVEIS_DE_PRIVACIDADE = [
  'PUBLIC_TO_EVERYONE',
  'MUTUAL_FOLLOW_FRIENDS',
  'FOLLOWER_OF_CREATOR',
  'SELF_ONLY',
];

function contaTemPadrao(account) {
  return Boolean(account && account.publish_options_set_at && account.default_privacy_level);
}

function postagemTemOpcoesProprias(posting) {
  return Boolean(posting && posting.options_confirmed_at && posting.privacy_level);
}

// Devolve o que vai ser enviado pra TikTok, ou null quando nao ha configuracao
// nenhuma - nesse caso o corte espera em vez de sair com um padrao inventado.
function resolveForPosting(account, posting) {
  if (postagemTemOpcoesProprias(posting)) {
    return {
      origem: 'corte',
      privacyLevel: posting.privacy_level,
      disableComment: Boolean(posting.disable_comment),
      disableDuet: Boolean(posting.disable_duet),
      disableStitch: Boolean(posting.disable_stitch),
      brandOrganicToggle: Boolean(posting.brand_organic_toggle),
      brandContentToggle: Boolean(posting.brand_content_toggle),
    };
  }

  if (contaTemPadrao(account)) {
    return {
      origem: 'conta',
      privacyLevel: account.default_privacy_level,
      disableComment: Boolean(account.default_disable_comment),
      disableDuet: Boolean(account.default_disable_duet),
      disableStitch: Boolean(account.default_disable_stitch),
      brandOrganicToggle: Boolean(account.default_brand_organic_toggle),
      brandContentToggle: Boolean(account.default_brand_content_toggle),
    };
  }

  return null;
}

// Parceria paga nao pode ficar visivel so pra quem publicou - regra da TikTok.
// A tela ja impede, mas quem chamar a API direto tem que esbarrar aqui tambem.
function validar({ privacyLevel, brandContentToggle }) {
  if (!NIVEIS_DE_PRIVACIDADE.includes(privacyLevel)) {
    return 'Escolha quem pode ver os vídeos.';
  }
  if (brandContentToggle && privacyLevel === 'SELF_ONLY') {
    return 'Conteúdo de parceria paga não pode ficar visível só pra você. Escolha outra privacidade.';
  }
  return null;
}

module.exports = {
  NIVEIS_DE_PRIVACIDADE,
  contaTemPadrao,
  postagemTemOpcoesProprias,
  resolveForPosting,
  validar,
};
