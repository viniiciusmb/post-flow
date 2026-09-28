// API da Twitch com token de APP (client credentials): so serve pra saber se
// um canal existe e se esta ao vivo. Ninguem loga na Twitch - nem o streamer,
// nem o clipador. A gravacao em si e do streamlink, que nao usa esta API.
'use strict';

const config = require('../../config');

const TOKEN_URL = 'https://id.twitch.tv/oauth2/token';
const HELIX = 'https://api.twitch.tv/helix';
// Get Streams e Get Users aceitam no maximo 100 logins por chamada.
const LOTE = 100;
const TIMEOUT_MS = 15_000;

let tokenEmCache = null; // { valor, expiraEm }

function configurado() {
  return Boolean(config.twitch.clientId && config.twitch.clientSecret);
}

async function obterToken() {
  // Renova 5 minutos antes de vencer: um token que vence NO MEIO de uma
  // chamada devolve 401 e a checagem daquele minuto se perde.
  if (tokenEmCache && tokenEmCache.expiraEm - 5 * 60_000 > Date.now()) return tokenEmCache.valor;
  const corpo = new URLSearchParams({
    client_id: config.twitch.clientId,
    client_secret: config.twitch.clientSecret,
    grant_type: 'client_credentials',
  });
  const r = await fetch(TOKEN_URL, { method: 'POST', body: corpo, signal: AbortSignal.timeout(TIMEOUT_MS) });
  const dados = await r.json().catch(() => ({}));
  if (!r.ok || !dados.access_token) {
    throw new Error(`Twitch recusou o token de app: ${dados.message || r.status}`);
  }
  tokenEmCache = { valor: dados.access_token, expiraEm: Date.now() + (dados.expires_in || 3600) * 1000 };
  return tokenEmCache.valor;
}

async function helix(caminho, parametros) {
  for (let tentativa = 0; tentativa < 2; tentativa += 1) {
    const token = await obterToken();
    const url = `${HELIX}${caminho}?${parametros.toString()}`;
    const r = await fetch(url, {
      headers: { 'Client-Id': config.twitch.clientId, Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    // 401 = token revogado ou vencido antes da hora: descarta e tenta uma vez.
    if (r.status === 401 && tentativa === 0) {
      tokenEmCache = null;
      continue;
    }
    const dados = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`Twitch ${caminho} respondeu ${r.status}: ${dados.message || ''}`);
    return dados.data || [];
  }
  throw new Error(`Twitch ${caminho}: token recusado duas vezes.`);
}

function emLotes(lista) {
  const lotes = [];
  for (let i = 0; i < lista.length; i += LOTE) lotes.push(lista.slice(i, i + LOTE));
  return lotes;
}

// Devolve um Map login -> dados da transmissao, SO com quem esta ao vivo.
// Quem nao aparece na resposta esta offline.
async function buscarAoVivo(logins) {
  const aoVivo = new Map();
  for (const lote of emLotes([...new Set(logins)])) {
    const p = new URLSearchParams();
    for (const l of lote) p.append('user_login', l);
    p.append('first', String(LOTE));
    const dados = await helix('/streams', p);
    for (const s of dados) {
      if (s.type !== 'live') continue;
      aoVivo.set(String(s.user_login).toLowerCase(), {
        streamId: s.id,
        titulo: s.title,
        jogo: s.game_name,
        espectadores: s.viewer_count,
        iniciouEm: s.started_at,
      });
    }
  }
  return aoVivo;
}

async function buscarUsuario(login) {
  const p = new URLSearchParams({ login });
  const [u] = await helix('/users', p);
  if (!u) return null;
  return { id: u.id, login: String(u.login).toLowerCase(), nome: u.display_name, imagem: u.profile_image_url };
}

// Aceita "canal", "@canal", "twitch.tv/canal" ou a URL inteira - e o que a
// pessoa cola. Devolve null se nao for um login valido da Twitch (3 a 25
// caracteres, letras, numeros e _).
function normalizarLogin(entrada) {
  let s = String(entrada || '').trim();
  const m = s.match(/twitch\.tv\/([^/?#\s]+)/i);
  if (m) s = m[1];
  s = s.replace(/^@/, '').toLowerCase();
  return /^[a-z0-9_]{3,25}$/.test(s) ? s : null;
}

function _limparCache() {
  tokenEmCache = null;
}

module.exports = { configurado, buscarAoVivo, buscarUsuario, normalizarLogin, _limparCache };
