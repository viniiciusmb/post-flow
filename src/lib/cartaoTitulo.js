// Desenha o cartao do estilo de titulo "Cartao" (PNG com transparencia),
// NO TAMANHO EXATO em que ele vai aparecer.
//
// Versao 2 (29/09/2026), depois do fundador ver o primeiro corte com ele:
//  - SEM sombra. A sombra difusa nao chegava a zero na borda da imagem e
//    formava um retangulo escuro em volta do cartao ("sombras nas bordas");
//  - no tamanho exato de cada titulo, em vez de uma imagem fixa esticada:
//    esticar pra caber duas linhas deformava os cantos arredondados.
//
// Sai BRANCO (em tons de branco): o render multiplica pela cor escolhida, e o
// degrade vira um degrade da propria cor.
'use strict';

const zlib = require('zlib');

// Distancia com sinal ate a borda de um retangulo de cantos arredondados
// (negativa dentro). Da a borda lisa, sem serrilhado.
function distancia(x, y, w, h, raio) {
  const qx = Math.abs(x - w / 2) - (w / 2 - raio);
  const qy = Math.abs(y - h / 2) - (h / 2 - raio);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - raio;
}

function gerarPng(largura, altura) {
  const w = Math.max(20, Math.round(largura));
  const h = Math.max(20, Math.round(altura));
  const raio = Math.min(44, Math.round(h * 0.2));
  const bordaInferior = Math.max(4, Math.round(h * 0.025));
  const linhas = [];
  for (let y = 0; y < h; y += 1) {
    const linha = Buffer.alloc(1 + w * 4);
    const t = y / (h - 1);
    // Degrade suave (255 em cima, 222 embaixo) e um filete mais escuro no pe,
    // que da volume sem precisar de sombra.
    const tom = y >= h - bordaInferior ? 200 : Math.round(255 - 33 * t);
    for (let x = 0; x < w; x += 1) {
      const a = Math.max(0, Math.min(1, 0.5 - distancia(x + 0.5, y + 0.5, w, h, raio)));
      const i = 1 + x * 4;
      linha[i] = tom;
      linha[i + 1] = tom;
      linha[i + 2] = tom;
      linha[i + 3] = Math.round(a * 255);
    }
    linhas.push(linha);
  }
  return montarPng(Buffer.concat(linhas), w, h);
}

function montarPng(dadosBrutos, w, h) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    bloco('IHDR', ihdr),
    bloco('IDAT', zlib.deflateSync(dadosBrutos, { level: 6 })),
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

let tabela = null;
function crc32(buf) {
  if (!tabela) {
    tabela = new Int32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      tabela[n] = c;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = tabela[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return c ^ 0xffffffff;
}

module.exports = { gerarPng };
