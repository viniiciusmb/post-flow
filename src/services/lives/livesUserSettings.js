// Configuracao dos cortes de LIVE de cada usuario: nivel de qualidade,
// camera do streamer e estilo visual (proprio ou o mesmo dos cortes de video).
'use strict';

const livesRepository = require('../../repositories/livesRepository');
const clientVideoSettingsRepository = require('../../repositories/clientVideoSettingsRepository');

// Qualidade 1 a 5. Mais alta = MENOS cortes, e so os que o juiz considerou
// muito bons. Mais baixa = mais cortes, com momentos de menor chance de
// viralizar. A avaliacao e a mesma pra todos; muda o corte de cada um.
// reacaoMinima: em que posicao o momento precisa estar entre as reacoes do
// publico daquela live (0,9 = entre os 10% de maior reacao). Ignorado em live
// sem chat (sem sinal nao ha como comparar).
//
// 04/10/2026 (pedido do Vinicius: "2 por hora e muito pouco - mais cortes,
// mais chance de um bom"): os tetos subiram. Medido nas lives reais antes de
// mexer - live de 5h da Kick: 5 momentos nota 9, 35 nota 8, 58 nota 7. O
// nivel maximo antigo (nota 9 + top 10% de reacao) dava 1-2 por hora; agora
// ele pega nota 8+ com reacao acima da media, ~4-6 por hora.
//
// 04/10/2026, segundo pedido: mesmo no "so os melhores" a IA pode entregar
// ATE 15 por hora se achar tantos momentos bons - o teto e um limite, nao uma
// meta: o filtro de nota e reacao continua decidindo quantos passam.
const NIVEIS = Object.freeze({
  1: { notaMinima: 5, porHora: 30, reacaoMinima: 0, nome: 'Máximo de cortes' },
  2: { notaMinima: 6, porHora: 20, reacaoMinima: 0, nome: 'Muitos cortes' },
  3: { notaMinima: 7, porHora: 15, reacaoMinima: 0, nome: 'Equilibrado' },
  4: { notaMinima: 7, porHora: 15, reacaoMinima: 0.5, nome: 'Seletivo' },
  5: { notaMinima: 8, porHora: 15, reacaoMinima: 0.5, nome: 'Só os melhores' },
});

const PADRAO = Object.freeze({
  usar_estilo_dos_videos: true,
  estilo: {},
  qualidade: 3,
  // 'ia' = a IA escolhe o formato de cada corte (liveFormatoService).
  camera_modo: 'ia',
  camera_posicao: 'top',
  camera_altura_percent: 40,
  // Tipos de corte (tiposDeMomento.CATEGORIAS) que a pessoa quer receber.
  // null = todos.
  categorias: null,
});

function nivel(qualidade) {
  return NIVEIS[Math.min(5, Math.max(1, Math.round(Number(qualidade) || 3)))];
}

async function obter(userId) {
  return { ...PADRAO, ...(await livesRepository.getClipSettings(userId)) };
}

// O estilo que o render usa: o dos cortes de video (mesma fonte que o fluxo do
// YouTube) ou o proprio das lives, sempre por cima dos DEFAULTS - estilo
// salvo pela metade nunca deixa o render sem um campo.
async function estiloParaRender(userId) {
  const cfg = await obter(userId);
  const estilo = cfg.usar_estilo_dos_videos
    ? await clientVideoSettingsRepository.resolveForVideo(userId)
    : { ...clientVideoSettingsRepository.DEFAULTS, ...(cfg.estilo || {}) };
  return {
    estilo,
    camera: { modo: cfg.camera_modo, posicao: cfg.camera_posicao, alturaPercent: cfg.camera_altura_percent },
  };
}

module.exports = { NIVEIS, PADRAO, nivel, obter, estiloParaRender };
