// Que tipo de momento de live vira corte, e pistas baratas (sem IA) na fala.
//
// Pedido do fundador (29/09/2026): a IA precisa reconhecer dois grupos -
// o ENGRACADO (piada, duplo sentido, mancada, xingamento, momento
// desconfortavel) e o SERIO que viraliza (dinheiro com numero, "ganhei/comprei
// tal coisa", polemica, briga, ofensa).
'use strict';

const TIPOS = Object.freeze([
  // engracado
  'piada',
  'duplo_sentido',
  'mancada',
  'constrangedor',
  'xingamento',
  // serio
  'dinheiro',
  'ostentacao',
  'polemica',
  'briga',
  'ofensa',
  // o resto que sempre funcionou
  'reacao',
  'inesperado',
  'jogada',
  'outro',
]);

// Viralizam pelo que e DITO, nao pela reacao: "faturo 50 mil por mes" dito
// com calma, sem o chat explodir, continua sendo o corte. Esses nao sao
// barrados pela exigencia de reacao do publico dos niveis altos.
const TIPOS_DE_CONTEUDO = Object.freeze(new Set(['dinheiro', 'ostentacao', 'polemica']));

function normalizar(texto) {
  return String(texto || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

const NUMERO_POR_EXTENSO = '(?:um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez|vinte|trinta|quarenta|cinquenta|cem|duzentos|trezentos|quinhentos|meio)';
const GRANDEZA = '(?:mil|milhao|milhoes|bilhao|bilhoes|k|conto|contos|reais|real|dolares|dolar|pila|pilas|paus)';

const DINHEIRO = [
  /\$\s*\d/, // R$ 500, US$ 20, $300
  new RegExp(`\\b\\d+(?:[.,]\\d+)?\\s*${GRANDEZA}\\b`),
  new RegExp(`\\b${NUMERO_POR_EXTENSO}\\s+(?:mil|milhao|milhoes|bilhao|bilhoes)\\b`),
  /\b(?:faturo|faturei|faturamento|lucro|lucrei|salario|renda|recebi|recebo|ganho)\b[^.?!]{0,40}\d/,
];

const ITEM_DE_LUXO =
  /\b(?:carro|carrao|lamborghini|lambo|ferrari|porsche|bmw|mercedes|audi|tesla|range rover|rolex|relogio|mansao|casa|apartamento|ape|cobertura|iate|lancha|jatinho|moto|corolla|civic|hilux|iphone)\b/;
const COMPRA = /\b(?:comprei|paguei|ganhei|dei de presente|troquei de|peguei um|peguei uma|meu novo|minha nova)\b/;

const PALAVRAO =
  /\b(?:porra|caralho|puta|puto|merda|foda|fodase|foda-se|fuder|foder|fdp|arrombad\w*|desgrac\w*|cacete|buceta|otario|vagabund\w*|cuzao|babaca|imbecil|corno|filho da puta|vai tomar no)\b/;

// Rotulos curtos que vao pra linha da transcricao ({fala: ...}). Sao PISTA pra
// IA olhar com atencao, nao decisao: a nota continua sendo do juiz.
function pistasDaFala(texto) {
  const t = normalizar(texto);
  if (!t.trim()) return [];
  const pistas = [];
  if (DINHEIRO.some((re) => re.test(t))) pistas.push('fala de dinheiro com numero');
  if (COMPRA.test(t) && (ITEM_DE_LUXO.test(t) || /\d/.test(t))) pistas.push('ganhou/comprou algo');
  if (PALAVRAO.test(t)) pistas.push('palavrao');
  return pistas;
}

function ehDeConteudo(tipo) {
  return TIPOS_DE_CONTEUDO.has(tipo);
}

module.exports = { TIPOS, TIPOS_DE_CONTEUDO, pistasDaFala, ehDeConteudo };
