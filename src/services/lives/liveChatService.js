// Chat da live (Twitch ou Kick) como SINAL de momento: quantas mensagens por segundo e
// quantas risadas/reacoes. Quando algo acontece na live, o chat acelera e
// enche de "KKKK", "KEKW", "?" - medido em 28/09/2026: numa live de 3.700
// pessoas o ritmo foi de ~10 pra 42 mensagens a cada 10s num momento
// engracado.
//
// Twitch: conexao IRC ANONIMA (usuario justinfan*). Kick: o websocket publico
// (Pusher) que o proprio site da Kick usa pra mostrar o chat, na "sala" do
// canal. Nos dois casos nao precisa de conta, token nem autorizacao do
// streamer, e so le - nao ha como enviar nada. Nada do conteudo das mensagens
// e guardado: so as contagens por balde de 5s.
'use strict';

const net = require('net');
const WebSocket = require('ws');
const livesRepository = require('../../repositories/livesRepository');
const logger = require('../../lib/logger');

const HOST = 'irc.chat.twitch.tv';
const PORTA = 6667;
const BALDE_MS = 5000;

// Chave publica do Pusher da Kick (a mesma que o site dela usa, visivel no
// navegador de qualquer visitante). Conferida ao vivo em 30/09/2026: 14
// mensagens em 15s no chat do xQc. Se a Kick trocar a chave, o chat da Kick
// para de contar (a gravacao segue igual) - KICK_PUSHER_KEY troca sem deploy.
const KICK_PUSHER_KEY = process.env.KICK_PUSHER_KEY || '32cbd69e4b950bf97679';
const KICK_PUSHER_URL = `wss://ws-us2.pusher.com/app/${KICK_PUSHER_KEY}?protocol=7&client=js&version=8.4.0&flash=false`;

// Risada em PT/EN e os emotes de risada da Twitch. Contada no maximo uma vez
// por mensagem: "KKKKKKKKKK" de uma pessoa so e UMA risada.
const RISADA = /^(k{3,}|(ha){2,}h?|(he){2,}|(rs){2,}|kek\w*|lul\w*|omegalul|lmao+|lol+|icant|pepelaugh|😂+|🤣+|risos?)$/i;
// Surpresa/hype/indignacao - "algo aconteceu", mesmo que nao seja engracado.
const HYPE = /^(pog\w*|w+|l+|monka\w*|o{3,}|no{3,}|nao{2,}|caralh\w*|porra+|mds+|meu\s*deus|\?{2,}|!{2,}|wtf|omg|😱+|😮+|🔥+|clip(a|e|it)?)$/i;

// A Kick manda os emotes como "[emote:37226:KEKW]": vira so o nome, pra
// contar igual ao emote da Twitch.
function limparEmotes(texto) {
  return String(texto).replace(/\[emote:\d+:([^\]]+)\]/g, ' $1 ');
}

function classificar(texto) {
  const palavras = limparEmotes(texto).trim().split(/\s+/).slice(0, 30);
  let risada = false;
  let hype = false;
  for (const p of palavras) {
    if (!risada && RISADA.test(p)) risada = true;
    else if (!hype && HYPE.test(p)) hype = true;
  }
  // Mensagem que e SO "?" tambem e reacao ("o que?!").
  if (!hype && /^\?+$/.test(String(texto).trim())) hype = true;
  return { risada, hype };
}

const conexoes = new Map(); // sessionId -> { parar }

function acompanhar({
  sessionId,
  plataforma = 'twitch',
  login,
  chatroomId = null,
  conectar = () => net.connect(PORTA, HOST),
  conectarKick = () => new WebSocket(KICK_PUSHER_URL),
}) {
  if (conexoes.has(sessionId)) return;
  // Sem a sala nao ha o que ouvir na Kick; a gravacao segue sem o sinal.
  if (plataforma === 'kick' && !chatroomId) {
    logger.warn(`Lives: chat de kick.com/${login} sem sala conhecida - gravando sem o sinal do chat.`);
    return;
  }
  let socket = null;
  let parado = false;
  let buffer = '';
  const baldes = new Map(); // inicio do balde (ms) -> { msgs, risadas, hype }

  function registrar(texto) {
    const inicio = Math.floor(Date.now() / BALDE_MS) * BALDE_MS;
    const b = baldes.get(inicio) || { msgs: 0, risadas: 0, hype: 0 };
    const c = classificar(texto);
    b.msgs += 1;
    if (c.risada) b.risadas += 1;
    if (c.hype) b.hype += 1;
    baldes.set(inicio, b);
  }

  // Grava so os baldes que ja FECHARAM (o atual ainda esta enchendo).
  async function descarregar(tudo = false) {
    const agora = Math.floor(Date.now() / BALDE_MS) * BALDE_MS;
    const prontos = [...baldes.entries()].filter(([inicio]) => tudo || inicio < agora);
    for (const [inicio] of prontos) baldes.delete(inicio);
    if (!prontos.length) return;
    try {
      await livesRepository.saveChatBuckets(sessionId, prontos.map(([inicio, b]) => ({ bucket_at: new Date(inicio).toISOString(), ...b })));
    } catch (err) {
      logger.error(`Lives: nao consegui gravar o chat da sessao ${sessionId}:`, err.message);
    }
  }

  // Kick: conecta no Pusher, entra na sala do canal e conta cada mensagem.
  // O Pusher manda "ping" e derruba quem nao responde; cair reconecta em 10s,
  // igual a Twitch.
  function abrirKick() {
    if (parado) return;
    socket = conectarKick();
    socket.on('message', (bruto) => {
      let evento;
      try {
        evento = JSON.parse(String(bruto));
      } catch {
        return;
      }
      if (evento.event === 'pusher:connection_established') {
        socket.send(JSON.stringify({ event: 'pusher:subscribe', data: { auth: '', channel: `chatrooms.${chatroomId}.v2` } }));
      } else if (evento.event === 'pusher:ping') {
        socket.send(JSON.stringify({ event: 'pusher:pong', data: {} }));
      } else if (evento.event === 'App\\Events\\ChatMessageEvent') {
        try {
          const dados = typeof evento.data === 'string' ? JSON.parse(evento.data) : evento.data;
          if (dados?.content) registrar(dados.content);
        } catch {
          // mensagem mal formada: ignora so ela
        }
      }
    });
    socket.on('error', (err) => logger.warn(`Lives: chat de kick.com/${login} deu erro: ${err.message}`));
    socket.on('close', () => {
      if (!parado) setTimeout(abrirKick, 10_000).unref();
    });
  }

  function abrir() {
    if (parado) return;
    socket = conectar();
    socket.setEncoding('utf8');
    socket.on('connect', () => {
      socket.write(`NICK justinfan${10000 + Math.floor(Math.random() * 89999)}\r\nJOIN #${login}\r\n`);
    });
    socket.on('data', (dados) => {
      buffer += dados;
      const linhas = buffer.split('\r\n');
      buffer = linhas.pop();
      for (const linha of linhas) {
        if (linha.startsWith('PING')) socket.write('PONG :tmi.twitch.tv\r\n');
        const m = linha.match(/ PRIVMSG #\S+ :(.*)$/);
        if (m) registrar(m[1]);
      }
    });
    socket.on('error', (err) => logger.warn(`Lives: chat de ${login} deu erro: ${err.message}`));
    // Caiu: reconecta em 10s. O chat e sinal de apoio - nunca derruba nada.
    socket.on('close', () => {
      if (!parado) setTimeout(abrir, 10_000).unref();
    });
  }

  const timer = setInterval(() => void descarregar(), BALDE_MS);
  timer.unref();
  if (plataforma === 'kick') abrirKick();
  else abrir();

  conexoes.set(sessionId, {
    parar: async () => {
      parado = true;
      clearInterval(timer);
      if (socket) {
        if (typeof socket.terminate === 'function') socket.terminate();
        else socket.destroy();
      }
      conexoes.delete(sessionId);
      await descarregar(true);
    },
  });
}

async function parar(sessionId) {
  const c = conexoes.get(sessionId);
  if (c) await c.parar();
}

async function pararTodos() {
  await Promise.all([...conexoes.values()].map((c) => c.parar()));
}

function acompanhando(sessionId) {
  return conexoes.has(sessionId);
}

module.exports = { acompanhar, parar, pararTodos, acompanhando, classificar };
