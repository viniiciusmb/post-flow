// Chave geral e limites do modulo de lives. Tudo mora na tabela settings pra
// ser mudado pelo painel, na hora, sem deploy.
'use strict';

const config = require('../../config');
const settingsRepository = require('../../repositories/settingsRepository');
const twitchApi = require('./twitchApi');

// Padrao pensado pra VPS de 2 nucleos / 96 GB (decisao de 28/09/2026: validar
// nela antes de pensar em servidor maior). 480p a ~0,65 GB/h medido.
const PADRAO = Object.freeze({
  maxCanais: 2,
  qualidade: '480p',
  retencaoHoras: 24,
  cortesPorHora: 5,
  discoMaxPercent: 80,
  horasPorCanalDia: 8,
});

const QUALIDADES = ['360p', '480p', '720p'];

// Faixas aceitas. Fora delas o valor e puxado pra dentro em vez de recusado:
// um 0 em "cortes por hora" desligaria o modulo sem ninguem perceber, e um
// 200 encheria o disco. Os tetos sao o que 2 nucleos aguentam com folga.
const FAIXAS = {
  maxCanais: [1, 5],
  retencaoHoras: [6, 72],
  cortesPorHora: [1, 20],
  discoMaxPercent: [50, 95],
  horasPorCanalDia: [1, 24],
};

function sanitizar(entrada = {}) {
  const saida = { ...PADRAO };
  for (const [chave, [min, max]] of Object.entries(FAIXAS)) {
    const n = Math.round(Number(entrada[chave]));
    if (Number.isFinite(n)) saida[chave] = Math.min(max, Math.max(min, n));
  }
  if (QUALIDADES.includes(entrada.qualidade)) saida.qualidade = entrada.qualidade;
  return saida;
}

async function obterConfig() {
  return sanitizar(await settingsRepository.getValue('lives_config', PADRAO));
}

async function salvarConfig(entrada) {
  const atual = await obterConfig();
  const nova = sanitizar({ ...atual, ...entrada });
  await settingsRepository.setValue('lives_config', nova);
  return nova;
}

// Tres coisas precisam ser verdade: o servidor nao forcou desligado
// (LIVES_ENABLED=false), a Twitch esta configurada, e o painel ligou.
async function estaLigado() {
  if (config.lives.forcarDesligado) return false;
  if (!twitchApi.configurado()) return false;
  return (await settingsRepository.getValue('lives_enabled', false)) === true;
}

async function ligar(ligado) {
  await settingsRepository.setValue('lives_enabled', Boolean(ligado));
}

module.exports = { PADRAO, QUALIDADES, FAIXAS, sanitizar, obterConfig, salvarConfig, estaLigado, ligar };
