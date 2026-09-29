// Chat da Twitch como SINAL de momento: quantas mensagens por segundo e
// quantas risadas/reacoes. Quando algo acontece na live, o chat acelera e
// enche de "KKKK", "KEKW", "?" - medido em 28/09/2026: numa live de 3.700
// pessoas o ritmo foi de ~10 pra 42 mensagens a cada 10s num momento
// engracado.
//
// Conexao IRC ANONIMA (usuario justinfan*): nao precisa de conta, token nem
// autorizacao do streamer, e so le - nao ha como enviar nada por ela. Nada do
// conteudo das mensagens e guardado: so as contagens por balde de 5s.
'use strict';

const net = require('net');
const livesRepository = require('../../repositories/livesRepository');
const logger = require('../../lib/logger');

const HOST = 'irc.chat.twitch.tv';
const PORTA = 6667;
const BALDE_MS = 5000;

// Risada em PT/EN e os emotes de risada da Twitch. Contada no maximo uma vez
// por mensagem: "KKKKKKKKKK" de uma pessoa so e UMA risada.
const RISADA = /^(k{3,}|(ha){2,}h?|(he){2,}|(rs){2,}|kek\w*|lul\w*|omegalul|lmao+|lol+|icant|pepelaugh|😂+|🤣+|risos?)$/i;
// Surpresa/hype/indignacao - "algo aconteceu", mesmo que nao seja engracado.
const HYPE = /^(pog\w*|w+|l+|monka\w*|o{3,}|no{3,}|nao{2,}|caralh\w*|porra+|mds+|meu\s*deus|\?{2,}|!{2,}|wtf|omg|😱+|😮+|🔥+|clip(a|e|it)?)$/i;

function classificar(texto) {
  const palavras = String(texto).trim().split(/\s+/).slice(0, 30);
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

function acompanhar({ sessionId, login, conectar = () => net.connect(PORTA, HOST) }) {
  if (conexoes.has(sessionId)) return;
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
  abrir();

  conexoes.set(sessionId, {
    parar: async () => {
      parado = true;
      clearInterval(timer);
      if (socket) socket.destroy();
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
