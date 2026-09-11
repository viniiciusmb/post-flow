// O custo não pode morrer junto com o vídeo.
//
// Relato do fundador (11/09/2026): a tela "Clientes" mostrava sempre ~US$ 1
// para uma conta que já tinha gastado várias vezes isso. A causa: o custo
// morava nas colunas da PRÓPRIA linha de source_videos, então apagar o vídeo
// (pela tela, pela limpeza de disco, ou em cascata) apagava a contabilidade.
// Medido em produção naquele dia: US$ 14,74 de Whisper no histórico contra
// US$ 1,35 sobrevivendo — 91% do gasto tinha evaporado.
//
// O que estes testes travam:
//   - o lançamento sobrevive ao vídeo apagado (o defeito relatado);
//   - reaproveitamento NÃO vira custo, mas continua entregando minuto;
//   - só banda de proxy PAGO vira dinheiro;
//   - reprocessar SOMA (a OpenAI cobrou duas vezes), não sobrescreve;
//   - a tela "Clientes" lê do livro, e não mais do vídeo.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const pool = require('../../src/db/pool');
const videoCostsRepository = require('../../src/repositories/videoCostsRepository');
const custoService = require('../../src/services/custoService');
const usersRepository = require('../../src/repositories/usersRepository');
const settingsRepository = require('../../src/repositories/settingsRepository');
const { createClient, createSourceVideo } = require('../helpers/db');

test.after(async () => {
  await pool.end();
});

// Janela que cobre só o que este teste criou. `resolveRange` não serve aqui:
// os testes rodam em paralelo no mesmo banco e um período amplo pegaria
// lançamento de outro arquivo.
function janela() {
  return { since: new Date(Date.now() - 60_000), until: new Date(Date.now() + 60_000) };
}

async function custoDoCliente(clientUserId) {
  const mapa = await videoCostsRepository.totalPorClienteMap(janela());
  return mapa.get(Number(clientUserId)) || null;
}

test('o custo continua existindo depois do video ser apagado', async () => {
  const cliente = await createClient();
  const video = await createSourceVideo(cliente.id, { durationSeconds: 1200 });

  await custoService.registrarTranscricao({ ...video, owner_client_user_id: cliente.id }, { custoUsd: 0.12 });
  await custoService.registrarIa({ ...video, owner_client_user_id: cliente.id }, { custoUsd: 0.05 });

  const antes = await custoDoCliente(cliente.id);
  assert.ok(Math.abs(Number(antes.total_usd) - 0.17) < 0.0001);

  await pool.query('DELETE FROM source_videos WHERE id = $1', [video.id]);

  const depois = await custoDoCliente(cliente.id);
  assert.ok(depois, 'o lancamento sumiu junto com o video - e exatamente o defeito relatado');
  assert.ok(
    Math.abs(Number(depois.total_usd) - 0.17) < 0.0001,
    `o custo mudou depois de apagar o video: ${depois.total_usd}`
  );

  // O vínculo com o vídeo vira NULL, mas o dono e o valor ficam.
  const { rows } = await pool.query(
    'SELECT source_video_id, client_user_id FROM video_costs WHERE client_user_id = $1',
    [cliente.id]
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].source_video_id, null);
  assert.equal(Number(rows[0].client_user_id), Number(cliente.id));
});

test('reaproveitamento nao gera custo, mas entrega minuto', async () => {
  const cliente = await createClient();
  const video = await createSourceVideo(cliente.id, { durationSeconds: 600 });
  const sv = { ...video, owner_client_user_id: cliente.id };

  await custoService.registrarDownload(sv, { bytes: 0, egressType: 'reuse' });
  await custoService.registrarTranscricao(sv, { custoUsd: 0, reused: true });

  const resumo = await videoCostsRepository.resumo(janela());
  const linha = await custoDoCliente(cliente.id);

  assert.equal(Number(linha.total_usd), 0, 'reaproveitar nao pode custar nada');
  assert.ok(Number(resumo.segundos_reaproveitados) >= 600, 'o minuto entregue tem que continuar contando');
});

test('so banda de proxy PAGO vira dinheiro', async () => {
  await settingsRepository.setValue('custo_banda_por_gb_usd', 1);
  const porTunel = await createClient();
  const porProxy = await createClient();
  const umGb = 1073741824;

  const v1 = await createSourceVideo(porTunel.id, { durationSeconds: 600 });
  const v2 = await createSourceVideo(porProxy.id, { durationSeconds: 600 });

  await custoService.registrarDownload({ ...v1, owner_client_user_id: porTunel.id }, {
    bytes: umGb,
    egressType: 'founder_tunnel',
  });
  await custoService.registrarDownload({ ...v2, owner_client_user_id: porProxy.id }, {
    bytes: umGb,
    egressType: 'proxy',
  });

  const tunel = await custoDoCliente(porTunel.id);
  const proxy = await custoDoCliente(porProxy.id);

  assert.equal(Number(tunel.banda_usd), 0, 'tunel ja esta pago na conta de internet - cobrar aqui inventa custo');
  assert.ok(Math.abs(Number(proxy.banda_usd) - 1) < 0.0001, `1 GB por proxy pago deveria custar US$ 1: ${proxy.banda_usd}`);
});

test('reprocessar SOMA o custo em vez de sobrescrever', async () => {
  // Se o Whisper foi chamado duas vezes, a OpenAI cobrou duas vezes. A coluna
  // antiga em source_videos sobrescrevia e mostrava só a última chamada.
  const cliente = await createClient();
  const video = await createSourceVideo(cliente.id, { durationSeconds: 600 });
  const sv = { ...video, owner_client_user_id: cliente.id };

  await custoService.registrarTranscricao(sv, { custoUsd: 0.06 });
  await custoService.registrarTranscricao(sv, { custoUsd: 0.06 });

  const linha = await custoDoCliente(cliente.id);
  assert.ok(Math.abs(Number(linha.whisper_usd) - 0.12) < 0.0001, `esperava 0.12, veio ${linha.whisper_usd}`);
  // Mas a duração não pode somar: é o mesmo vídeo, e ela é o denominador do
  // custo por minuto.
  assert.equal(Number(linha.segundos), 600, 'a duracao do video nao pode ser contada duas vezes');
});

test('custo por minuto NOVO ignora os videos reaproveitados', async () => {
  const cliente = await createClient();
  const novo = await createSourceVideo(cliente.id, { durationSeconds: 600 });
  const reaproveitado = await createSourceVideo(cliente.id, { durationSeconds: 600 });

  await custoService.registrarTranscricao({ ...novo, owner_client_user_id: cliente.id }, { custoUsd: 0.06 });
  await custoService.registrarDownload({ ...reaproveitado, owner_client_user_id: cliente.id }, {
    bytes: 0,
    egressType: 'reuse',
  });
  await custoService.registrarTranscricao({ ...reaproveitado, owner_client_user_id: cliente.id }, {
    custoUsd: 0,
    reused: true,
  });

  const r = await videoCostsRepository.resumo(janela());
  const porMinutoNovo = Number(r.total_novos_usd) / (Number(r.segundos_novos) / 60);
  const porMinutoEntregue = Number(r.total_usd) / (Number(r.segundos_entregues) / 60);

  assert.ok(
    porMinutoNovo > porMinutoEntregue,
    'o custo do video NOVO tem que ser maior que a media com reaproveitamento - ' +
      'precificar pela media entregaria processamento abaixo do custo'
  );
});

test('a tela "Clientes" mostra o custo mesmo com o video apagado', async () => {
  const cliente = await createClient({ businessName: 'Cliente do livro' });
  const video = await createSourceVideo(cliente.id, { durationSeconds: 1200 });

  await custoService.registrarTranscricao({ ...video, owner_client_user_id: cliente.id }, { custoUsd: 0.25 });
  await pool.query('DELETE FROM source_videos WHERE id = $1', [video.id]);

  const { since, until } = janela();
  const linhas = await usersRepository.listClientsWithStats({ since, until });
  const linha = linhas.find((l) => Number(l.id) === Number(cliente.id));

  assert.ok(linha, 'o cliente sumiu da lista');
  assert.ok(
    Math.abs(Number(linha.custo_usd) - 0.25) < 0.0001,
    `a tela voltou a ler o custo do video apagado: ${linha.custo_usd}`
  );
});
