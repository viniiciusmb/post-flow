#!/usr/bin/env node
// Gera a imagem do "papel rasgado" usada como fundo do título.
//
// Por que gerar em vez de baixar: uma imagem de banco de imagens traz licença
// junto, e uma imagem achada solta na internet traz risco. Esta é desenhada por
// código, é nossa, e é DETERMINÍSTICA — rodar de novo produz o mesmo arquivo,
// então o visual não muda sem alguém decidir que muda.
//
// A imagem sai BRANCA com fundo transparente. A cor real é aplicada na hora de
// renderizar (ffmpeg tinge o branco com a cor escolhida pelo cliente), o que
// permite qualquer cor com um arquivo só.
//
//   node scripts/gerar-papel-rasgado.js
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const LARGURA = 1080;
const ALTURA = 300;
const SAIDA = path.join(__dirname, '..', 'assets', 'imagens', 'papel-rasgado.png');

// Gerador de número pseudoaleatório com semente fixa. Aleatório de verdade
// faria a borda mudar a cada execução, e aí duas gerações produziriam papéis
// diferentes sem ninguém ter mudado nada.
function aleatorioComSemente(semente) {
  let s = semente;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

// A borda rasgada: uma sequência de dentes irregulares. Papel rasgado de
// verdade tem dentes de tamanhos diferentes e inclinações diferentes - uma
// serrilha regular parece zigue-zague de gráfico, não papel.
function bordaRasgada(rand, base, amplitude) {
  const alturas = new Array(LARGURA);
  let x = 0;
  let atual = base + (rand() - 0.5) * amplitude;
  while (x < LARGURA) {
    // Dente entre 18 e 55 pixels: variar a LARGURA é o que mais convence.
    const largura = Math.round(18 + rand() * 37);
    const alvo = base + (rand() - 0.5) * amplitude;
    for (let i = 0; i < largura && x + i < LARGURA; i += 1) {
      // Interpola do valor atual até o alvo dentro do dente, criando a
      // inclinação em vez de degraus retos.
      const naDiagonal = atual + ((alvo - atual) * i) / largura;
      // Tremor fino por cima da diagonal: papel rompido tem fibra, e sem isso
      // os dentes viram triângulos perfeitos - lê como gráfico, não como
      // papel. 2px é o suficiente para quebrar a linha reta sem virar ruído.
      alturas[x + i] = naDiagonal + (rand() - 0.5) * 2.4;
    }
    atual = alvo;
    x += largura;
  }
  return alturas;
}

function gerar() {
  const rand = aleatorioComSemente(20260822);
  const topo = bordaRasgada(rand, 26, 34);
  const base = bordaRasgada(rand, ALTURA - 26, 34);

  // RGBA: 4 bytes por pixel, mais 1 byte de filtro por linha.
  const bytes = Buffer.alloc(ALTURA * (1 + LARGURA * 4), 0);
  for (let y = 0; y < ALTURA; y += 1) {
    const inicioLinha = y * (1 + LARGURA * 4);
    bytes[inicioLinha] = 0; // filtro "none"
    for (let x = 0; x < LARGURA; x += 1) {
      const p = inicioLinha + 1 + x * 4;
      const dentro = y >= topo[x] && y <= base[x];
      // Suaviza 1px na borda pra não sair serrilhado duro.
      const distancia = Math.min(y - topo[x], base[x] - y);
      const alfa = !dentro ? 0 : distancia < 1 ? Math.round(255 * distancia) : 255;
      bytes[p] = 255;
      bytes[p + 1] = 255;
      bytes[p + 2] = 255;
      bytes[p + 3] = Math.max(0, Math.min(255, alfa));
    }
  }

  const png = montarPng(bytes);
  fs.mkdirSync(path.dirname(SAIDA), { recursive: true });
  fs.writeFileSync(SAIDA, png);
  console.log(`papel-rasgado.png: ${LARGURA}x${ALTURA}, ${Math.round(png.length / 1024)} KB`);
  console.log(SAIDA);
}

// Escritor de PNG mínimo. Node já traz o zlib, que é a única parte difícil -
// o resto do formato são quatro blocos com um CRC cada.
function montarPng(dadosBrutos) {
  const assinatura = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(LARGURA, 0);
  ihdr.writeUInt32BE(ALTURA, 4);
  ihdr[8] = 8; // bits por canal
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0; // compressão
  ihdr[11] = 0; // filtro
  ihdr[12] = 0; // sem entrelaçamento

  return Buffer.concat([
    assinatura,
    bloco('IHDR', ihdr),
    bloco('IDAT', zlib.deflateSync(dadosBrutos, { level: 9 })),
    bloco('IEND', Buffer.alloc(0)),
  ]);
}

function bloco(tipo, dados) {
  const tamanho = Buffer.alloc(4);
  tamanho.writeUInt32BE(dados.length, 0);
  const corpo = Buffer.concat([Buffer.from(tipo, 'ascii'), dados]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(corpo) >>> 0, 0);
  return Buffer.concat([tamanho, corpo, crc]);
}

let tabelaCrc = null;
function crc32(buf) {
  if (!tabelaCrc) {
    tabelaCrc = new Int32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      tabelaCrc[n] = c;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = tabelaCrc[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return c ^ 0xffffffff;
}

gerar();
