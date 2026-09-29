#!/usr/bin/env node
// Gera assets/imagens/cartao-titulo.png - o cartao do estilo de titulo
// "Cartao" no tamanho de UMA linha. O render desenha o cartao no tamanho
// exato de cada titulo (src/lib/cartaoTitulo.js); este arquivo fica como a
// referencia do desenho e como garantia de que o estilo existe no repositorio.
//
//   node scripts/gerar-cartao-titulo.js
'use strict';

const fs = require('fs');
const path = require('path');
const { gerarPng } = require('../src/lib/cartaoTitulo');

const SAIDA = path.join(__dirname, '..', 'assets', 'imagens', 'cartao-titulo.png');
const png = gerarPng(929, 258);
fs.mkdirSync(path.dirname(SAIDA), { recursive: true });
fs.writeFileSync(SAIDA, png);
console.log(`cartao-titulo.png: ${Math.round(png.length / 1024)} KB`);
