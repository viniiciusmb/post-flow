// "Cortar o vídeo inteiro em partes" (23/08/2026).
//
// A opção antiga ("vídeo inteiro") transformava um vídeo de uma hora num
// único corte vertical de uma hora — que o TikTok recusa e ninguém assiste.
// Agora o vídeo é fatiado em partes sequenciais numeradas.
//
// Junto vieram três simplificações que estes testes também travam: proporção,
// enquadramento e qualidade deixaram de existir na tela.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { fatiarEmPartes } = require('../../src/worker/videoJobs/processVideoJob');
const pool = require('../../src/db/pool');
const { startServer, stopServer, createLoginableClient, createAgent } = require('../helpers/http');

// --- O fatiamento em si ---

test('as partes cobrem o vídeo inteiro, sem buraco e sem sobreposição', () => {
  const partes = fatiarEmPartes(600, 3, 'Podcast #12');
  assert.ok(partes.length > 1, 'um vídeo de 10 minutos com partes de 3 tinha que render mais de uma parte');
  assert.equal(partes[0].startSeconds, 0, 'a primeira parte tem que começar no zero');
  assert.equal(partes.at(-1).endSeconds, 600, 'a última parte tem que terminar no fim exato do vídeo');
  for (let i = 1; i < partes.length; i += 1) {
    assert.equal(
      partes[i].startSeconds,
      partes[i - 1].endSeconds,
      `a parte ${i + 1} não começa onde a ${i} termina — sobrou buraco ou repetiu trecho`
    );
  }
});

test('não sobra uma parte curtinha no fim', () => {
  // Fatiar de 180 em 180 num vídeo de 10min deixaria uma "Parte 4" de 60s
  // encostada em três de 3min: parece corte com defeito.
  const partes = fatiarEmPartes(600, 3, 't');
  const duracoes = partes.map((p) => p.endSeconds - p.startSeconds);
  const menor = Math.min(...duracoes);
  const maior = Math.max(...duracoes);
  assert.ok(maior - menor < 1, `as partes saíram de tamanhos diferentes: ${duracoes.join(', ')}`);
});

test('a duração pedida é uma média: o número de partes é o mais próximo dela', () => {
  // 4min30 com alvo de 3min: 2 partes de 2min15 ficam mais perto do pedido do
  // que 1 de 4min30.
  assert.equal(fatiarEmPartes(270, 3, 't').length, 2);
  // 10min com alvo de 3min: 3 partes de 3min20.
  assert.equal(fatiarEmPartes(600, 3, 't').length, 3);
  // 10min com alvo de 5min: 2 partes.
  assert.equal(fatiarEmPartes(600, 5, 't').length, 2);
});

test('vídeo mais curto que a parte pedida vira uma parte só', () => {
  const partes = fatiarEmPartes(90, 5, 't');
  assert.equal(partes.length, 1);
  assert.equal(partes[0].startSeconds, 0);
  assert.equal(partes[0].endSeconds, 90);
});

test('vídeo muito longo não vira uma fila infinita', () => {
  // 5 horas com partes de 1 minuto seriam 300 cortes de uma vez só — enche a
  // fila de publicação e o disco por causa de um clique.
  assert.ok(fatiarEmPartes(5 * 3600, 1, 't').length <= 30);
});

test('duração desconhecida não gera parte nenhuma (em vez de um corte quebrado)', () => {
  assert.deepEqual(fatiarEmPartes(0, 3, 't'), []);
  assert.deepEqual(fatiarEmPartes(null, 3, 't'), []);
});

// --- A configuração pela API ---

let baseUrl;

test.before(async () => {
  baseUrl = await startServer();
});

test.after(async () => {
  await stopServer();
  await pool.end();
});

async function agenteLogado() {
  const cliente = await createLoginableClient({ role: 'client' });
  const agente = createAgent(baseUrl);
  await agente.login(cliente.email, cliente.password);
  return agente;
}

test('escolher o modo de partes LIGA a numeração, mesmo mandando desligada', async () => {
  const agente = await agenteLogado();
  const r = await agente.put('/api/client/video-settings', {
    clipMode: 'full_parts',
    // Um PUT direto tentando burlar a tela (onde a caixa fica travada).
    showPartLabel: false,
  });
  assert.equal(r.status, 200, r.text);
  assert.equal(
    r.body.showPartLabel,
    true,
    'sem numeração as partes chegam no TikTok sem ordem — o servidor tem que forçar'
  );
  assert.equal((await agente.get('/api/client/video-settings')).body.showPartLabel, true);
});

test('sair do modo de partes devolve a numeração pro controle do cliente', async () => {
  const agente = await agenteLogado();
  await agente.put('/api/client/video-settings', { clipMode: 'full_parts' });
  const r = await agente.put('/api/client/video-settings', { clipMode: 'ai_choice', showPartLabel: false });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.showPartLabel, false, 'fora do modo de partes a numeração volta a ser escolha');
});

test('a duração de cada parte é salva e recusada fora de 1 a 10 minutos', async () => {
  const agente = await agenteLogado();

  const ok = await agente.put('/api/client/video-settings', { clipMode: 'full_parts', fullPartsMinutes: 7 });
  assert.equal(ok.status, 200, ok.text);
  assert.equal(ok.body.fullPartsMinutes, 7);
  assert.equal((await agente.get('/api/client/video-settings')).body.fullPartsMinutes, 7);

  // 11 minutos passaria do limite de duração de vídeo do TikTok.
  const alto = await agente.put('/api/client/video-settings', { fullPartsMinutes: 11 });
  assert.equal(alto.status, 400, 'duração acima do teto tinha que ser recusada');
  const zero = await agente.put('/api/client/video-settings', { fullPartsMinutes: 0 });
  assert.equal(zero.status, 400, 'duração zerada tinha que ser recusada');

  // E a recusa não pode ter estragado o que já estava salvo.
  assert.equal((await agente.get('/api/client/video-settings')).body.fullPartsMinutes, 7);
});

test('o modo antigo "vídeo inteiro" não existe mais', async () => {
  const agente = await agenteLogado();
  const r = await agente.put('/api/client/video-settings', { clipMode: 'full_video' });
  assert.equal(r.status, 400, 'aceitar o valor antigo deixaria a configuração num modo sem código que a atenda');
});

test('proporção, enquadramento e qualidade sumiram da tela', async () => {
  const agente = await agenteLogado();
  const { body } = await agente.get('/api/client/video-settings');

  for (const campo of ['aspectRatio', 'framing', 'quality']) {
    assert.equal(body[campo], undefined, `${campo} voltou a aparecer na resposta`);
  }
  for (const campo of ['aspectRatios', 'framings', 'qualities']) {
    assert.equal(body.options[campo], undefined, `${campo} voltou a aparecer nas opções`);
  }

  // Um cliente com a tela antiga aberta ainda manda esses campos. Eles têm que
  // ser ignorados, não derrubar o salvamento inteiro.
  const r = await agente.put('/api/client/video-settings', {
    aspectRatio: '16:9',
    framing: 'blur_pad',
    quality: 'medium',
    maxClips: 9,
  });
  assert.equal(r.status, 200, `tela antiga não pode quebrar o save: ${r.text}`);
  assert.equal(r.body.maxClips, 9);
});
