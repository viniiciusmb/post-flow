// Quantos vídeos o sistema processa AO MESMO TEMPO.
//
// Não é uma questão de hardware: mesmo com 32 núcleos, o sistema processaria
// um por vez se ninguém dissesse o contrário. E vale a pena passar de um —
// medido nesta VPS, dobrar os núcleos de um render acelera 1,63x (não 2x),
// então dois vídeos com metade dos núcleos cada rendem MAIS que um vídeo com
// todos. O custo é a espera individual de cada cliente ficar maior.
//
// Por que vários trabalhadores em vez de `batchSize`: com batchSize o pg-boss
// entrega N jobs de uma vez e só busca os próximos quando o handler INTEIRO
// termina — um vídeo de 5 minutos ficaria esperando um de 60 na mesma leva.
// Cada trabalhador com o seu próprio job busca o próximo assim que acaba o
// dele, que é o que evita a fila travar atrás do mais lento.
'use strict';

const settingsRepository = require('../repositories/settingsRepository');
const logger = require('../lib/logger');

const CHAVE = 'max_videos_simultaneos';
const PADRAO = 1;

// Teto de 8: acima disso a disputa por CPU e disco faz cada vídeo demorar
// tanto que a vazão total para de crescer, e o risco de estourar memória
// cresce. O piso é 1 porque zero pararia o processamento sem ninguém entender
// por quê.
const MINIMO = 1;
const MAXIMO = 8;

function normalizar(valor) {
  const n = Number(valor);
  if (!Number.isInteger(n)) return null;
  if (n < MINIMO || n > MAXIMO) return null;
  return n;
}

async function obter() {
  const salvo = await settingsRepository.getValue(CHAVE, PADRAO);
  return normalizar(salvo) || PADRAO;
}

async function definir(valor) {
  const n = normalizar(valor);
  if (n === null) return null;
  await settingsRepository.setValue(CHAVE, n);
  logger.info(`Limite de videos simultaneos alterado para ${n}.`);
  return n;
}

module.exports = { obter, definir, normalizar, CHAVE, PADRAO, MINIMO, MAXIMO };
