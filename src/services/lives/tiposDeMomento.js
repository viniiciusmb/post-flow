// Que tipo de momento de live vira corte, e pistas baratas (sem IA) na fala.
//
// Pedido do fundador (29/09/2026): a IA precisa reconhecer dois grupos -
// o ENGRACADO (piada, duplo sentido, mancada, xingamento, momento
// desconfortavel) e o SERIO que viraliza (dinheiro com numero, "ganhei/comprei
// tal coisa", polemica, briga, ofensa).
//
// 04/10/2026: entraram HISTORIA (causo com comeco, meio e fim), INTRIGA
// (fofoca, segredo, revelacao, suspense entre pessoas) e REFLEXAO (conselho,
// licao de vida, frase marcante) - e as CATEGORIAS que cada usuario escolhe
// receber, agrupando os tipos com nome de gente.
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
  // conversa que prende
  'historia',
  'intriga',
  'reflexao',
  // o resto que sempre funcionou
  'reacao',
  'inesperado',
  'jogada',
  'outro',
]);

// Viralizam pelo que e DITO, nao pela reacao: "faturo 50 mil por mes" dito
// com calma, sem o chat explodir, continua sendo o corte. Esses nao sao
// barrados pela exigencia de reacao do publico dos niveis altos.
// Historia, intriga e reflexao tambem: o chat fica quieto ouvindo e so reage
// no final - exigir pico de chat no trecho todo barraria justamente os
// melhores causos.
const TIPOS_DE_CONTEUDO = Object.freeze(new Set(['dinheiro', 'ostentacao', 'polemica', 'historia', 'intriga', 'reflexao']));

// Momento rapido (piada, reacao) se resolve em segundos; historia, briga e
// polemica precisam de tempo pra preparar e concluir. Corte de historia
// apertado em 90s perde o comeco ou o fim - o que faz o corte nao ter sentido.
const DURACAO_MAX_PADRAO = 90;
const DURACAO_MAX_LONGA = 150;
const TIPOS_LONGOS = Object.freeze(new Set(['historia', 'intriga', 'reflexao', 'briga', 'polemica']));

function duracaoMaxDoTipo(tipo) {
  return TIPOS_LONGOS.has(tipo) ? DURACAO_MAX_LONGA : DURACAO_MAX_PADRAO;
}

// O que o usuario escolhe na tela. Cada tipo cai em UMA categoria; "outros"
// recebe o que a IA nao classificou. Ordem = ordem na tela.
const CATEGORIAS = Object.freeze([
  { id: 'humor', nome: 'Humor e zoeira', descricao: 'Piada, zoeira, duplo sentido, mancada, surto', tipos: ['piada', 'duplo_sentido', 'mancada', 'xingamento'] },
  { id: 'vergonha', nome: 'Vergonha alheia', descricao: 'Clima estranho, pergunta indiscreta, gente sem resposta', tipos: ['constrangedor'] },
  { id: 'historias', nome: 'Histórias e causos', descricao: 'Causo contado do começo ao fim', tipos: ['historia'] },
  { id: 'intriga', nome: 'Fofoca e intriga', descricao: 'Segredo, revelação, exposed, suspense entre pessoas', tipos: ['intriga'] },
  { id: 'tretas', nome: 'Tretas e brigas', descricao: 'Discussão, confronto, resposta afiada, ofensa', tipos: ['briga', 'ofensa'] },
  { id: 'dinheiro', nome: 'Dinheiro e ostentação', descricao: 'Quanto ganha, quanto custou, o que comprou', tipos: ['dinheiro', 'ostentacao'] },
  { id: 'polemica', nome: 'Polêmicas', descricao: 'Opinião forte e chocante, dita sem rodeio', tipos: ['polemica'] },
  { id: 'papo_reto', nome: 'Papo reto', descricao: 'Conselho, lição de vida, frase marcante', tipos: ['reflexao'] },
  { id: 'reacoes', nome: 'Reações e sustos', descricao: 'Reação exagerada, susto, algo inesperado ao vivo', tipos: ['reacao', 'inesperado'] },
  { id: 'gameplay', nome: 'Jogadas', descricao: 'Jogada incrível ou falha absurda no jogo', tipos: ['jogada'] },
  { id: 'outros', nome: 'Outros', descricao: 'O que não se encaixa nos outros', tipos: ['outro'] },
]);
const IDS_CATEGORIAS = Object.freeze(CATEGORIAS.map((c) => c.id));

function categoriaDoTipo(tipo) {
  return (CATEGORIAS.find((c) => c.tipos.includes(tipo)) || CATEGORIAS[CATEGORIAS.length - 1]).id;
}

// escolhidas: lista de ids (null/vazia = todas).
function aceitaTipo(escolhidas, tipo) {
  if (!Array.isArray(escolhidas) || !escolhidas.length) return true;
  return escolhidas.includes(categoriaDoTipo(tipo));
}

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

module.exports = {
  TIPOS,
  TIPOS_DE_CONTEUDO,
  CATEGORIAS,
  IDS_CATEGORIAS,
  DURACAO_MAX_PADRAO,
  DURACAO_MAX_LONGA,
  pistasDaFala,
  ehDeConteudo,
  duracaoMaxDoTipo,
  categoriaDoTipo,
  aceitaTipo,
};
