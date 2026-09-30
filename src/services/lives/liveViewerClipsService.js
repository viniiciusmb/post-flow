// Clipes que os ESPECTADORES criam (Twitch ou Kick) durante a live - o sinal mais
// direto de "isso aqui foi bom": alguem parou pra clipar. No teste de
// 28/09/2026 foram 28 clipes em 31 minutos numa live de ~1.700 pessoas, com
// titulos como "ahahahaha".
//
// Vem pela API da plataforma (Twitch: Get Clips com o token de app da vigia;
// Kick: a lista de clipes do canal), sem custo. So guardamos quando e quanto
// durou cada clipe - o video em si e o nosso, gravado.
'use strict';

const plataformas = require('./plataformas');
const livesRepository = require('../../repositories/livesRepository');

// sessao precisa de platform, login e platform_user_id
// (livesRepository.listSessionsForAnalysis ja traz).
async function coletar(sessao) {
  // Um minuto antes do inicio da gravacao: clipe criado logo no comeco pode
  // cobrir segundos que ja gravamos.
  const desde = new Date(new Date(sessao.started_at).getTime() - 60_000);
  const clipes = await plataformas.buscarClipes(sessao, desde);
  if (!clipes.length) return 0;
  return livesRepository.saveViewerClips(sessao.id, clipes);
}

module.exports = { coletar };
