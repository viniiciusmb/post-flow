// API da Kick: saber se um canal existe, se esta ao vivo, e os clipes que os
// espectadores criaram. E a API que o proprio site da Kick usa (kick.com/api/v2),
// sem conta nem token - ninguem loga na Kick, igual na Twitch.
//
// Duas coisas medidas na VPS em 30/09/2026 antes de escrever isto:
//  - a Kick tem protecao contra robos que BLOQUEIA (403 "Request blocked by
//    security policy") quando a requisicao finge ser um navegador (User-Agent
//    de Chrome), e deixa passar a identificacao padrao do Node. Por isso aqui
//    nao vai User-Agent nenhum - "consertar" isso pondo um de navegador
//    derruba a integracao inteira;
//  - nao ha consulta em lote como a da Twitch: e uma chamada por canal. Com a
//    vigia a cada minuto e poucos canais, isso e irrelevante.
'use strict';

const BASE = 'https://kick.com/api/v2';
const TIMEOUT_MS = 15_000;

async function pedir(caminho) {
  const r = await fetch(`${BASE}${caminho}`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (r.status === 404) return null;
  const dados = await r.json().catch(() => null);
  if (!r.ok || !dados) throw new Error(`Kick ${caminho} respondeu ${r.status}${dados?.error ? `: ${dados.error}` : ''}`);
  return dados;
}

// Reprise ("RERUN: ...") e uma live antiga passando de novo: gravar gastaria
// transcricao e IA pra cortar o que ja foi ao ar. A Kick nao da um campo pra
// isso; o titulo e a convencao que ela mesma usa.
function ehReprise(titulo) {
  return /^\W*rerun\b/i.test(String(titulo || ''));
}

// Transforma a resposta do canal no formato que o resto do modulo usa (o
// mesmo da Twitch). stream = null quando nao esta ao vivo.
function lerCanal(d) {
  const ls = d.livestream;
  const aoVivo = Boolean(ls && ls.is_live) && !ehReprise(ls.session_title);
  return {
    id: String(d.id),
    login: String(d.slug).toLowerCase(),
    nome: d.user?.username || d.slug,
    imagem: d.user?.profile_pic || null,
    stream: aoVivo
      ? {
          streamId: String(ls.id),
          titulo: ls.session_title || null,
          jogo: ls.categories?.[0]?.name || null,
          espectadores: Number(ls.viewer_count) || 0,
          iniciouEm: ls.start_time || ls.created_at || null,
          // O chat da Kick e por "sala", com id proprio (diferente do canal).
          chatroomId: d.chatroom?.id ? String(d.chatroom.id) : null,
        }
      : null,
  };
}

async function buscarCanal(slug) {
  const d = await pedir(`/channels/${encodeURIComponent(slug)}`);
  return d ? lerCanal(d) : null;
}

async function buscarUsuario(slug) {
  const c = await buscarCanal(slug);
  return c ? { id: c.id, login: c.login, nome: c.nome, imagem: c.imagem } : null;
}

// Map login -> dados da transmissao, SO com quem esta ao vivo, e a lista de
// quem nao deu pra consultar. Os dois precisam ser separados: tratar "a Kick
// nao respondeu" como "offline" pararia uma gravacao no meio da live.
async function buscarAoVivo(logins) {
  const aoVivo = new Map();
  const falharam = new Set();
  for (const login of [...new Set(logins)]) {
    try {
      const c = await buscarCanal(login);
      if (c?.stream) aoVivo.set(login, c.stream);
    } catch {
      falharam.add(login);
    }
  }
  return { aoVivo, falharam };
}

// Clipes dos espectadores desde "desde" (a Kick so filtra por "ultimo dia";
// o corte fino e feito aqui).
async function buscarClipes(slug, desde) {
  const d = await pedir(`/channels/${encodeURIComponent(slug)}/clips?sort=date&time=day`);
  const limite = new Date(desde).getTime();
  return (d?.clips || [])
    .filter((c) => new Date(c.created_at).getTime() >= limite)
    .map((c) => ({
      id: String(c.id),
      titulo: c.title,
      views: Number(c.view_count ?? c.views) || 0,
      duracao: Number(c.duration) || 0,
      criadoEm: c.created_at,
    }));
}

// Aceita "canal", "@canal", "kick.com/canal" ou a URL inteira. O endereco da
// Kick troca "_" por "-" (o usuario Loud_Coringa vira kick.com/loud-coringa);
// os dois funcionam na API.
function normalizarLogin(entrada) {
  let s = String(entrada || '').trim();
  const m = s.match(/kick\.com\/([^/?#\s]+)/i);
  if (m) s = m[1];
  s = s.replace(/^@/, '').toLowerCase();
  return /^[a-z0-9][a-z0-9_-]{1,29}$/.test(s) ? s : null;
}

module.exports = { buscarCanal, buscarUsuario, buscarAoVivo, buscarClipes, normalizarLogin, lerCanal, ehReprise };
