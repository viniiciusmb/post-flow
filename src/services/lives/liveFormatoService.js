// A IA escolhe o FORMATO de cada corte de live, sem modelo pre-moldado
// (pedido do fundador, 29/09/2026): cada live tem um jeito - tela do PC com
// webcam pequena, uma pessoa num canto, duas pessoas conversando uma em cada
// ponta, tres lado a lado, VTubers, IRL, plano aberto. Cortar sempre no centro
// deixa gente de fora (ou mostra so a parede entre duas pessoas).
//
// A IA ve DOIS quadros do trecho (a 30% e a 70%), na mesma chamada, e monta o
// corte vertical com 1 a 3 PAINEIS empilhados - cada painel e um recorte do
// video original - ou pede o quadro inteiro. Ela diz O QUE cada painel mostra
// (o retangulo de interesse); o servidor ajusta o recorte ao formato exato do
// painel (encaixarRecorte), porque pedir proporcao exata a um modelo de
// linguagem e pedir pra errar.
//
// Qualquer resposta que nao da pra usar cai no quadro inteiro: e o unico
// formato que nunca deixa ninguem de fora.
'use strict';

const fs = require('fs');
const { spawn } = require('child_process');
const openaiLives = require('./openaiLives');
const videoEditingService = require('../videoEditingService');
const logger = require('../../lib/logger');

const FFPROBE = process.env.FFPROBE_PATH || 'ffprobe';
const SAIDA = { w: 1080, h: 1920 };
const MAX_PAINEIS = 3;
const ALTURA_MIN_PAINEL = 20; // % da tela

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['pessoas_da_live', 'formato', 'paineis', 'motivo'],
  properties: {
    // TODAS as pessoas da live, com onde cada uma esta - respondido A PARTE
    // dos paineis. A IA nao e consistente: na mesma imagem ora acerta, ora
    // esquece a webcam ou uma das pessoas (visto repetindo o teste de 12
    // lives). Com a lista, o SERVIDOR garante que ninguem fica de fora
    // (garantirPessoas), em vez de depender de a IA lembrar.
    pessoas_da_live: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['tipo', 'x', 'y', 'largura', 'altura', 'foco_x', 'foco_y'],
        properties: {
          tipo: { type: 'string', enum: ['webcam', 'na_camera', 'vtuber'] },
          x: { type: 'number' },
          y: { type: 'number' },
          largura: { type: 'number' },
          altura: { type: 'number' },
          foco_x: { type: 'number' },
          foco_y: { type: 'number' },
        },
      },
    },
    formato: { type: 'string', enum: ['paineis', 'quadro_inteiro'] },
    paineis: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['mostra', 'x', 'y', 'largura', 'altura', 'foco_x', 'foco_y', 'altura_na_tela'],
        properties: {
          mostra: { type: 'string' },
          // Centro do ROSTO (ou do ponto principal, se nao for pessoa). O
          // recorte se centra aqui: sem isto, o zoom numa coluna inteira
          // pegava bone e testa (teste com 3 pessoas lado a lado).
          foco_x: { type: 'number' },
          foco_y: { type: 'number' },
          x: { type: 'number' },
          y: { type: 'number' },
          largura: { type: 'number' },
          altura: { type: 'number' },
          altura_na_tela: { type: 'integer' },
        },
      },
    },
    motivo: { type: 'string' },
  },
};

const INSTRUCAO = `Voce e o editor que decide o ENQUADRAMENTO de um corte vertical (9:16, 1080x1920) feito de um trecho de live da Twitch (video original horizontal).
Voce recebe dois quadros do mesmo trecho (inicio e fim). Monte o corte com 1 a 3 PAINEIS empilhados de cima pra baixo. Cada painel e um recorte do video original que ocupa a largura toda da tela.

Para cada painel devolva:
- mostra: o que o painel mostra (ex.: "pessoa da esquerda", "webcam do streamer", "jogo");
- x, y, largura, altura: o RETANGULO DE INTERESSE no video original, em fracoes de 0 a 1 (x,y = canto superior esquerdo). Marque so o que importa (a pessoa da cabeca ao peito, a janela da webcam, a area do jogo) - o sistema ajusta o recorte ao formato do painel;
- foco_x, foco_y: o CENTRO DO ROSTO da pessoa (ou o centro do que importa, se nao for pessoa), em fracoes do video original. O recorte e centrado aqui;
- altura_na_tela: quanto da tela vertical o painel ocupa, em % (a soma dos paineis = 100, cada um no minimo 20).

Primeiro liste em "pessoas_da_live" TODAS as pessoas que estao NA live, cada uma com o retangulo dela (da cabeca ao peito, ou a janela inteira da webcam) e o centro do rosto (foco_x, foco_y), em fracoes:
- tipo "webcam": o streamer numa janela de webcam SOBREPOSTA ao conteudo (retangulo menor, normalmente num canto);
- tipo "na_camera": pessoa filmada pela camera principal da live (podcast, conversa, IRL);
- tipo "vtuber": avatar animado do streamer ou convidado.
Personagens de jogo, filme, desenho ou arte no conteudo NAO entram na lista.
ATENCAO com live de REACT: o streamer esta assistindo um video (YouTube, filme, outra live) que ocupa a tela - a pessoa GRANDE no meio geralmente e quem esta NO VIDEO (conteudo, nao entra na lista). O streamer e quem esta na janela pequena de webcam.

Regras:
- No maximo um painel por pessoa da lista, mais um painel pro conteudo (tela/jogo/video), se houver conteudo. Com 2 pessoas e nada mais, sao 2 paineis.
- A webcam do streamer SEMPRE ganha um painel: e ela que mostra a reacao.
- NINGUEM importante pode ficar de fora. Pessoas nas duas pontas do video: um painel pra cada (uma em cima, outra embaixo) - nunca um recorte no meio mostrando o espaco entre elas.
- Tela do PC / jogo / video + webcam do streamer: um painel com a webcam (30-45%) e outro com o conteudo.
- Uma pessoa so (mesmo num canto): um painel centrado nela.
- Tres pessoas: tres paineis, ou "quadro_inteiro" se elas estiverem juntas.
- Pessoa = quem esta NA live: o streamer, convidados, e VTubers (avatar animado do streamer). Personagem de filme, serie, jogo, desenho ou ilustracao que aparece NO CONTEUDO nao e pessoa da live - aquilo e conteudo (um painel so pra ele, se for o caso).
- Cada painel mostra uma area DIFERENTE do video. Nunca dois paineis sobre a mesma regiao.
- Nao faca painel so com chat, alerta, logo, faixa de texto, objeto ou cenario vazio.
- Plano muito aberto, muita gente, ou na duvida: formato "quadro_inteiro" (paineis vazio).
Em "motivo", uma frase dizendo o que voce viu.`;

function duracaoEDimensoes(arquivo) {
  return new Promise((resolve, reject) => {
    const filho = spawn(FFPROBE, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', arquivo]);
    let saida = '';
    let terminou = false;
    filho.stdout.on('data', (c) => { saida += c; });
    filho.on('error', (err) => {
      if (terminou) return;
      terminou = true;
      reject(err);
    });
    filho.on('close', (codigo) => {
      if (terminou) return;
      terminou = true;
      const [w, h] = saida.trim().split(',').map(Number);
      if (codigo !== 0 || !w || !h) return reject(new Error('ffprobe nao leu o tamanho do video.'));
      resolve({ w, h });
    });
  });
}

// Ajusta o retangulo de interesse ao formato do painel, sem distorcer.
// Tudo em fracoes do video original.
//
// Retangulo mais ESTREITO que o painel (uma pessoa numa coluna, painel largo):
//  - com UM painel so, alarga (mostra um pouco mais em volta);
//  - com VARIOS paineis, APROXIMA (rosto e peito) em vez de alargar. Alargar
//    fazia cada painel pegar a pessoa do lado - no teste com 3 pessoas lado a
//    lado, os 3 paineis mostravam as mesmas 3 pessoas. O centro sobe um pouco:
//    rosto fica na parte de cima do retangulo "cabeca ao peito".
function encaixarRecorte(roi, painel, fonte, { variosPaineis = false } = {}) {
  const alvo = painel.w / painel.h; // proporcao em pixels
  let w = roi.largura * fonte.w;
  let h = roi.altura * fonte.h;
  // Centro: o rosto que a IA apontou, se ele cair dentro do retangulo; senao,
  // o meio do retangulo.
  const focoValido = (v, ini, tam) => Number.isFinite(v) && v >= ini && v <= ini + tam;
  const cx = (focoValido(roi.focoX, roi.x, roi.largura) ? roi.focoX : roi.x + roi.largura / 2) * fonte.w;
  const cy = (focoValido(roi.focoY, roi.y, roi.altura) ? roi.focoY : roi.y + roi.altura * 0.4) * fonte.h;
  if (w / h < alvo) {
    if (variosPaineis) {
      h = Math.max(w / alvo, fonte.h * 0.2);
      w = h * alvo;
    } else {
      w = h * alvo;
    }
  } else {
    h = w / alvo;
  }
  if (h > fonte.h) {
    h = fonte.h;
    w = h * alvo;
  }
  if (w > fonte.w) {
    w = fonte.w;
    h = w / alvo;
  }
  const x = Math.min(Math.max(0, cx - w / 2), fonte.w - w);
  const y = Math.min(Math.max(0, cy - h / 2), fonte.h - h);
  return { x: x / fonte.w, y: y / fonte.h, largura: w / fonte.w, altura: h / fonte.h };
}

const QUADRO_INTEIRO = Object.freeze({ tipo: 'quadro_inteiro', paineis: [] });

function sobreposicaoDoMenor(a, b) {
  const ix = Math.max(0, Math.min(a.x + a.largura, b.x + b.largura) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.altura, b.y + b.altura) - Math.max(a.y, b.y));
  return (ix * iy) / Math.min(a.largura * a.altura, b.largura * b.altura);
}

// Transforma a resposta da IA num formato seguro pra renderizar - ou no
// quadro inteiro, quando a resposta nao da pra usar.
function montarFormato(resposta, fonte) {
  if (!resposta || resposta.formato !== 'paineis') return { ...QUADRO_INTEIRO, motivo: resposta?.motivo || '' };
  // Teto de paineis pelo que a IA contou: pessoas + 1 (o conteudo). Com zero
  // pessoas, um painel so (o conteudo) - nunca um painel por personagem.
  const pessoas = Array.isArray(resposta.pessoas_da_live) ? resposta.pessoas_da_live.length : 0;
  const brutos = (resposta.paineis || []).slice(0, Math.min(MAX_PAINEIS, pessoas + 1));
  if (!brutos.length) return { ...QUADRO_INTEIRO, motivo: resposta.motivo };
  const lim = (v) => Math.max(0, Math.min(1, Number(v)));
  const rois = [];
  for (const p of brutos) {
    const x = lim(p.x);
    const y = lim(p.y);
    const largura = Math.min(lim(p.largura), 1 - x);
    const altura = Math.min(lim(p.altura), 1 - y);
    // Retangulo minusculo e erro de leitura, nao "algo que importa".
    if (!(largura >= 0.05 && altura >= 0.05)) return { ...QUADRO_INTEIRO, motivo: resposta.motivo };
    rois.push({
      x, y, largura, altura,
      focoX: Number(p.foco_x),
      focoY: Number(p.foco_y),
      pedido: Math.max(1, Number(p.altura_na_tela) || 0),
      mostra: String(p.mostra || '').slice(0, 80),
    });
  }
  // Paineis que mostram a MESMA area (mais de 30% do menor dentro do outro)
  // viram um so: visto no teste, um filme com webcam virou 3 paineis, dois
  // repetindo a mesma janela de webcam (o streamer e alguem atras dele).
  // So conta como repetido se os dois tem tamanho PARECIDO: a webcam dentro
  // do painel do conteudo (tela toda) e painel diferente, nao repeticao.
  const area = (r) => r.largura * r.altura;
  const parecidos = (a, b) => Math.max(area(a), area(b)) / Math.min(area(a), area(b)) < 3;
  for (let i = rois.length - 1; i > 0; i -= 1) {
    const repetido = rois.slice(0, i).some((r) => parecidos(r, rois[i]) && sobreposicaoDoMenor(r, rois[i]) > 0.3);
    if (repetido) rois.splice(i, 1);
  }

  // Alturas somando 100, nenhuma abaixo do minimo (painel de 8% e uma fita).
  const soma = rois.reduce((s, r) => s + r.pedido, 0);
  let alturas = rois.map((r) => Math.round((r.pedido / soma) * 100));
  if (alturas.some((a) => a < ALTURA_MIN_PAINEL)) alturas = rois.map(() => Math.round(100 / rois.length));
  alturas[alturas.length - 1] += 100 - alturas.reduce((a, b) => a + b, 0);

  const paineis = rois.map((r, i) => ({
    ...encaixarRecorte(r, { w: SAIDA.w, h: (SAIDA.h * alturas[i]) / 100 }, fonte, { variosPaineis: rois.length > 1 }),
    alturaPercent: alturas[i],
    mostra: r.mostra,
  }));
  return { tipo: 'paineis', paineis, motivo: String(resposta.motivo || '').slice(0, 200) };
}

function caixa(p) {
  return { x: Number(p.x), y: Number(p.y), largura: Number(p.largura), altura: Number(p.altura) };
}

function caixaValida(c) {
  return [c.x, c.y, c.largura, c.altura].every(Number.isFinite) && c.largura >= 0.04 && c.altura >= 0.04 && c.largura <= 1 && c.altura <= 1;
}

// A pessoa esta "no painel" se mais da metade da caixa dela esta dentro do
// recorte que o painel pediu. A WEBCAM precisa de painel PROPRIO (no maximo 4x
// o tamanho dela): dentro do painel do conteudo, que cobre a tela toda, ela
// "aparece" como um quadradinho - e a reacao se perde do mesmo jeito.
function estaNoPainel(pessoa, p) {
  const a = caixa(pessoa);
  const b = caixa(p);
  const ix = Math.max(0, Math.min(a.x + a.largura, b.x + b.largura) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.altura, b.y + b.altura) - Math.max(a.y, b.y));
  const dentro = (ix * iy) / (a.largura * a.altura) > 0.5;
  if (!dentro) return false;
  if (pessoa.tipo === 'webcam') return b.largura * b.altura <= 4 * a.largura * a.altura;
  return true;
}

// NINGUEM DA LIVE FICA DE FORA - garantido aqui, nao pedido a IA. Cada pessoa
// que a IA listou e que nenhum painel mostra ganha um painel; se isso passar
// de 3 paineis, o corte vira quadro inteiro (onde todo mundo aparece). E
// webcam no quadro inteiro vira painel proprio: no quadro inteiro ela fica um
// quadradinho e a reacao se perde (erro real do corte 7 do wb3nji).
function garantirPessoas(resposta) {
  if (!resposta) return resposta;
  const pessoas = (resposta.pessoas_da_live || []).filter((p) => caixaValida(caixa(p)));
  if (!pessoas.length) return resposta;
  let paineis = resposta.formato === 'paineis' ? [...(resposta.paineis || [])] : [];
  const temWebcam = pessoas.some((p) => p.tipo === 'webcam');
  if (!paineis.length && !temWebcam) return resposta; // quadro inteiro: todos aparecem
  if (!paineis.length) {
    paineis = [{ mostra: 'conteudo', x: 0, y: 0, largura: 1, altura: 1, foco_x: 0.5, foco_y: 0.5, altura_na_tela: 65 }];
  }
  const faltando = pessoas.filter((pe) => !paineis.some((pa) => estaNoPainel(pe, pa)));
  if (!faltando.length) return { ...resposta, formato: 'paineis', paineis };
  if (paineis.length + faltando.length > MAX_PAINEIS) {
    return { ...resposta, formato: 'quadro_inteiro', paineis: [], motivo: `${resposta.motivo || ''} (quadro inteiro pra ninguem ficar de fora)` };
  }
  const novos = faltando.map((pe) => ({
    mostra: pe.tipo === 'webcam' ? 'webcam do streamer' : 'pessoa da live',
    ...caixa(pe),
    foco_x: pe.foco_x,
    foco_y: pe.foco_y,
    altura_na_tela: pe.tipo === 'webcam' ? 35 : 50,
  }));
  // Alturas: as da IA pros paineis dela, as nossas pros novos - o montarFormato
  // normaliza pra 100 depois.
  return { ...resposta, formato: 'paineis', paineis: [...paineis, ...novos] };
}

async function extrairQuadro(videoPath, instante) {
  const quadro = `${videoPath}.fmt-${Math.round(instante * 10)}.jpg`;
  await videoEditingService.runFfmpeg(['-ss', String(instante), '-i', videoPath, '-frames:v', '1', '-q:v', '3', quadro]);
  return quadro;
}

// Escolhe o formato de um trecho [inicio, fim] (segundos do arquivo de
// trabalho). custo(kind, respostaDaOpenAI) registra o gasto.
async function escolherFormato(videoPath, inicio, fim, custo) {
  const quadros = [];
  try {
    const fonte = await module.exports.dimensoes(videoPath);
    const duracao = fim - inicio;
    for (const t of [inicio + duracao * 0.3, inicio + duracao * 0.7]) quadros.push(await extrairQuadro(videoPath, t));
    const r = await openaiLives.pedirJson({
      nome: 'formato_live',
      sistema: 'Voce decide como enquadrar um corte vertical de live.',
      usuario: INSTRUCAO,
      schema: SCHEMA,
      modelo: openaiLives.MODELO_JUIZ,
      raciocinio: 'low',
      imagem: quadros.map((q) => fs.readFileSync(q).toString('base64')),
    });
    await custo('camera', r);
    return montarFormato(garantirPessoas(r.dados), fonte);
  } catch (err) {
    logger.warn(`Lives: nao consegui escolher o formato (${err.message}) - quadro inteiro.`);
    return { ...QUADRO_INTEIRO, motivo: 'falha na escolha' };
  } finally {
    for (const q of quadros) fs.rm(q, { force: true }, () => {});
  }
}

module.exports = { escolherFormato, montarFormato, garantirPessoas, encaixarRecorte, dimensoes: duracaoEDimensoes, SCHEMA, INSTRUCAO };
