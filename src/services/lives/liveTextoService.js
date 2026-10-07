// ONDE vai o titulo e a legenda de cada corte de live (06/10/2026).
//
// O problema que isto resolve, visto nos cortes do coringa: o formato da IA
// poe a webcam do streamer na faixa de cima, e o titulo - fixo no topo - caia
// em cima do rosto dele; a legenda, fixa a 60% da altura, caia no meio do
// video que ele estava assistindo. Cada corte tem um layout diferente, entao
// uma altura fixa nunca serve.
//
// Como decide, pra cada corte:
//  1. monta UM quadro do corte ja no formato final, sem texto
//     (videoEditingService.quadroDoLayoutDeLive);
//  2. mede, linha a linha, quanto a tela "mexe" (faixa preta, fundo
//     desfocado e cenario parado sao lugar bom pra texto);
//  3. a IA olha o mesmo quadro e marca rostos, a acao principal e as areas
//     livres, e sugere onde poria o titulo e a legenda;
//  4. o SERVIDOR escolhe as duas posicoes juntas, somando tudo isso. A faixa
//     da webcam do streamer e proibida (o servidor sabe exatamente onde ela
//     esta - nao depende de a IA lembrar), as bordas onde o TikTok desenha a
//     propria interface sao evitadas, e titulo e legenda nunca se cruzam.
//
// Qualquer falha (ffmpeg, IA) cai num caminho mais simples, nunca derruba o
// corte: sem a IA, decide so com a medicao e a faixa da webcam; sem o quadro,
// devolve null e o render usa o estilo como sempre.
'use strict';

const fs = require('fs');
const openaiLives = require('./openaiLives');
const videoEditingService = require('../videoEditingService');
const logger = require('../../lib/logger');

const ALTURA = 1920;
const LINHAS = 96; // linhas do quadro cinza; cada uma ~1,04% da altura

// Onde o TikTok desenha a interface por cima do video (abas no topo; descricao,
// nome e botoes embaixo). Texto ali fica escondido.
const TOPO_RESERVADO = 7; // %
const BASE_RESERVADA_TITULO = 78; // %, abaixo disso o titulo nao vai
const BASE_RESERVADA_LEGENDA = 84; // %, a legenda pode descer um pouco mais
const FOLGA_ENTRE_TEXTOS = 2; // %
const ESCALAS_DO_TITULO = [100, 85, 72, 62];
// Abaixo disso a linha do quadro e lisa (barra preta, fundo desfocado).
const LINHA_LISA = 0.12; // % do tamanho do modelo

const FAIXA = {
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    required: ['topo', 'base'],
    properties: { topo: { type: 'number' }, base: { type: 'number' } },
  },
};

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['rostos', 'acao_principal', 'areas_livres', 'titulo_centro', 'legenda_centro', 'motivo'],
  properties: {
    rostos: FAIXA,
    acao_principal: FAIXA,
    areas_livres: FAIXA,
    titulo_centro: { type: 'number' },
    legenda_centro: { type: 'number' },
    motivo: { type: 'string' },
  },
};

const INSTRUCAO = `As imagens sao quadros de um corte vertical (9:16) de live, ja montado, ainda SEM texto: a 1a e do comeco (quando o titulo aparece), a 2a do meio do corte. Vamos escrever por cima dele um TITULO (1 a 3 linhas, aparece nos primeiros segundos) e a LEGENDA (uma palavra por vez, o corte todo).
Todas as posicoes sao em % da ALTURA da imagem: 0 = topo, 100 = base. Marque o que aparece em QUALQUER uma das duas imagens.
- rostos: faixa vertical de CADA rosto visivel (da testa ao queixo), inclusive o do streamer na webcam e pessoas no video que ele assiste.
- acao_principal: onde esta o que importa ver (o que acontece no video/jogo, a pessoa falando, o objeto do momento).
- areas_livres: faixas onde texto NAO atrapalha: barras pretas, fundo desfocado, parede/cenario parado, teto, borda, area de chat ou interface sem importancia.
- titulo_centro e legenda_centro: onde VOCE poria o centro de cada um. Nunca em cima de rosto nem da acao principal. Prefira as areas livres. O titulo fica ACIMA da legenda, e os dois nao se encostam. Evite os 7% de cima e os 16% de baixo (a interface do TikTok cobre).
Em "motivo", uma frase com o que voce viu.`;

const limitar = (v, a, b) => Math.min(b, Math.max(a, v));

// Quanto cada linha do quadro "mexe" (0 = liso, 1 = a linha mais agitada).
// Variacao entre pixels vizinhos + desvio da linha: barra preta e fundo
// desfocado dao perto de 0; rosto, jogo e texto da tela dao alto.
function atividadePorLinha(cinza, w = 54, h = LINHAS) {
  const brutos = [];
  for (let y = 0; y < h; y++) {
    let soma = 0;
    let soma2 = 0;
    let grad = 0;
    for (let x = 0; x < w; x++) {
      const v = cinza[y * w + x];
      soma += v;
      soma2 += v * v;
      if (x) grad += Math.abs(v - cinza[y * w + x - 1]);
      if (y) grad += Math.abs(v - cinza[(y - 1) * w + x]);
    }
    const media = soma / w;
    const desvio = Math.sqrt(Math.max(0, soma2 / w - media * media));
    brutos.push(desvio + grad / w);
  }
  const max = Math.max(...brutos, 1);
  return brutos.map((b) => b / max);
}

// Faixas (em %) que o texto nunca pode cobrir: a da webcam do streamer. O
// servidor sabe exatamente onde ela esta no layout - e a parte que nao pode
// depender de a IA acertar.
function faixasProibidas(settings) {
  const faixas = [];
  const formato = settings.live_formato;
  if (formato && formato.tipo !== 'quadro_inteiro' && Array.isArray(formato.paineis)) {
    let topo = 0;
    for (const p of formato.paineis) {
      const altura = Number(p.alturaPercent) || 0;
      // janelaDaCamera e a marca que o liveFormatoService poe. O texto livre
      // ("mostra") so vale quando COMECA dizendo que e a camera: "video que
      // o streamer assiste" tem a palavra streamer e e conteudo (visto no
      // corte 49 do coringa - a tela inteira virou proibida).
      const mostra = String(p.mostra || '').trim();
      const ehCamera = Boolean(p.janelaDaCamera) || (/^(a |o )?(webcam|c[aâ]mera|streamer)/i.test(mostra) && !/conte[uú]do|assist|jogo|tela/i.test(mostra));
      if (ehCamera) faixas.push({ topo, base: topo + altura });
      topo += altura;
    }
  } else if (settings.live_webcam) {
    const altura = Number(settings.live_webcam.heightPercent) || 0;
    faixas.push(settings.live_webcam.position === 'bottom' ? { topo: 100 - altura, base: 100 } : { topo: 0, base: altura });
  }
  return faixas;
}

// Custo de pôr texto em cada linha (0..95 = % da altura). Quanto maior, pior.
// soDuro: so o que o texto NUNCA pode cobrir (webcam, rostos) - e a conta
// que decide se o titulo precisa diminuir.
function custoPorLinha({ atividade, proibidas, ia, soDuro = false }) {
  const linhas = Array.from({ length: 100 }, (_, y) => {
    if (soDuro) return 0;
    const idx = Math.min(atividade.length - 1, Math.floor((y / 100) * atividade.length));
    // A medicao dos pixels pesa mais que as marcas da IA: no teste com o
    // corte 51 a faixa preta saiu certinha nos pixels (atividade ~0), enquanto
    // as coordenadas da IA variavam de uma chamada pra outra.
    return 60 * atividade[idx];
  });
  const atividadeNaLinha = (y) => atividade[Math.min(atividade.length - 1, Math.floor((y / 100) * atividade.length))];
  // soComTextura: a marca da IA so vale onde os pixels mostram alguma coisa.
  // Rosto ou acao numa faixa LISA (barra preta, fundo liso) e alucinacao -
  // medido repetindo a decisao 3x nos cortes do coringa: em algumas chamadas a
  // IA "via" um rosto na faixa preta e empurrava o titulo pra cima do video.
  const marcar = (faixa, valor, folga = 0, soComTextura = false) => {
    const ini = Math.max(0, Math.floor(Number(faixa.topo) - folga));
    const fim = Math.min(99, Math.ceil(Number(faixa.base) + folga));
    if (!Number.isFinite(ini) || !Number.isFinite(fim)) return;
    for (let y = ini; y <= fim; y++) if (!soComTextura || atividadeNaLinha(y) > LINHA_LISA) linhas[y] += valor;
  };
  for (const f of proibidas) marcar(f, 1000);
  if (ia) {
    // Rosto: folga de 2% na conta normal, e o rosto exato na conta dura (a
    // que decide diminuir o titulo) - a IA erra a borda por 1-2%.
    for (const f of ia.rostos || []) marcar(f, 400, soDuro ? 0 : 2, true);
    if (soDuro) return linhas;
    for (const f of ia.acao_principal || []) marcar(f, 25, 0, true);
    for (const f of ia.areas_livres || []) marcar(f, -10);
  }
  if (soDuro) return linhas;
  for (let y = 0; y < TOPO_RESERVADO; y++) linhas[y] += 200;
  return linhas;
}

const custoDaFaixa = (linhas, topo, altura) => {
  let soma = 0;
  for (let y = Math.floor(topo); y < Math.ceil(topo + altura); y++) soma += linhas[Math.min(99, Math.max(0, y))];
  return soma / Math.max(1, altura);
};

// Escolhe as duas faixas JUNTAS (titulo acima da legenda, sem se cruzar).
// alturas em %. Devolve o TOPO de cada uma, em %.
function escolherPosicoes({ linhas, linhasLegenda = linhas, alturaTitulo, alturaLegenda, sugestao = {}, comTitulo = true }) {
  let melhor = null;
  const tMax = BASE_RESERVADA_TITULO - alturaTitulo;
  const lMax = BASE_RESERVADA_LEGENDA - alturaLegenda;
  for (let l = TOPO_RESERVADO; l <= lMax; l++) {
    let custoL = custoDaFaixa(linhasLegenda, l, alturaLegenda);
    // Legenda gosta do terco de baixo (onde o olho procura legenda).
    custoL += 0.25 * Math.abs(l + alturaLegenda / 2 - 70);
    if (Number.isFinite(sugestao.legenda)) custoL -= Math.abs(l + alturaLegenda / 2 - sugestao.legenda) < 6 ? 12 : 0;
    if (!comTitulo) {
      if (!melhor || custoL < melhor.custo) melhor = { custo: custoL, titulo: null, legenda: l };
      continue;
    }
    for (let t = TOPO_RESERVADO; t <= tMax; t++) {
      if (t + alturaTitulo + FOLGA_ENTRE_TEXTOS > l) break; // titulo acima, sem encostar
      let custoT = custoDaFaixa(linhas, t, alturaTitulo);
      custoT += 0.15 * t; // titulo mais pra cima, se o resto empatar
      if (Number.isFinite(sugestao.titulo)) custoT -= Math.abs(t + alturaTitulo / 2 - sugestao.titulo) < 6 ? 12 : 0;
      const total = custoT + custoL;
      if (!melhor || total < melhor.custo) melhor = { custo: total, titulo: t, legenda: l };
    }
  }
  return melhor;
}

// Altura do titulo e da legenda em % da tela, do jeito que o render desenha.
function alturasDosTextos({ estilo, titulo, escala = 100 }) {
  const base = videoEditingService.TITLE_STYLES[estilo.title_style] || videoEditingService.TITLE_STYLES.classic;
  const preset = { ...base, tamanho: Math.round((base.tamanho * escala) / 100) };
  const fonte = estilo.title_font || videoEditingService.FONTE_PADRAO;
  const linhas = titulo ? Math.max(1, videoEditingService.quebrarTitulo(titulo, fonte, preset.tamanho).length) : 0;
  // Modelos com fundo (papel, cartao, faixa, caixa) ocupam mais que o texto.
  const comFundo = ['papel_rasgado', 'cartao'].includes(estilo.title_style) || preset.faixa || preset.caixa;
  const pxTitulo = linhas ? (linhas * 1.2 + (comFundo ? 1.6 : 0.8)) * preset.tamanho : 0;
  const presetLegenda = videoEditingService.CAPTION_STYLES[estilo.caption_style] || videoEditingService.CAPTION_STYLES.classic;
  const pxLegenda = estilo.caption_style === 'none' ? 0 : presetLegenda.tamanho * 1.8;
  return { tituloPx: pxTitulo, legendaPx: pxLegenda, tamanhoTitulo: preset.tamanho, alturaTitulo: (100 * pxTitulo) / ALTURA, alturaLegenda: (100 * pxLegenda) / ALTURA };
}

// Converte o TOPO escolhido (%) nos campos que o render entende:
// title_height_percent marca onde comeca o titulo (ver centroDoTitulo) e
// caption_height_percent e a distancia da BASE da legenda ate a borda de baixo.
function paraOsCamposDoEstilo({ tituloTopo, legendaTopo, alturas }) {
  const r = {};
  if (tituloTopo !== null && tituloTopo !== undefined) {
    const centroPx = ((tituloTopo + alturas.alturaTitulo / 2) / 100) * ALTURA;
    const margemPx = centroPx - (alturas.tamanhoTitulo * 1.2) / 2;
    r.title_height_percent = limitar(Math.round((100 * margemPx) / ALTURA), 0, 80);
  }
  if (legendaTopo !== null && legendaTopo !== undefined) {
    const basePx = ((legendaTopo + alturas.alturaLegenda) / 100) * ALTURA;
    r.caption_height_percent = limitar(Math.round((100 * (ALTURA - basePx)) / ALTURA), 0, 80);
  }
  return r;
}

// Ponto de entrada. custo(kind, respostaDaOpenAI) registra o gasto da IA.
// Devolve { title_height_percent, caption_height_percent, decisao } ou null.
async function posicionar({ videoPath, inicio, fim, settings, estilo, titulo, custo }) {
  // Na live o conteudo MUDA durante o corte (o video que o streamer assiste
  // troca de cena): um quadro so do meio nao diz onde estara o vazio quando
  // o titulo aparecer (visto no corte 51 do coringa - a foto subiu e o
  // titulo caiu em cima das pessoas). O titulo usa o quadro dos primeiros
  // segundos (e quando ele aparece); a legenda, que fica o corte inteiro, usa
  // o pior caso entre quadros espalhados pelo corte.
  const duracao = Math.max(1, fim - inicio);
  const instantes = [inicio + Math.min(1.5, duracao * 0.1), inicio + duracao * 0.4, inicio + duracao * 0.75];
  const arquivos = instantes.map((_, i) => ({ jpg: `${videoPath}.texto${i}.jpg`, cinza: `${videoPath}.texto${i}.gray` }));
  try {
    const quadros = [];
    for (let i = 0; i < instantes.length; i++) {
      const dim = await videoEditingService.quadroDoLayoutDeLive({ videoPath, segundo: instantes[i], settings, saidaJpg: arquivos[i].jpg, saidaCinza: arquivos[i].cinza });
      if (!dim) return null;
      quadros.push(atividadePorLinha(fs.readFileSync(arquivos[i].cinza), dim.w, dim.h));
    }
    const atividadeTitulo = quadros[0];
    const atividadeLegenda = quadros[0].map((_, y) => Math.max(...quadros.map((q) => q[y])));
    let ia = null;
    try {
      const r = await openaiLives.pedirJson({
        nome: 'posicao_texto',
        sistema: 'Voce decide onde escrever titulo e legenda num corte vertical sem cobrir nada importante.',
        usuario: INSTRUCAO,
        schema: SCHEMA,
        modelo: openaiLives.MODELO_JUIZ,
        raciocinio: 'low',
        imagem: [arquivos[0].jpg, arquivos[1].jpg].map((f) => fs.readFileSync(f).toString('base64')),
      });
      await custo('posicao_texto', r);
      ia = r.dados;
    } catch (err) {
      logger.warn(`Lives: IA da posicao do texto falhou (${err.message}) - decidindo so pela imagem.`);
    }
    const proibidas = faixasProibidas(settings);
    const linhas = custoPorLinha({ atividade: atividadeTitulo, proibidas, ia });
    const linhasLegenda = custoPorLinha({ atividade: atividadeLegenda, proibidas, ia });
    const duras = custoPorLinha({ atividade: atividadeTitulo, proibidas, ia, soDuro: true });
    // Testa o titulo em 4 tamanhos (visto no corte 52 do coringa: a faixa
    // livre entre a webcam e o video era menor que o titulo de 3 linhas).
    let melhor = null;
    for (const escala of ESCALAS_DO_TITULO) {
      const alturas = alturasDosTextos({ estilo, titulo, escala });
      const escolha = escolherPosicoes({
        linhas,
        linhasLegenda,
        alturaTitulo: alturas.alturaTitulo,
        alturaLegenda: alturas.alturaLegenda,
        sugestao: ia ? { titulo: Number(ia.titulo_centro), legenda: Number(ia.legenda_centro) } : {},
        comTitulo: alturas.alturaTitulo > 0,
      });
      if (!escolha) continue;
      const colisao =
        (escolha.titulo === null ? 0 : custoDaFaixa(duras, escolha.titulo, alturas.alturaTitulo)) +
        custoDaFaixa(duras, escolha.legenda, alturas.alturaLegenda);
      // Encostar em rosto/webcam pesa mais que tudo; entre os que nao
      // encostam, vence o lugar mais livre, com uma pequena preferencia pelo
      // titulo maior. Sem isto o tamanho cheio parava no primeiro lugar sem
      // rosto - mesmo cobrindo o video - quando um titulo um pouco menor
      // cabia na faixa preta (corte 51).
      const nota = (colisao > 0 ? 1e6 + colisao : 0) + escolha.custo + (100 - escala) * 0.15;
      if (!melhor || nota < melhor.nota) melhor = { escolha, alturas, escala, colisao, nota };
    }
    if (!melhor) return null;
    const { escolha, alturas, escala } = melhor;
    return {
      ...paraOsCamposDoEstilo({ tituloTopo: escolha.titulo, legendaTopo: escolha.legenda, alturas }),
      title_scale_percent: escala,
      decisao: {
        tituloTopo: escolha.titulo,
        legendaTopo: escolha.legenda,
        escalaDoTitulo: escala,
        encostaEmAlgo: melhor.colisao > 0,
        proibidas,
        fonte: ia ? 'ia' : 'imagem',
        motivo: ia?.motivo || null,
      },
    };
  } catch (err) {
    logger.warn(`Lives: nao consegui decidir a posicao do texto (${err.message}) - usando a do estilo.`);
    return null;
  } finally {
    for (const a of arquivos) for (const f of [a.jpg, a.cinza]) fs.rm(f, { force: true }, () => {});
  }
}

module.exports = { posicionar, atividadePorLinha, faixasProibidas, custoPorLinha, escolherPosicoes, alturasDosTextos, paraOsCamposDoEstilo, SCHEMA, INSTRUCAO };
