// A pasta de destino do Drive passou a ser CRIADA por nós (01/09/2026).
//
// Relato do fundador: "ao tentar adicionar uma pasta do drive dá erro e não é
// possível enviar os vídeos para o drive".
//
// A causa, confirmada contra a API real do Google com a conexão de um cliente
// de verdade: desde 02/08/2026 o único escopo que pedimos é `drive.file`, que
// dá acesso APENAS aos arquivos que o próprio Post Flow criou. Uma pasta que o
// cliente fez à mão e colou o link responde **404 File not found** — nem
// "sem permissão": ela simplesmente não existe do nosso ponto de vista. O link
// era aceito, gravado, e os cortes nunca chegavam lá.
//
// Voltar a aceitar pasta existente exigiria o escopo restrito `drive.readonly`,
// que custa auditoria de segurança paga TODO ANO, ou o seletor do próprio
// Google. Criar a pasta nós mesmos não custa nada disso.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const pool = require('../../src/db/pool');
const googleService = require('../../src/services/googleService');
const driveExportFolderService = require('../../src/services/driveExportFolderService');
const driveFoldersRepository = require('../../src/repositories/driveFoldersRepository');
const driveConnectionsRepository = require('../../src/repositories/driveConnectionsRepository');
const { createClient, createYoutubeChannel } = require('../helpers/db');

test.after(async () => {
  await pool.end();
});

// Um Drive de mentira que se comporta como o de verdade: só enxerga o que ELE
// criou. É essa regra que o teste precisa reproduzir — sem ela, qualquer
// implementação passaria.
function comDriveFalso(fn) {
  const originais = {
    createFolder: googleService.createFolder,
    getFolder: googleService.getFolder,
    getValidAccessToken: driveConnectionsRepository.getValidAccessToken,
  };
  const criadasPorNos = new Set();
  const chamadas = { criar: 0, conferir: 0 };

  driveConnectionsRepository.getValidAccessToken = async () => 'token-de-teste';
  googleService.createFolder = async (_token, name) => {
    chamadas.criar += 1;
    const id = `pasta_${chamadas.criar}_${Date.now()}`;
    criadasPorNos.add(id);
    return { id, name, webViewLink: `https://drive.google.com/drive/folders/${id}` };
  };
  googleService.getFolder = async (_token, id) => {
    chamadas.conferir += 1;
    // A regra do drive.file: o que não foi criado por nós não existe.
    if (!criadasPorNos.has(id)) return null;
    return { id, name: 'pasta', webViewLink: `https://drive.google.com/drive/folders/${id}` };
  };

  return fn({ chamadas, criadasPorNos }).finally(() => {
    Object.assign(googleService, { createFolder: originais.createFolder, getFolder: originais.getFolder });
    driveConnectionsRepository.getValidAccessToken = originais.getValidAccessToken;
  });
}

async function clienteComDrive() {
  const cliente = await createClient();
  const canal = await createYoutubeChannel(cliente.id, { name: 'Manual do Mundo' });
  const { rows } = await pool.query(
    `INSERT INTO drive_connections (owner_user_id, google_account_email, access_token_encrypted, access_token_iv,
       refresh_token_encrypted, refresh_token_iv, token_expires_at)
     VALUES ($1,'x@y.com','a','b','c','d', now() + interval '1 hour') RETURNING *`,
    [cliente.id]
  );
  return { cliente, canal, connection: rows[0] };
}

test('a pasta é criada por nós, com o nome do canal', async () => {
  const { canal, connection } = await clienteComDrive();

  await comDriveFalso(async ({ chamadas }) => {
    const pasta = await driveExportFolderService.garantirPasta(canal, connection);
    assert.equal(chamadas.criar, 1);
    assert.equal(pasta.criada, true);
    assert.match(pasta.name, /Manual do Mundo/, 'o nome tem que dizer de que canal é a pasta');
    assert.ok(pasta.webViewLink, 'sem o link, o cliente não sabe onde a pasta foi parar');
  });

  const salva = await driveFoldersRepository.findExportFolderByChannelId(canal.id);
  assert.ok(salva, 'a pasta criada precisa ficar gravada');
  assert.equal(salva.type, 'client_export');
});

test('chamar de novo reaproveita a pasta, não cria outra', async () => {
  const { canal, connection } = await clienteComDrive();

  await comDriveFalso(async ({ chamadas }) => {
    const primeira = await driveExportFolderService.garantirPasta(canal, connection);
    const segunda = await driveExportFolderService.garantirPasta(canal, connection);

    assert.equal(chamadas.criar, 1, 'criou uma pasta nova a cada clique — o Drive do cliente viraria um lixão');
    assert.equal(segunda.id, primeira.id);
    assert.equal(segunda.criada, false, 'a tela precisa saber que a pasta já existia');
  });
});

test('pasta cadastrada por LINK antes desta correção é substituída sozinha', async () => {
  // São as linhas que já estão em produção: um id que o cliente colou e que o
  // Post Flow nunca conseguiu enxergar. Sem esta cura, a tela continuaria
  // mostrando "pasta configurada" e nenhum corte chegaria lá — para sempre.
  const { canal, connection } = await clienteComDrive();
  await driveFoldersRepository.upsertChannelExportFolder({
    youtubeChannelId: canal.id,
    driveFolderId: '1sU49v3L6pQ4uyl8Ba3vtaDByMJX_-t9E', // colada à mão, invisível pra nós
    folderName: null,
    connectionId: connection.id,
  });

  await comDriveFalso(async ({ chamadas }) => {
    const pasta = await driveExportFolderService.garantirPasta(canal, connection);
    assert.equal(chamadas.conferir, 1, 'nem conferiu se a pasta antiga funcionava');
    assert.equal(pasta.criada, true, 'reaproveitou uma pasta que o Google não enxerga');
    assert.notEqual(pasta.id, '1sU49v3L6pQ4uyl8Ba3vtaDByMJX_-t9E');
  });

  const salva = await driveFoldersRepository.findExportFolderByChannelId(canal.id);
  assert.notEqual(salva.drive_folder_id, '1sU49v3L6pQ4uyl8Ba3vtaDByMJX_-t9E', 'o id quebrado continuou gravado');
});

test('pasta apagada pelo cliente vira uma pasta nova', async () => {
  const { canal, connection } = await clienteComDrive();

  await comDriveFalso(async ({ chamadas, criadasPorNos }) => {
    const primeira = await driveExportFolderService.garantirPasta(canal, connection);
    criadasPorNos.delete(primeira.id); // o cliente apagou a pasta no Drive
    const segunda = await driveExportFolderService.garantirPasta(canal, connection);

    assert.equal(chamadas.criar, 2);
    assert.notEqual(segunda.id, primeira.id, 'continuou apontando pra uma pasta que não existe mais');
  });
});

test('conexão morta dá erro explicado, não erro genérico', async () => {
  const { canal, connection } = await clienteComDrive();
  const original = driveConnectionsRepository.getValidAccessToken;
  driveConnectionsRepository.getValidAccessToken = async () => null;
  try {
    await assert.rejects(
      () => driveExportFolderService.garantirPasta(canal, connection),
      /Reconecte/,
      'o cliente precisa saber que a saída é reconectar o Drive'
    );
  } finally {
    driveConnectionsRepository.getValidAccessToken = original;
  }
});

// ---------------------------------------------------------------------------
// A varredura de pastas do Drive
// ---------------------------------------------------------------------------
//
// Sintoma em produção (01/09/2026): o log do worker mostrava "Checando pastas
// do Drive..." TRÊS vezes a cada 5 minutos e NUNCA "Checagem concluída". Uma
// conexão Google antiga (refresh token revogado) lançava no meio do laço, o
// run() morria ali, e o pg-boss repetia 3 vezes — para sempre. Nenhum erro
// aparecia no log: só a repetição.
//
// Duas consequências, e a segunda é a pior: as pastas DEPOIS da quebrada nunca
// eram processadas.

const driveDiscoveryJob = require('../../src/worker/jobs/driveDiscoveryJob');

test('uma pasta com problema não derruba a varredura das outras', async () => {
  const original = driveFoldersRepository.listAll;
  const vistas = [];
  driveFoldersRepository.listAll = async () => [
    { id: 1, type: 'client', connection_id: 999, drive_folder_id: 'quebrada', folder_name: 'quebrada' },
    { id: 2, type: 'client', connection_id: 998, drive_folder_id: 'boa', folder_name: 'boa' },
  ];
  const originalConn = driveConnectionsRepository.findById;
  driveConnectionsRepository.findById = async (id) => {
    vistas.push(id);
    // A primeira conexão está morta, igual à de produção.
    if (id === 999) throw new Error('Google recusou a solicitacao de token: Bad Request');
    return null; // a segunda só não tem token válido — o job pula e segue
  };

  try {
    await driveDiscoveryJob.run(); // não pode lançar
    assert.deepEqual(vistas, [999, 998], 'a pasta seguinte à quebrada nunca foi processada');
  } finally {
    driveFoldersRepository.listAll = original;
    driveConnectionsRepository.findById = originalConn;
  }
});

test('a varredura não toca nas pastas de DESTINO', async () => {
  // Pasta de destino não tem nada pra descobrir: o job estava listando arquivos
  // dentro dela, uma chamada inútil ao Google por pasta, a cada 5 minutos.
  const original = driveFoldersRepository.listAll;
  const vistas = [];
  driveFoldersRepository.listAll = async () => [
    { id: 1, type: 'client_export', connection_id: 1, drive_folder_id: 'destino', folder_name: 'destino' },
    { id: 2, type: 'client', connection_id: 2, drive_folder_id: 'origem', folder_name: 'origem' },
  ];
  const originalConn = driveConnectionsRepository.findById;
  driveConnectionsRepository.findById = async (id) => {
    vistas.push(id);
    return null;
  };

  try {
    await driveDiscoveryJob.run();
    assert.deepEqual(vistas, [2], 'a varredura foi olhar uma pasta de destino');
  } finally {
    driveFoldersRepository.listAll = original;
    driveConnectionsRepository.findById = originalConn;
  }
});
