// Vídeo narrado a partir de um roteiro (modo de teste, só admin).
//
// O que estes testes travam, e por que cada um existe:
//
//   - a duração de cada cena vem do ARQUIVO de áudio dela, nunca de alinhar
//     texto com transcrição (é a decisão central do desenho);
//   - o modo "econômico" não gasta com IA quando o acervo serve, e o modo
//     "qualidade" respeita o palpite da IA — é a diferença que o fundador quer
//     poder comparar, e sem ela os dois botões seriam o mesmo botão;
//   - acervo vazio cai na IA nos DOIS modos (3 de 6 buscas da amostra real
//     voltaram vazias — sem esse caminho o vídeo teria buracos);
//   - imagem com licença proibida não entra (é o que protege quem publica);
//   - o custo do vídeo narrado NÃO contamina o custo por minuto do pipeline
//     de cortes (mesmo erro já corrigido uma vez em stageTimingsSince);
//   - a posse da geração é atômica (dois jobs no mesmo segundo já processaram
//     o mesmo vídeo neste projeto, em 01/09/2026).
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { mock } = require('node:test');

const pool = require('../../src/db/pool');
const roteiroEmCenas = require('../../src/lib/roteiroEmCenas');
const licenca = require('../../src/lib/licencaDeImagem');
const imageSearchService = require('../../src/services/imageSearchService');
const imageGenerationService = require('../../src/services/imageGenerationService');
const renderService = require('../../src/services/narratedVideoRenderService');
const narratedVideoJob = require('../../src/worker/videoJobs/narratedVideoJob');
const narratedVideosRepository = require('../../src/repositories/narratedVideosRepository');
const videoCostsRepository = require('../../src/repositories/videoCostsRepository');
const custoService = require('../../src/services/custoService');
const { createClient, createSourceVideo } = require('../helpers/db');

test.after(async () => {
  await pool.end();
});

function janela() {
  return { since: new Date(Date.now() - 60_000), until: new Date(Date.now() + 60_000) };
}

async function criarVideoNarrado(adminUserId, extra = {}) {
  return narratedVideosRepository.create({
    adminUserId,
    title: 'A Peste Negra',
    script: 'Em outubro de 1347, doze navios atracaram na Sicília. A maior parte dos marinheiros estava morta.',
    aspect: '16:9',
    imagePolicy: 'economico',
    voiceProvider: 'openai',
    voiceId: 'onyx',
    burnCaptions: true,
    musicMood: null,
    ...extra,
  });
}

// ---------------------------------------------------------------------------
// Divisão do roteiro
// ---------------------------------------------------------------------------

test('divide o roteiro em cenas dentro dos limites de duracao', () => {
  const paragrafo = 'Em outubro de 1347, doze navios genoveses atracaram no porto da Sicilia. '
    + 'A maior parte dos marinheiros a bordo estava morta. '
    + 'Os que ainda respiravam carregavam buboes negros pelo corpo. '
    + 'Em menos de cinco anos, a peste mataria um terco da Europa.';
  const cenas = roteiroEmCenas.dividir(`${paragrafo}\n\n${paragrafo}`);

  assert.ok(cenas.length >= 2, 'dois paragrafos tem que virar pelo menos duas cenas');
  for (const c of cenas) {
    assert.ok(c.text.length <= roteiroEmCenas.MAX_CHARS, `cena longa demais: ${c.text.length}`);
  }
  // Os índices são a identidade da cena no resto do pipeline (é por eles que a
  // resposta da IA é casada); precisam ser sequenciais a partir de zero.
  assert.deepEqual(cenas.map((c) => c.idx), cenas.map((_, i) => i));
});

test('cena curta demais e absorvida pela vizinha, para a imagem nao piscar', () => {
  const cenas = roteiroEmCenas.dividir('Sim. Foi assim que a Europa medieval encontrou o seu fim mais sombrio, e ninguem soube explicar o porque.');
  assert.equal(cenas.length, 1, '"Sim." sozinho viraria uma imagem de meio segundo');
});

test('texto sem pontuacao nenhuma ainda e partido, e nunca no meio de uma palavra', () => {
  const cenas = roteiroEmCenas.dividir('palavra '.repeat(120).trim());
  assert.ok(cenas.length > 1);
  for (const c of cenas) {
    assert.ok(c.text.length <= roteiroEmCenas.MAX_CHARS);
    assert.ok(!c.text.startsWith('avra') && !c.text.endsWith('pal'), 'cortou no meio de uma palavra');
  }
});

// ---------------------------------------------------------------------------
// Licença — o que protege quem publica o vídeo
// ---------------------------------------------------------------------------

test('licenca: aceita dominio publico e CC BY, recusa share-alike e nao-comercial', () => {
  assert.equal(licenca.permitida('Public domain'), true);
  assert.equal(licenca.permitida('CC0'), true);
  assert.equal(licenca.permitida('CC BY 4.0'), true);
  assert.equal(licenca.permitida('cc0'), true);

  // A ordem do teste importa: "by-sa" CONTÉM "by". Se as aceitas fossem
  // testadas primeiro, todo CC BY-SA entraria — e é exatamente a licença que
  // obrigaria licenciar o vídeo inteiro do mesmo jeito.
  assert.equal(licenca.permitida('CC BY-SA 4.0'), false);
  assert.equal(licenca.permitida('CC BY-NC 2.0'), false);
  assert.equal(licenca.permitida('CC BY-NC-SA 3.0'), false);
  assert.equal(licenca.permitida('CC BY-ND 4.0'), false);
  assert.equal(licenca.permitida(''), false);
  assert.equal(licenca.permitida('sei la'), false);
});

test('licenca: banco livre entra pela FONTE, porque nao tem codigo de licenca', () => {
  assert.equal(licenca.permitida('Pexels License', { fonte: 'pexels' }), true);
  assert.equal(licenca.permitida('', { fonte: 'unsplash' }), true);
  assert.equal(licenca.permitida('', { fonte: 'site-qualquer' }), false);
});

test('a escolha do acervo descarta licenca proibida, imagem pequena e repetida', () => {
  const usadas = new Set(['ja-usei.jpg']);
  const escolhida = imageSearchService.melhorDaLista(
    [
      { url: 'enorme-mas-sa.jpg', width: 6000, height: 4000, license: 'CC BY-SA 4.0', source: 'wikimedia' },
      { url: 'ja-usei.jpg', width: 5000, height: 4000, license: 'Public domain', source: 'wikimedia' },
      { url: 'minusculo.jpg', width: 200, height: 150, license: 'Public domain', source: 'wikimedia' },
      { url: 'boa.jpg', width: 1600, height: 1200, license: 'Public domain', source: 'wikimedia' },
    ],
    usadas
  );
  assert.equal(escolhida.url, 'boa.jpg', 'a maior era CC BY-SA e nao podia entrar');
});

// ---------------------------------------------------------------------------
// Política de imagem — os dois botões da tela
// ---------------------------------------------------------------------------

function mockarFontes({ acervoDevolve }) {
  const chamadas = { busca: 0, ia: 0 };

  mock.method(imageSearchService, 'buscar', async () => {
    chamadas.busca += 1;
    return acervoDevolve
      ? { url: 'https://exemplo/imagem.jpg', license: 'Public domain', credit: 'Gravura — Public domain' }
      : null;
  });

  mock.method(imageGenerationService, 'gerar', async (_prompt, destino) => {
    chamadas.ia += 1;
    return { path: destino, custoUsd: 0.011, license: 'Gerada por IA', credit: 'Imagem gerada por IA', source: 'ia' };
  });

  // O download da imagem do acervo passa pelo fetch global.
  mock.method(globalThis, 'fetch', async () => ({
    ok: true,
    status: 200,
    arrayBuffer: async () => new ArrayBuffer(8),
  }));

  return chamadas;
}

const CENA = {
  idx: 0,
  image_query: 'Black Death plague 1348',
  image_prompt: 'dark medieval street, plague',
};

test('modo economico NAO gasta com IA quando o acervo devolve imagem boa', async (t) => {
  const chamadas = mockarFontes({ acervoDevolve: true });
  t.after(() => mock.restoreAll());

  const r = await narratedVideoJob.resolverImagem(
    { ...CENA, preferir: 'ia' }, // mesmo com a IA preferindo desenhar...
    { policy: 'economico', aspect: '16:9', pasta: '/tmp', usadas: new Set() }
  );

  assert.equal(r.imageSource, 'acervo');
  assert.equal(r.custoUsd, 0);
  assert.equal(chamadas.ia, 0, 'o modo economico nao pode chamar a IA com acervo disponivel');
});

test('modo qualidade respeita o palpite da IA e desenha a cena', async (t) => {
  const chamadas = mockarFontes({ acervoDevolve: true });
  t.after(() => mock.restoreAll());

  const r = await narratedVideoJob.resolverImagem(
    { ...CENA, preferir: 'ia' },
    { policy: 'qualidade', aspect: '16:9', pasta: '/tmp', usadas: new Set() }
  );

  assert.equal(r.imageSource, 'ia');
  assert.ok(r.custoUsd > 0, 'imagem desenhada custa dinheiro e isso tem que ser registrado');
  assert.equal(chamadas.busca, 0, 'preferindo IA, nem consultou o acervo');
});

test('modo qualidade ainda usa o acervo quando a IA prefere acervo', async (t) => {
  const chamadas = mockarFontes({ acervoDevolve: true });
  t.after(() => mock.restoreAll());

  const r = await narratedVideoJob.resolverImagem(
    { ...CENA, preferir: 'acervo' },
    { policy: 'qualidade', aspect: '16:9', pasta: '/tmp', usadas: new Set() }
  );

  assert.equal(r.imageSource, 'acervo');
  assert.equal(chamadas.ia, 0);
});

test('acervo vazio cai na IA nos DOIS modos - sem isso a cena fica sem imagem', async (t) => {
  t.after(() => mock.restoreAll());

  for (const policy of ['economico', 'qualidade']) {
    mock.restoreAll();
    mockarFontes({ acervoDevolve: false });
    const r = await narratedVideoJob.resolverImagem(
      { ...CENA, preferir: 'acervo' },
      { policy, aspect: '16:9', pasta: '/tmp', usadas: new Set() }
    );
    assert.equal(r.imageSource, 'ia', `modo ${policy} deixou a cena sem imagem`);
  }
});

// ---------------------------------------------------------------------------
// Montagem
// ---------------------------------------------------------------------------

test('as transicoes acompanham a duracao REAL de cada cena', () => {
  // Cenas de tamanhos diferentes (é o caso normal: cada uma tem o tamanho da
  // fala dela). Um passo fixo faria imagem e narração se descolarem ao longo
  // do vídeo, e o erro cresce a cada cena.
  const { filtro, saida } = renderService.cadeiaDeTransicoes([10, 4, 7]);

  assert.match(filtro, /offset=10\.000/, 'a 2a cena entra quando a 1a (10s) termina');
  assert.match(filtro, /offset=14\.000/, 'a 3a entra em 10+4, nao em 20');
  assert.equal(saida, '[x2]');
});

test('o filtro muda de verdade entre 16:9 e 9:16', () => {
  const horizontal = renderService.filtroDaCena(0, 5, renderService.SAIDAS['16:9']);
  const vertical = renderService.filtroDaCena(0, 5, renderService.SAIDAS['9:16']);

  assert.match(horizontal, /s=1920x1080/);
  assert.match(vertical, /s=1080x1920/);
  // O fundo desfocado tem que existir nos dois: quase toda gravura histórica é
  // vertical, e sem ele sobrariam tarjas pretas no formato horizontal.
  assert.match(horizontal, /boxblur/);
  assert.match(vertical, /boxblur/);
});

// ---------------------------------------------------------------------------
// Contabilidade
// ---------------------------------------------------------------------------

test('o custo do video narrado acumula etapa por etapa e sobrevive ao video apagado', async () => {
  const admin = await createClient();
  const video = await criarVideoNarrado(admin.id);

  await custoService.registrarNarrado(video, { iaUsd: 0.05, videoSeconds: 600 });
  await custoService.registrarNarrado(video, { ttsUsd: 0.15, videoSeconds: 600 });
  await custoService.registrarNarrado(video, { imagemUsd: 0.033, whisperUsd: 0.06 });

  const lancamento = await videoCostsRepository.doNarrado(video.id);
  assert.equal(Number(lancamento.ia_usd), 0.05);
  assert.equal(Number(lancamento.tts_usd), 0.15);
  assert.equal(Number(lancamento.imagem_usd), 0.033);
  assert.equal(Number(lancamento.whisper_usd), 0.06);
  // A duração não acumula: é a mesma do vídeo, repetida a cada etapa.
  assert.equal(Number(lancamento.video_seconds), 600);

  await narratedVideosRepository.remove(video.id, admin.id);

  const { rows } = await pool.query('SELECT * FROM video_costs WHERE id = $1', [lancamento.id]);
  assert.equal(rows.length, 1, 'o lancamento tem que sobreviver ao video apagado');
  assert.equal(rows[0].narrated_video_id, null, 'ON DELETE SET NULL, nunca CASCADE');
  assert.equal(Number(rows[0].tts_usd), 0.15, 'e o valor continua la');
});

test('video narrado NAO contamina o custo por minuto do pipeline de cortes', async () => {
  const cliente = await createClient();
  const admin = await createClient();

  // Um vídeo de corte de verdade: 10 minutos, US$ 0,10.
  const corte = await createSourceVideo(cliente.id, { durationSeconds: 600 });
  await custoService.registrarTranscricao(
    { id: corte.id, client_user_id: cliente.id, duration_seconds: 600 },
    { custoUsd: 0.1 }
  );

  const antes = await videoCostsRepository.resumo(janela());

  // Agora um vídeo NARRADO caro e longo. Se ele entrasse nas mesmas contas, o
  // denominador de segundos subiria e a tela passaria a dizer que cortar
  // ficou mais barato — um número plausível e errado, que é o pior tipo.
  const narrado = await criarVideoNarrado(admin.id);
  await custoService.registrarNarrado(narrado, { ttsUsd: 5, imagemUsd: 3, videoSeconds: 1800 });

  const depois = await videoCostsRepository.resumo(janela());

  assert.equal(
    Number(depois.segundos_entregues),
    Number(antes.segundos_entregues),
    'os segundos do pipeline de cortes nao podem mudar por causa de um video narrado'
  );
  assert.equal(Number(depois.segundos_novos), Number(antes.segundos_novos));
  assert.equal(
    Number(depois.total_usd).toFixed(6),
    Number(antes.total_usd).toFixed(6),
    'o custo do pipeline de cortes tambem nao'
  );

  // Mas ele aparece, em campo próprio — custo escondido é como US$ 16 em IA
  // queimaram sem ninguém notar nesta VPS.
  assert.ok(Number(depois.total_narrado_usd) >= 8, 'o custo narrado precisa aparecer em algum lugar');
  assert.ok(Number(depois.videos_narrados) >= 1);
});

test('o custo do video narrado nao entra no custo POR CLIENTE da tela de Clientes', async () => {
  const admin = await createClient();
  const video = await criarVideoNarrado(admin.id);
  await custoService.registrarNarrado(video, { ttsUsd: 2, videoSeconds: 600 });

  const mapa = await videoCostsRepository.totalPorClienteMap(janela());
  assert.equal(mapa.get(Number(admin.id)), undefined, 'video narrado do admin nao e custo de cliente');
});

// ---------------------------------------------------------------------------
// Concorrência
// ---------------------------------------------------------------------------

test('so UM job consegue tomar posse da geracao, mesmo com dez tentando junto', async () => {
  const admin = await createClient();
  const video = await criarVideoNarrado(admin.id);

  const resultados = await Promise.all(
    Array.from({ length: 10 }, () => narratedVideosRepository.claimForProcessing(video.id))
  );

  const vencedores = resultados.filter(Boolean);
  assert.equal(vencedores.length, 1, 'dois jobs no mesmo video apagam o arquivo um do outro');
  assert.equal(vencedores[0].status, 'roteirizando');
  assert.equal(vencedores[0].attempts, 1, 'a tentativa tem que ser contada uma vez so');
});

test('video travado e recuperado pelo SINAL DE VIDA, nao pelo tempo desde que comecou', async () => {
  const admin = await createClient();
  const recente = await criarVideoNarrado(admin.id);
  const abandonado = await criarVideoNarrado(admin.id);

  await narratedVideosRepository.claimForProcessing(recente.id);
  await narratedVideosRepository.claimForProcessing(abandonado.id);

  // O abandonado ficou sem bater ponto; o recente acabou de bater.
  await pool.query(
    "UPDATE narrated_videos SET processing_heartbeat_at = now() - interval '40 minutes' WHERE id = $1",
    [abandonado.id]
  );

  const travados = await narratedVideosRepository.findStuck({ silencioMinutos: 15 });
  const ids = travados.map((v) => Number(v.id));

  assert.ok(ids.includes(Number(abandonado.id)), 'quem parou de dar sinal tem que ser recuperado');
  assert.ok(
    !ids.includes(Number(recente.id)),
    'quem esta trabalhando agora nao pode ser reiniciado no meio - os deploys sao start-first'
  );
});
