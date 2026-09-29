// Clipes que os ESPECTADORES criam na Twitch durante a live - o sinal mais
// direto de "isso aqui foi bom": alguem parou pra clipar. No teste de
// 28/09/2026 foram 28 clipes em 31 minutos numa live de ~1.700 pessoas, com
// titulos como "ahahahaha".
//
// Vem pela API da Twitch com o mesmo token de app da vigia (Get Clips), sem
// custo. So guardamos quando e quanto durou cada clipe - o video em si e o
// nosso, gravado.
'use strict';

const twitchApi = require('./twitchApi');
const livesRepository = require('../../repositories/livesRepository');

async function coletar(sessao, platformUserId) {
  if (!platformUserId) return 0;
  // Um minuto antes do inicio da gravacao: clipe criado logo no comeco pode
  // cobrir segundos que ja gravamos.
  const desde = new Date(new Date(sessao.started_at).getTime() - 60_000);
  const clipes = await twitchApi.buscarClipes(platformUserId, desde);
  if (!clipes.length) return 0;
  return livesRepository.saveViewerClips(sessao.id, clipes);
}

module.exports = { coletar };
