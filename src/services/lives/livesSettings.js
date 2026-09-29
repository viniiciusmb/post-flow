// Chave geral e limites do modulo de lives. Tudo mora na tabela settings pra
// ser mudado pelo painel, na hora, sem deploy.
'use strict';

const config = require('../../config');
const settingsRepository = require('../../repositories/settingsRepository');
const twitchApi = require('./twitchApi');

// Padrao pensado pra VPS de 2 nucleos / 96 GB (decisao de 28/09/2026: validar
// nela antes de pensar em servidor maior).
//
// 720p e nao 480p: a camera do streamer e RECORTADA do video e esticada pra
// largura do corte - em 480p ela tem ~150px e sai borrada. 720p30 fica em
// ~1,5 GB/h (480p: 0,65 medido).
//
// "Cortes por hora" saiu daqui: agora e o NIVEL DE QUALIDADE de cada usuario
// que decide (livesUserSettings.NIVEIS).
const PADRAO = Object.freeze({
  maxCanais: 2,
  qualidade: '720p',
  retencaoHoras: 24,
  discoMaxPercent: 80,
  horasPorCanalDia: 8,
});

const QUALIDADES = ['360p', '480p', '720p'];

// Faixas aceitas. Fora delas o valor e puxado pra dentro em vez de recusado:
// um 0 em "canais ao mesmo tempo" desligaria o modulo sem ninguem perceber, e
// 50 encheria o disco. Os tetos sao o que 2 nucleos aguentam com folga.
const FAIXAS = {
  maxCanais: [1, 5],
  retencaoHoras: [6, 72],
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
