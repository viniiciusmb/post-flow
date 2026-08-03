// "Só baixar quando o meu computador estiver ligado".
//
// O túnel só funciona enquanto o computador do cliente está ligado, conectado e
// com o programa aberto. Antes, se ele estivesse desligado na hora em que o
// vídeo entrava na fila, o download saía pela nossa banda sem ninguém decidir
// isso - e o cliente só descobria depois, na cota normal consumida no lugar da
// bônus. Agora é escolha dele.
//
// O que estes testes travam:
//   - a escolha é respeitada nos dois sentidos;
//   - o vídeo que espera NÃO vira erro (é escolha, não falha);
//   - ele volta pra fila sozinho quando o computador reconecta;
//   - desligar a exigência solta na hora o que estava esperando;
//   - túnel desligado pelo admin não pode segurar a fila de ninguém.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const pool = require('../../src/db/pool');
const downloadTunnelsRepository = require('../../src/repositories/downloadTunnelsRepository');
const sourceVideosRepository = require('../../src/repositories/sourceVideosRepository');
const creditsUnlockService = require('../../src/services/creditsUnlockService');
const queueService = require('../../src/services/queueService');
const { createClient, createSourceVideo } = require('../helpers/db');

test.after(async () => {
  await pool.end();
});

let porta = 30000;

async function comTunel(clientUserId, { conectado, exige, ligado = true }) {
  porta += 1;
  await pool.query(
    `INSERT INTO download_tunnels
       (owner_type, client_user_id, label, public_key, assigned_port, connected, enabled, require_client_tunnel)
     VALUES ('client', $1, 'PC de teste', $2, $3, $4, $5, $6)`,
    [clientUserId, `chave-${porta}`, porta, conectado, ligado, exige]
  );
}

// A fila de verdade exige pg-boss no ar; o que importa aqui é o que foi
// enfileirado, não o pg-boss em si.
function comFilaFalsa(fn) {
  const original = queueService.getBoss;
  const enviados = [];
  queueService.getBoss = async () => ({ send: async (fila, dados) => enviados.push({ fila, dados }) });
  return fn(enviados).finally(() => {
    queueService.getBoss = original;
  });
}

test('computador ligado: pode baixar', async () => {
  const cliente = await createClient();
  await comTunel(cliente.id, { conectado: true, exige: true });

  const p = await downloadTunnelsRepository.clientTunnelPolicy(cliente.id);
  assert.equal(p.exige, true);
  assert.equal(p.conectado, true);
});

test('computador desligado e o cliente pediu pra esperar: segura', async () => {
  const cliente = await createClient();
  await comTunel(cliente.id, { conectado: false, exige: true });

  const p = await downloadTunnelsRepository.clientTunnelPolicy(cliente.id);
  assert.equal(p.exige && !p.conectado, true, 'é esta combinação que segura o download');
});

test('computador desligado mas o cliente NÃO pediu pra esperar: baixa pela nossa banda', async () => {
  const cliente = await createClient();
  await comTunel(cliente.id, { conectado: false, exige: false });

  const p = await downloadTunnelsRepository.clientTunnelPolicy(cliente.id);
  assert.equal(p.exige, false, 'o padrão não pode segurar a fila de quem não escolheu isso');
});

test('túnel desligado pelo admin não segura a fila do cliente', async () => {
  const cliente = await createClient();
  // O cliente marcou "esperar", mas o admin desativou o túnel dele. Ele não tem
  // como saber disso nem como religar - segurar a fila aqui deixaria os vídeos
  // parados pra sempre, sem explicação.
  await comTunel(cliente.id, { conectado: false, exige: true, ligado: false });

  const p = await downloadTunnelsRepository.clientTunnelPolicy(cliente.id);
  assert.equal(p.exige, false);
});

test('cliente sem o programa instalado nunca é segurado', async () => {
  const cliente = await createClient();
  const p = await downloadTunnelsRepository.clientTunnelPolicy(cliente.id);
  assert.deepEqual(p, { exige: false, conectado: false, temTunel: false });
});

test('vídeo que espera a conexão NÃO é erro, e volta pra fila quando o computador liga', async () => {
  const cliente = await createClient();
  await comTunel(cliente.id, { conectado: false, exige: true });
  const video = await createSourceVideo(cliente.id, { durationSeconds: 600 });

  await sourceVideosRepository.updateStatus(video.id, 'aguardando_conexao');
  const parado = await sourceVideosRepository.findById(video.id);
  assert.equal(parado.status, 'aguardando_conexao');
  assert.equal(parado.error_message, null, 'esperar não é falha - não pode virar erro');

  // O computador voltou.
  await comFilaFalsa(async (enviados) => {
    const soltos = await creditsUnlockService.unlockAwaitingTunnelForClient(cliente.id);
    assert.equal(soltos, 1);
    assert.equal(enviados.length, 1, 'tem que voltar pra fila de processamento');
    assert.equal(enviados[0].fila, 'video-processing');
    assert.equal(Number(enviados[0].dados.sourceVideoId), Number(video.id));
  });

  assert.equal((await sourceVideosRepository.findById(video.id)).status, 'detected');
});

test('desligar a exigência solta o que estava esperando', async () => {
  const cliente = await createClient();
  await comTunel(cliente.id, { conectado: false, exige: true });
  const video = await createSourceVideo(cliente.id, { durationSeconds: 600 });
  await sourceVideosRepository.updateStatus(video.id, 'aguardando_conexao');

  await downloadTunnelsRepository.setRequireClientTunnel(cliente.id, false);
  await comFilaFalsa(async () => {
    await creditsUnlockService.unlockAwaitingTunnelForClient(cliente.id);
  });

  // Sem isto, o vídeo ficaria parado esperando um computador que a pessoa acabou
  // de dizer que não quer mais esperar.
  assert.equal((await sourceVideosRepository.findById(video.id)).status, 'detected');
});

test('destravar não mexe em vídeo de outro cliente', async () => {
  const a = await createClient();
  const b = await createClient();
  await comTunel(a.id, { conectado: false, exige: true });
  const videoDeB = await createSourceVideo(b.id, { durationSeconds: 600 });
  await sourceVideosRepository.updateStatus(videoDeB.id, 'aguardando_conexao');

  await comFilaFalsa(async (enviados) => {
    await creditsUnlockService.unlockAwaitingTunnelForClient(a.id);
    assert.equal(enviados.length, 0);
  });
  assert.equal((await sourceVideosRepository.findById(videoDeB.id)).status, 'aguardando_conexao');
});

test('a escolha vai e volta do banco', async () => {
  const cliente = await createClient();
  await comTunel(cliente.id, { conectado: true, exige: false });

  await downloadTunnelsRepository.setRequireClientTunnel(cliente.id, true);
  assert.equal((await downloadTunnelsRepository.clientTunnelPolicy(cliente.id)).exige, true);

  await downloadTunnelsRepository.setRequireClientTunnel(cliente.id, false);
  assert.equal((await downloadTunnelsRepository.clientTunnelPolicy(cliente.id)).exige, false);
});
