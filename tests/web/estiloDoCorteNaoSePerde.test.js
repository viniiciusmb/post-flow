// A tela "Estilo visual do corte" é gravada por DOIS cartões diferentes
// (qualidade/quantidade e estilo visual), e os dois escrevem na MESMA linha do
// banco pela mesma rota.
//
// Relato do fundador em 22/08/2026: ele mexeu em estilo de legenda, estilo de
// título, alturas e cores, gerou um corte, e o corte saiu com a configuração
// antiga — "só o fundo do vídeo e onde ele fica que salvaram".
//
// O que estes testes cobrem:
//   - salvar só o estilo persiste o estilo;
//   - salvar o outro cartão DEPOIS não pode desfazer o estilo (perda silenciosa
//     clássica: cada cartão tem sua cópia, carregada quando a página abriu, e
//     quem salva por último vence com dados velhos);
//   - o que a renderização lê é o que foi salvo.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const pool = require('../../src/db/pool');
const { startServer, stopServer, createLoginableClient, createAgent } = require('../helpers/http');
const clientVideoSettingsRepository = require('../../src/repositories/clientVideoSettingsRepository');

let baseUrl;

test.before(async () => {
  baseUrl = await startServer();
});

test.after(async () => {
  await stopServer();
  await pool.end();
});

async function agenteLogado() {
  const cliente = await createLoginableClient();
  const agente = createAgent(baseUrl);
  await agente.login(cliente.email, cliente.password);
  return { cliente, agente };
}

test('salvar o estilo visual persiste tudo que foi escolhido', async () => {
  const { cliente, agente } = await agenteLogado();

  const atual = (await agente.get('/api/client/video-settings')).body;
  const escolhas = {
    ...atual,
    captionStyle: 'bubble_dark',
    titleStyle: 'papel_rasgado',
    captionHeightPercent: 25,
    titleHeightPercent: 12,
    captionBoxColor: '#1A2B3C',
    titleBoxColor: '#4D5E6F',
    captionFont: 'Anton',
    titleFont: 'Anton',
  };

  const salvo = await agente.put('/api/client/video-settings', escolhas);
  assert.equal(salvo.status, 200, `salvar falhou: ${salvo.text}`);

  const depois = (await agente.get('/api/client/video-settings')).body;
  assert.equal(depois.captionStyle, 'bubble_dark');
  assert.equal(depois.titleStyle, 'papel_rasgado');
  assert.equal(depois.captionHeightPercent, 25);
  assert.equal(depois.titleHeightPercent, 12);
  assert.equal(depois.captionBoxColor, '#1A2B3C');
  assert.equal(depois.titleBoxColor, '#4D5E6F');

  // E o que a renderização lê tem que ser o mesmo — é o que faltou no corte
  // real que saiu com o visual antigo.
  const paraRender = await clientVideoSettingsRepository.resolveForVideo(cliente.id, null);
  assert.equal(paraRender.caption_style, 'bubble_dark');
  assert.equal(paraRender.title_style, 'papel_rasgado');
  assert.equal(paraRender.caption_height_percent, 25);
  assert.equal(paraRender.title_height_percent, 12);
  assert.equal(paraRender.caption_box_color, '#1A2B3C');
  assert.equal(paraRender.title_box_color, '#4D5E6F');
});

test('o cartão de qualidade não desfaz o estilo salvo depois que ele abriu', async () => {
  // ESTE é o teste que reproduz o relato. Sequência real de uso:
  //   1. a página abre  -> os DOIS cartões carregam a mesma configuração;
  //   2. o cliente mexe no estilo e salva;
  //   3. o cliente mexe na quantidade de cortes e salva.
  //
  // No passo 3 o cartão de qualidade ainda tem a cópia do passo 1. A correção
  // tem duas metades que só funcionam juntas: o cartão passou a mandar SÓ os
  // campos que ele edita, e o servidor passou a preservar todo campo ausente.
  // Este teste trava a metade do servidor — a que impede a perda mesmo que
  // alguém mexa na tela depois.
  const { agente } = await agenteLogado();

  // 1. A página abre.
  const copiaDeQuandoAPaginaAbriu = (await agente.get('/api/client/video-settings')).body;

  // 2. Cartão de estilo salva as escolhas novas.
  await agente.put('/api/client/video-settings', {
    captionStyle: 'bubble_dark',
    titleStyle: 'papel_rasgado',
    captionHeightPercent: 25,
    captionBoxColor: '#1A2B3C',
    captionFont: 'Anton',
  });

  // 3. Cartão de qualidade salva só o que ele edita — com a cópia VELHA, que
  //    ainda traz a quantidade anterior. Os campos de estilo não vão junto.
  const salvou = await agente.put('/api/client/video-settings', {
    aspectRatio: copiaDeQuandoAPaginaAbriu.aspectRatio,
    framing: copiaDeQuandoAPaginaAbriu.framing,
    quality: copiaDeQuandoAPaginaAbriu.quality,
    clipLength: copiaDeQuandoAPaginaAbriu.clipLength,
    clipMode: copiaDeQuandoAPaginaAbriu.clipMode,
    maxClips: 6,
    descriptionMode: copiaDeQuandoAPaginaAbriu.descriptionMode,
    descriptionTemplate: copiaDeQuandoAPaginaAbriu.descriptionTemplate,
  });
  assert.equal(salvou.status, 200, `salvar quantidade falhou: ${salvou.text}`);

  const final = (await agente.get('/api/client/video-settings')).body;
  assert.equal(final.maxClips, 6, 'a mudança de quantidade tinha que valer');
  assert.equal(final.captionStyle, 'bubble_dark', 'salvar a quantidade apagou o estilo escolhido antes');
  assert.equal(final.titleStyle, 'papel_rasgado', 'salvar a quantidade apagou o estilo do título');
  assert.equal(final.captionHeightPercent, 25, 'a altura da legenda foi perdida ao salvar a quantidade');
  assert.equal(final.captionBoxColor, '#1A2B3C', 'a cor foi perdida ao salvar a quantidade');
});

test('salvar só um campo não zera os liga/desliga do outro cartão', async () => {
  // Booleano ausente é a armadilha silenciosa: Boolean(undefined) é false, e
  // sem cuidado salvar a quantidade DESLIGARIA o título e a numeração sem
  // ninguém pedir.
  const { agente } = await agenteLogado();

  await agente.put('/api/client/video-settings', {
    showTitle: true,
    titleSeconds: 9,
    showPartLabel: true,
    partLabelPosition: 'bottom_left',
  });

  const r = await agente.put('/api/client/video-settings', { maxClips: 5 });
  assert.equal(r.status, 200, `salvar falhou: ${r.text}`);

  const final = (await agente.get('/api/client/video-settings')).body;
  assert.equal(final.showTitle, true, 'o título foi desligado sozinho');
  assert.equal(final.showPartLabel, true, 'a numeração foi desligada sozinha');
  assert.equal(final.titleSeconds, 9);
  assert.equal(final.partLabelPosition, 'bottom_left');
  assert.equal(final.maxClips, 5);
});

test('TODO modelo oferecido na tela é aceito pelo banco', async () => {
  // O bug de 22/08: a tela mostrava 11 modelos de legenda e 12 de título, mas
  // o banco só aceitava os 5 antigos. Escolher um novo derrubava a gravação
  // com erro genérico e o cliente perdia tudo que tinha escolhido junto.
  //
  // Este teste percorre a lista que a PRÓPRIA tela oferece, então adicionar um
  // preset no código sem a migration correspondente falha aqui em vez de na
  // cara do cliente.
  const { agente } = await agenteLogado();
  const { options } = (await agente.get('/api/client/video-settings')).body;

  for (const estilo of options.captionStyles) {
    const r = await agente.put('/api/client/video-settings', { captionStyle: estilo });
    assert.equal(r.status, 200, `legenda "${estilo}" é oferecida na tela mas foi recusada: ${r.text}`);
  }

  for (const estilo of options.titleStyles) {
    const r = await agente.put('/api/client/video-settings', { titleStyle: estilo });
    assert.equal(r.status, 200, `título "${estilo}" é oferecido na tela mas foi recusado: ${r.text}`);
  }
});
