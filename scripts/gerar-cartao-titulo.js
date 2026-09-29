#!/usr/bin/env node
// Gera a imagem do "cartao" usada atras do titulo no estilo Cartao.
//
// Mesmo principio do papel rasgado (scripts/gerar-papel-rasgado.js): desenhado
// por codigo (sem licenca de terceiro), DETERMINISTICO, e BRANCO - a cor real
// e aplicada na hora de renderizar (o ffmpeg multiplica o branco pela cor
// escolhida). Por isso o degrade e feito em tons de cinza claro: multiplicado,
// vira um degrade da PROPRIA cor escolhida, e a sombra (preta) continua preta.
//
// O desenho: cartao de cantos arredondados, degrade vertical suave (mais claro
// em cima), uma borda inferior um pouco mais escura (da volume) e sombra
// difusa embaixo - o visual "caixa de titulo" dos canais de corte grandes.
//
//   node scripts/gerar-cartao-titulo.js
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const LARGURA = 1080;
const ALTURA = 300;
const SAIDA = path.join(__dirname, '..', 'assets', 'imagens', 'cartao-titulo.png');

const CARTAO = { x0: 24, y0: 22, x1: 1056, y1: 256, raio: 46 };
const SOMBRA = { desloca: 12, espalha: 22, opacidade: 0.42 };
const BORDA_INFERIOR = 7; // px mais escuros no pe do cartao

// Distancia com sinal ate a borda de um retangulo de cantos arredondados:
// negativa dentro, positiva fora. E o que da borda suave (sem serrilhado) e a
// sombra difusa com uma conta so.
function distancia(x, y, r) {
  const cx = (r.x0 + r.x1) / 2;
  const cy = (r.y0 + r.y1) / 2;
  const hx = (r.x1 - r.x0) / 2 - r.raio;
  const hy = (r.y1 - r.y0) / 2 - r.raio;
  const qx = Math.abs(x - cx) - hx;
  const qy = Math.abs(y - cy) - hy;
  const fora = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
  const dentro = Math.min(Math.max(qx, qy), 0);
  return fora + dentro - r.raio;
}

function gerar() {
  const linhas = [];
  for (let y = 0; y < ALTURA; y += 1) {
    const linha = Buffer.alloc(1 + LARGURA * 4);
    linha[0] = 0; // filtro "nenhum" da linha
    for (let x = 0; x < LARGURA; x += 1) {
      const px = x + 0.5;
      const py = y + 0.5;
      // Cartao: alfa pela distancia (1px de transicao = borda lisa).
      const d = distancia(px, py, CARTAO);
      const aCartao = Math.max(0, Math.min(1, 0.5 - d));
      // Sombra: o mesmo formato deslocado pra baixo, esmaecendo ate "espalha".
      const ds = distancia(px, py - SOMBRA.desloca, CARTAO);
      const aSombra = ds <= 0 ? SOMBRA.opacidade : Math.max(0, SOMBRA.opacidade * (1 - ds / SOMBRA.espalha) ** 2);

      // Tom do cartao: 255 no topo descendo pra 222 no pe (degrade da cor), e
      // os ultimos pixels mais escuros (borda inferior).
      const t = Math.max(0, Math.min(1, (py - CARTAO.y0) / (CARTAO.y1 - CARTAO.y0)));
      let tom = 255 - 33 * t;
      if (py > CARTAO.y1 - BORDA_INFERIOR) tom = 196;

      // Cartao por cima da sombra (sombra e preta: so contribui com alfa).
      const alfa = aCartao + aSombra * (1 - aCartao);
      const cor = alfa > 0 ? (tom * aCartao) / alfa : 0;
      const i = 1 + x * 4;
      linha[i] = Math.round(cor);
      linha[i + 1] = Math.round(cor);
      linha[i + 2] = Math.round(cor);
      linha[i + 3] = Math.round(alfa * 255);
    }
    linhas.push(linha);
  }
  const png = montarPng(Buffer.concat(linhas));
  fs.mkdirSync(path.dirname(SAIDA), { recursive: true });
  fs.writeFileSync(SAIDA, png);
  console.log(`cartao-titulo.png: ${LARGURA}x${ALTURA}, ${Math.round(png.length / 1024)} KB`);
  console.log(SAIDA);
}

// Escritor de PNG minimo (igual ao do papel rasgado).
function montarPng(dadosBrutos) {
  const assinatura = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(LARGURA, 0);
  ihdr.writeUInt32BE(ALTURA, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
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
