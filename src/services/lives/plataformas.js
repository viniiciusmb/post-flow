// Twitch e Kick atras de uma porta so. Todo o resto do modulo (vigia,
// gravacao, chat, clipes dos espectadores, tela) pergunta aqui e nao precisa
// saber de qual plataforma o canal e.
//
// Depois da gravacao comecar nao existe diferenca nenhuma: o streamlink entrega
// o mesmo video (os dois usam HLS), e transcricao, IA e render sao os mesmos.
'use strict';

const twitchApi = require('./twitchApi');
const kickApi = require('./kickApi');

const PLATAFORMAS = Object.freeze(['twitch', 'kick']);
const NOMES = Object.freeze({ twitch: 'Twitch', kick: 'Kick' });

function api(plataforma) {
  return plataforma === 'kick' ? kickApi : twitchApi;
}

// A Twitch precisa do app cadastrado (TWITCH_CLIENT_ID/SECRET); a Kick nao
// precisa de nada.
function disponivel(plataforma) {
  return plataforma === 'kick' ? true : twitchApi.configurado();
}

// Descobre plataforma e nome do canal a partir do que a pessoa colou. O link
// decide sozinho; nome solto usa a plataforma escolhida na tela (padrao
// Twitch, que era a unica antes).
function identificar(entrada, escolhida) {
  const texto = String(entrada || '');
  let plataforma = PLATAFORMAS.includes(escolhida) ? escolhida : 'twitch';
  if (/kick\.com\//i.test(texto)) plataforma = 'kick';
  else if (/twitch\.tv\//i.test(texto)) plataforma = 'twitch';
  const login = api(plataforma).normalizarLogin(texto);
  return login ? { plataforma, login } : null;
}

function urlDaLive(canal) {
  return canal.platform === 'kick' ? `https://kick.com/${canal.login}` : `https://twitch.tv/${canal.login}`;
}

function buscarUsuario(plataforma, login) {
  return api(plataforma).buscarUsuario(login);
}

// Map id do canal -> transmissao (null = offline). Canal que NAO aparece no
// mapa e canal cujo estado nao deu pra saber (plataforma fora do ar, Twitch
// sem configuracao): quem chama nao pode trata-lo como offline, senao para uma
// gravacao no meio da live. Uma plataforma fora do ar nao impede a outra.
async function statusDosCanais(canais) {
  const status = new Map();
  const twitch = canais.filter((c) => (c.platform || 'twitch') === 'twitch');
  const kick = canais.filter((c) => c.platform === 'kick');

  if (twitch.length && twitchApi.configurado()) {
    try {
      const aoVivo = await twitchApi.buscarAoVivo(twitch.map((c) => c.login));
      for (const c of twitch) status.set(Number(c.id), aoVivo.get(c.login) || null);
    } catch {
      // Twitch fora do ar: nenhum canal dela entra no mapa.
    }
  }
  if (kick.length) {
    const { aoVivo, falharam } = await kickApi.buscarAoVivo(kick.map((c) => c.login));
    for (const c of kick) {
      if (!falharam.has(c.login)) status.set(Number(c.id), aoVivo.get(c.login) || null);
    }
  }
  return status;
}

// Clipes dos espectadores da sessao. A Twitch pede o id numerico do canal; a
// Kick, o nome (slug).
async function buscarClipes(sessao, desde) {
  if (sessao.platform === 'kick') return kickApi.buscarClipes(sessao.login, desde);
  if (!sessao.platform_user_id || !twitchApi.configurado()) return [];
  return twitchApi.buscarClipes(sessao.platform_user_id, desde);
}

module.exports = { PLATAFORMAS, NOMES, disponivel, identificar, urlDaLive, buscarUsuario, statusDosCanais, buscarClipes };
