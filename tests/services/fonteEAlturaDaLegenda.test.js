// Fonte e altura da legenda/título.
//
// Antes disso, TODA legenda saía numa fonte que ninguém escolheu: os estilos
// pediam "Arial Black" e o container só tinha DejaVu instalado. O libass não
// reclama disso — ele troca por outra fonte em silêncio. Ou seja, a tela
// mostrava um visual e o vídeo saía com outro, sem erro em lugar nenhum.
//
// O que estes testes travam:
//   - a fonte escolhida chega ao arquivo de legenda;
//   - fonte que não existe no servidor NUNCA passa (cai no padrão);
//   - a altura vira distância até a borda certa (legenda de baixo, título de
//     cima) e respeita o teto;
//   - os modelos com caixa colorida usam mesmo o modo de caixa do ASS.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const v = require('../../src/services/videoEditingService');

const PALAVRAS = [
  { word: 'ola', start: 0, end: 0.5 },
  { word: 'mundo', start: 0.5, end: 1.2 },
];

function estilos(opcoes = {}, captionStyle = 'classic', titleStyle = 'classic') {
  const ass = v.buildAssSubtitles(PALAVRAS, captionStyle, titleStyle, 'TITULO', 3, null, 'top_right', 30, opcoes);
  const linhas = ass.split('\n').filter((l) => l.startsWith('Style:'));
  const porNome = {};
  for (const l of linhas) {
    const campos = l.replace('Style: ', '').split(',');
    porNome[campos[0]] = {
      fonte: campos[1],
      tamanho: Number(campos[2]),
      corLetra: campos[3],
      corCaixa: campos[6],
      // Ordem do formato ASS: 15=BorderStyle, 16=Outline, 18=Alignment,
      // 21=MarginV. Errar um índice aqui faz o teste medir outro campo e
      // passar (ou falhar) pelo motivo errado.
      borderStyle: Number(campos[15]),
      alinhamento: Number(campos[18]),
      margemV: Number(campos[21]),
    };
  }
  return porNome;
}

test('a fonte escolhida chega no arquivo de legenda', () => {
  const e = estilos({ captionFont: 'Bebas Neue', titleFont: 'Poppins' });
  assert.equal(e.Default.fonte, 'Bebas Neue');
  assert.equal(e.Title.fonte, 'Poppins');
});

test('fonte que não existe no servidor cai no padrão, nunca vaza', () => {
  // O libass trocaria em silêncio; a checagem tem que acontecer antes.
  const e = estilos({ captionFont: 'Comic Sans MS', titleFont: 'Arial Black' });
  assert.equal(e.Default.fonte, v.FONTE_PADRAO);
  assert.equal(e.Title.fonte, v.FONTE_PADRAO);
});

test('todas as fontes oferecidas na tela são aceitas', () => {
  for (const fonte of Object.keys(v.FONTES)) {
    const e = estilos({ captionFont: fonte });
    assert.equal(e.Default.fonte, fonte, `${fonte} deveria ser aceita`);
  }
});

test('altura vira distância até a borda certa', () => {
  // Legenda sobe a partir de BAIXO (alinhamento 2), título desce a partir de
  // CIMA (alinhamento 8). Nos dois casos MarginV é a distância até a borda do
  // lado do alinhamento - é isso que faz a barra se comportar como esperado.
  const e = estilos({ captionHeightPercent: 25, titleHeightPercent: 10 });
  assert.equal(e.Default.alinhamento, 2);
  assert.equal(e.Title.alinhamento, 8);
  assert.equal(e.Default.margemV, Math.round(0.25 * 1920));
  assert.equal(e.Title.margemV, Math.round(0.1 * 1920));
});

test('altura absurda é limitada em vez de jogar o texto pra fora do quadro', () => {
  assert.equal(v.margemVertical(200, 14), Math.round(0.8 * 1920));
  assert.equal(v.margemVertical(-50, 14), 0);
  assert.equal(v.margemVertical('abc', 14), Math.round(0.14 * 1920), 'valor inválido usa o padrão');
});

test('modelo com caixa colorida usa mesmo o modo de caixa do ASS', () => {
  // BorderStyle 3 = retângulo sólido atrás do texto; 1 = só contorno.
  const comCaixa = estilos({}, 'amarelo_caixa', 'vermelho_forte');
  assert.equal(comCaixa.Default.borderStyle, 3);
  assert.equal(comCaixa.Title.borderStyle, 3);
  assert.notEqual(comCaixa.Default.corCaixa, '&H00000000', 'a caixa precisa de cor');

  const semCaixa = estilos({}, 'classic', 'classic');
  assert.equal(semCaixa.Default.borderStyle, 1);
});

test('os modelos novos existem e são distintos entre si', () => {
  const novos = ['neon_verde', 'vermelho_forte', 'amarelo_caixa', 'branco_caixa', 'contorno_grosso'];
  for (const nome of novos) {
    assert.ok(v.CAPTION_STYLES[nome], `falta o modelo de legenda ${nome}`);
    assert.ok(v.TITLE_STYLES[nome], `falta o modelo de título ${nome}`);
  }
  // Dois modelos que renderizam igual são uma escolha sem sentido na tela.
  const assinaturas = Object.entries(v.CAPTION_STYLES).map(([, p]) =>
    [p.tamanho, p.corLetra, p.caixa, p.corCaixa, p.contorno].join('|')
  );
  assert.equal(new Set(assinaturas).size, assinaturas.length, 'há dois modelos de legenda idênticos');
});

// ---------- a tela é salva por DOIS cartões ----------
//
// "Vídeos & Cortes" grava esta mesma configuração de dois lugares: o cartão de
// qualidade (que não sabe de fonte) e o de estilo visual (que sabe). Recusar a
// gravação por campo ausente fazia o cartão de qualidade parar de salvar - o
// mesmo tipo de bug que já apagou os horários de postagem em silêncio.

const test2 = require('node:test');
const { startServer, stopServer, createLoginableClient, createAgent } = require('../helpers/http');

let baseUrl2;
test2.before(async () => {
  baseUrl2 = await startServer();
});
test2.after(async () => {
  await stopServer();
});

async function agenteLogado() {
  const cliente = await createLoginableClient();
  const agente = createAgent(baseUrl2);
  await agente.login(cliente.email, cliente.password);
  return agente;
}

const BASE = {
  aspectRatio: '9:16',
  framing: 'crop',
  quality: 'medium',
  captionStyle: 'classic',
  titleStyle: 'classic',
  clipLength: 'balanced',
  clipMode: 'ai_choice',
  maxClips: 4,
  showTitle: true,
  titleSeconds: 3,
  descriptionMode: 'auto',
  descriptionTemplate: null,
  cropStyleMode: 'manual',
  cropZoomPercent: 100,
  showPartLabel: false,
  partLabelPosition: 'top_right',
};

test2('salvar SEM mandar fonte preserva a que estava escolhida', async () => {
  const agente = await agenteLogado();

  const comFonte = await agente.put('/api/client/video-settings', {
    ...BASE,
    captionFont: 'Bebas Neue',
    titleFont: 'Poppins',
    captionHeightPercent: 30,
    titleHeightPercent: 5,
  });
  assert.equal(comFonte.status, 200, comFonte.text);
  assert.equal(comFonte.body.captionFont, 'Bebas Neue');

  // Agora o outro cartão salva, sem saber de fonte nenhuma.
  const semFonte = await agente.put('/api/client/video-settings', { ...BASE, quality: 'high' });
  assert.equal(semFonte.status, 200, `o cartão de qualidade tem que conseguir salvar: ${semFonte.text}`);
  assert.equal(semFonte.body.captionFont, 'Bebas Neue', 'a fonte escolhida não pode ser perdida');
  assert.equal(semFonte.body.captionHeightPercent, 30, 'a altura escolhida não pode ser perdida');
});

test2('fonte que não existe no servidor é recusada', async () => {
  const agente = await agenteLogado();
  const r = await agente.put('/api/client/video-settings', { ...BASE, captionFont: 'Comic Sans MS' });
  assert.equal(r.status, 400);
});

test2('altura fora da faixa é recusada', async () => {
  const agente = await agenteLogado();
  const r = await agente.put('/api/client/video-settings', { ...BASE, captionHeightPercent: 95 });
  assert.equal(r.status, 400);
});

test2('a duração de 3 a 4 minutos é aceita', async () => {
  const agente = await agenteLogado();
  const r = await agente.put('/api/client/video-settings', { ...BASE, clipLength: 'extra_long' });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.clipLength, 'extra_long');
});
