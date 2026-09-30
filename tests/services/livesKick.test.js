// Cortes de lives da Kick (30/09/2026). As respostas falsas aqui copiam o
// formato REAL da API da Kick, conferido na VPS no mesmo dia (kick.com/api/v2
// /channels/xqc e /channels/xqc/clips) - nunca inventado a partir do codigo.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');

const pool = require('../../src/db/pool');
const kickApi = require('../../src/services/lives/kickApi');
const plataformas = require('../../src/services/lives/plataformas');
const liveChatService = require('../../src/services/lives/liveChatService');
const liveCaptureService = require('../../src/services/lives/liveCaptureService');
const livesRepository = require('../../src/repositories/livesRepository');

test.after(async () => {
  await pool.end();
});

function trocar(modulo, nome, falsa) {
  const original = modulo[nome];
  modulo[nome] = falsa;
  return () => { modulo[nome] = original; };
}

// Recorte da resposta real de /api/v2/channels/xqc (ao vivo).
function canalReal({ aoVivo = true, titulo = 'LIVE QUICK GTA 5 NOPIXEL' } = {}) {
  return {
    id: 668,
    user_id: 676,
    slug: 'xqc',
    playback_url: 'https://exemplo/playlist.m3u8',
    livestream: aoVivo
      ? {
          id: 129766048,
          channel_id: 668,
          created_at: '2026-09-29 19:54:02',
          session_title: titulo,
          is_live: true,
          start_time: '2026-09-29 19:53:58',
          viewer_count: 10967,
          categories: [{ id: 8, name: 'Grand Theft Auto V (GTA)' }],
        }
      : null,
    user: { id: 676, username: 'xQc', profile_pic: 'https://files.kick.com/x.webp' },
    chatroom: { id: 668 },
  };
}

function fetchFalso(rotas) {
  return async (url) => {
    const caminho = String(url).replace('https://kick.com/api/v2', '');
    const r = rotas(caminho);
    if (r instanceof Error) throw r;
    const [status, corpo] = r;
    return { status, ok: status >= 200 && status < 300, json: async () => corpo };
  };
}

test('nome do canal da Kick aceita o que a pessoa cola, e o link decide a plataforma', () => {
  assert.equal(kickApi.normalizarLogin('https://kick.com/Gaules?ref=abc'), 'gaules');
  assert.equal(kickApi.normalizarLogin('@loud-coringa'), 'loud-coringa');
  assert.equal(kickApi.normalizarLogin('kick.com/loud_coringa'), 'loud_coringa');
  assert.equal(kickApi.normalizarLogin('nome com espaco'), null);
  assert.equal(kickApi.normalizarLogin(''), null);

  assert.deepEqual(plataformas.identificar('https://kick.com/xqc'), { plataforma: 'kick', login: 'xqc' });
  assert.deepEqual(plataformas.identificar('https://twitch.tv/xqc', 'kick'), { plataforma: 'twitch', login: 'xqc' }, 'o link vence o botao');
  assert.deepEqual(plataformas.identificar('xqc', 'kick'), { plataforma: 'kick', login: 'xqc' });
  assert.deepEqual(plataformas.identificar('xqc'), { plataforma: 'twitch', login: 'xqc' }, 'padrao continua Twitch');
  assert.equal(plataformas.urlDaLive({ platform: 'kick', login: 'xqc' }), 'https://kick.com/xqc');
  assert.equal(plataformas.urlDaLive({ platform: 'twitch', login: 'xqc' }), 'https://twitch.tv/xqc');
});

test('le o canal real da Kick: ao vivo com a sala do chat; offline; e reprise nao conta como ao vivo', () => {
  const vivo = kickApi.lerCanal(canalReal());
  assert.equal(vivo.id, '668');
  assert.equal(vivo.nome, 'xQc');
  assert.deepEqual(vivo.stream, {
    streamId: '129766048',
    titulo: 'LIVE QUICK GTA 5 NOPIXEL',
    jogo: 'Grand Theft Auto V (GTA)',
    espectadores: 10967,
    iniciouEm: '2026-09-29 19:53:58',
    chatroomId: '668',
  });
  assert.equal(kickApi.lerCanal(canalReal({ aoVivo: false })).stream, null);
  // Visto de verdade no canal "gaules" em 30/09: "RERUN: Jogos Variados!".
  assert.equal(kickApi.lerCanal(canalReal({ titulo: 'RERUN: Jogos Variados! - !socio' })).stream, null);
});

test('Kick fora do ar em um canal: fica como DESCONHECIDO, nunca como offline', async () => {
  const desfazer = trocar(globalThis, 'fetch', fetchFalso((c) => {
    if (c === '/channels/xqc') return [200, canalReal()];
    if (c === '/channels/offline1') return [200, { ...canalReal({ aoVivo: false }), slug: 'offline1' }];
    if (c === '/channels/sumiu') return [404, { error: 'Not Found' }];
    return new Error('fetch failed');
  }));
  try {
    const { aoVivo, falharam } = await kickApi.buscarAoVivo(['xqc', 'offline1', 'sumiu', 'caiu']);
    assert.deepEqual([...aoVivo.keys()], ['xqc']);
    assert.deepEqual([...falharam], ['caiu']);

    const status = await plataformas.statusDosCanais([
      { id: 1, platform: 'kick', login: 'xqc' },
      { id: 2, platform: 'kick', login: 'offline1' },
      { id: 3, platform: 'kick', login: 'caiu' },
    ]);
    assert.equal(status.get(1).chatroomId, '668');
    assert.equal(status.get(2), null, 'offline de verdade');
    assert.equal(status.has(3), false, 'nao consultado = fora do mapa');
  } finally {
    desfazer();
  }
});

test('clipes dos espectadores da Kick: so os criados desde o inicio da gravacao', async () => {
  const desfazer = trocar(globalThis, 'fetch', fetchFalso((c) => {
    assert.equal(c, '/channels/xqc/clips?sort=date&time=day');
    return [200, {
      clips: [
        { id: 'clip_01M3R4BH6SVJ857X1MP27VZN1N', title: 'sdfh', views: 1, view_count: 1, duration: 21, created_at: '2026-09-30T03:05:41.855086Z' },
        { id: 'clip_antigo', title: 'velho', views: 9, view_count: 9, duration: 30, created_at: '2026-09-29T10:00:00Z' },
      ],
    }];
  }));
  try {
    const clipes = await plataformas.buscarClipes({ platform: 'kick', login: 'xqc' }, '2026-09-30T00:00:00Z');
    assert.deepEqual(clipes, [{ id: 'clip_01M3R4BH6SVJ857X1MP27VZN1N', titulo: 'sdfh', views: 1, duracao: 21, criadoEm: '2026-09-30T03:05:41.855086Z' }]);
  } finally {
    desfazer();
  }
});

test('emote da Kick ("[emote:id:KEKW]") conta como risada, igual ao da Twitch', () => {
  assert.deepEqual(liveChatService.classificar('[emote:37226:KEKW]'), { risada: true, hype: false });
  assert.deepEqual(liveChatService.classificar('kkkk [emote:1:PogChamp]'), { risada: true, hype: true });
  assert.deepEqual(liveChatService.classificar('[emote:5747866:collectiblesFeelsComfyMan] boa'), { risada: false, hype: false });
});

test('chat da Kick: entra na sala certa, responde o ping e conta as mensagens', async () => {
  const gravados = [];
  const desfazerRepo = trocar(livesRepository, 'saveChatBuckets', async (sessionId, baldes) => { gravados.push(...baldes); });
  const socket = new EventEmitter();
  socket.enviados = [];
  socket.send = (m) => socket.enviados.push(JSON.parse(m));
  socket.terminate = () => {};
  const evento = (e) => socket.emit('message', Buffer.from(JSON.stringify(e)));
  const msg = (content) => evento({ event: 'App\\Events\\ChatMessageEvent', data: JSON.stringify({ content }), channel: 'chatrooms.555.v2' });
  try {
    liveChatService.acompanhar({ sessionId: 909090, plataforma: 'kick', login: 'xqc', chatroomId: '555', conectarKick: () => socket });
    evento({ event: 'pusher:connection_established', data: '{"socket_id":"1.2"}' });
    assert.deepEqual(socket.enviados[0], { event: 'pusher:subscribe', data: { auth: '', channel: 'chatrooms.555.v2' } });
    evento({ event: 'pusher:ping', data: {} });
    assert.equal(socket.enviados[1].event, 'pusher:pong');
    msg('KKKKKKK');
    msg('[emote:37226:KEKW]');
    msg('que isso ???');
    msg('boa noite');
    socket.emit('message', Buffer.from('nao e json'));
    await liveChatService.parar(909090);
  } finally {
    desfazerRepo();
  }
  const soma = gravados.reduce((t, b) => ({ msgs: t.msgs + b.msgs, risadas: t.risadas + b.risadas, hype: t.hype + b.hype }), { msgs: 0, risadas: 0, hype: 0 });
  assert.deepEqual(soma, { msgs: 4, risadas: 2, hype: 1 });
});

test('Kick sem sala do chat conhecida: grava sem o sinal, sem tentar conectar', () => {
  let conectou = false;
  liveChatService.acompanhar({ sessionId: 919191, plataforma: 'kick', login: 'x', chatroomId: null, conectarKick: () => { conectou = true; } });
  assert.equal(conectou, false);
  assert.equal(liveChatService.acompanhando(919191), false);
});

test('gravacao da Kick usa o endereco kick.com e cai nas qualidades que a Kick oferece', () => {
  const args = liveCaptureService.argsStreamlink('https://kick.com/xqc', '720p');
  assert.ok(args.includes('https://kick.com/xqc'));
  // A Kick nao tem 720p30; a lista precisa ter 720p60 antes de cair pra 480p.
  const ordem = args[args.length - 1].split(',');
  assert.ok(ordem.indexOf('720p60') >= 0 && ordem.indexOf('720p60') < ordem.indexOf('480p'));
});
