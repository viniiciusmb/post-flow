// Em que ponto da configuracao inicial o cliente esta.
//
// Alimenta duas coisas: o checklist da tela inicial (que some sozinho quando
// os tres passos terminam) e o guia passo a passo do Tutorial, que marca o que
// ja foi feito em vez de mandar a pessoa refazer.
//
// A ordem dos passos nao e arbitraria: conectar o TikTok primeiro, porque e a
// conta que recebe os cortes e e ela que o canal precisa apontar; depois o
// estilo, que vale pra tudo que for cortado dali pra frente; so entao o canal,
// que e o que liga a maquina.
'use strict';

const tiktokAccountsRepository = require('../../../repositories/tiktokAccountsRepository');
const youtubeChannelsRepository = require('../../../repositories/youtubeChannelsRepository');
const clientVideoSettingsRepository = require('../../../repositories/clientVideoSettingsRepository');
const pool = require('../../../db/pool');

// "Estilo configurado" e a existencia da linha de configuracao do cliente.
// Ela so nasce quando alguem salva alguma coisa na tela de cortes - nunca por
// visitar. Sem linha, o cliente esta rodando nos padroes do codigo, que e
// exatamente o que este passo pede pra ele revisar.
async function estiloFoiConfigurado(clientUserId) {
  const { rows } = await pool.query(
    `SELECT 1 FROM client_video_settings WHERE client_user_id = $1 LIMIT 1`,
    [clientUserId]
  );
  return rows.length > 0;
}

async function status(req, res) {
  const clientUserId = req.session.user.id;

  const [contas, canais, estilo] = await Promise.all([
    tiktokAccountsRepository.listActiveByClientId(clientUserId),
    youtubeChannelsRepository.listByClientId(clientUserId),
    estiloFoiConfigurado(clientUserId),
  ]);

  const passos = {
    tiktokConectado: contas.length > 0,
    estiloConfigurado: estilo,
    canalMonitorado: canais.length > 0,
  };

  res.json({
    ...passos,
    // O front some com o checklist quando isto vira true. Calculado aqui pra
    // que a regra de "terminou" viva num lugar so.
    concluido: Object.values(passos).every(Boolean),
    contasTiktok: contas.length,
    canais: canais.length,
  });
}

module.exports = { status };
