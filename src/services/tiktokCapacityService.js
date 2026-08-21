// Vigia o teto de CRIADORES ATIVOS do app no TikTok.
//
// O limite que trava o crescimento não é o de posts por dia (esse é ~15 por
// conta, e o sistema já usa 10). É o teto de quantos criadores DISTINTOS
// podem publicar num período de 24h — número que o TikTok atribui a cada app
// a partir da estimativa de uso declarada na auditoria.
//
// Duas características tornam esse limite perigoso:
//
//   1. Ele não aparece em lugar nenhum. Nem na API, nem no painel. Só se
//      descobre que bateu quando as publicações começam a ser recusadas.
//   2. Aumentá-lo depende do TikTok analisar um pedido, o que leva dias.
//
// Ou seja: descobrir o limite pelo sintoma significa ficar dias com os
// clientes sem publicar. Por isso este serviço avisa ANTES, com folga.
'use strict';

const pool = require('../db/pool');
const settingsRepository = require('../repositories/settingsRepository');

const CHAVES = {
  limite: 'tiktok_creator_limit',
  dispensadoAte: 'tiktok_limit_alert_dismissed_until',
};

// Quanto o fundador declarou como estimativa na auditoria. 50 é um chute
// conservador para quem nunca informou o número real - e é justamente por ser
// chute que a tela pede para ele conferir e corrigir.
const LIMITE_PADRAO = 50;

// Avisa a 70% do teto. Não é para avisar quando já está apertado: o pedido de
// aumento demora, então o aviso precisa vir enquanto ainda há espaço para
// crescer enquanto se espera a resposta.
const FATOR_DE_ALERTA = 0.7;

async function contar() {
  const { rows } = await pool.query(`
    SELECT
      -- Pior caso: todas as contas conectadas publicando no mesmo dia. É o
      -- número que decide o risco, porque é o que pode acontecer amanhã sem
      -- ninguém fazer nada.
      (SELECT count(*)::int FROM tiktok_accounts WHERE is_active) AS contas_conectadas,
      -- Uso real das últimas 24h: criadores distintos que publicaram.
      (SELECT count(DISTINCT tiktok_account_id)::int
         FROM postings
        WHERE status = 'posted' AND posted_at > now() - interval '24 hours') AS criadores_ativos_24h,
      -- Pico recente: o maior número de criadores distintos num único dia dos
      -- últimos 30. Mostra a tendência sem depender de o dia de hoje ser
      -- representativo.
      (SELECT coalesce(max(n), 0)::int FROM (
         SELECT count(DISTINCT tiktok_account_id) AS n
           FROM postings
          WHERE status = 'posted' AND posted_at > now() - interval '30 days'
          GROUP BY posted_at::date
       ) AS por_dia) AS pico_30_dias
  `);
  return rows[0];
}

async function avaliar() {
  const [contagens, limite, dispensadoAte] = await Promise.all([
    contar(),
    settingsRepository.getValue(CHAVES.limite, LIMITE_PADRAO),
    settingsRepository.getValue(CHAVES.dispensadoAte, null),
  ]);

  const teto = Number(limite) > 0 ? Number(limite) : LIMITE_PADRAO;
  const usado = contagens.contas_conectadas;
  const percentual = teto > 0 ? Math.round((usado / teto) * 100) : 0;

  const dispensado = dispensadoAte ? new Date(dispensadoAte).getTime() > Date.now() : false;

  return {
    ...contagens,
    limite: teto,
    limiteConfirmado: Number(limite) > 0 && limite !== LIMITE_PADRAO,
    percentual,
    // Só alerta quem ainda não pediu o aumento (ou pediu e adiou o aviso).
    alertar: usado >= Math.ceil(teto * FATOR_DE_ALERTA) && !dispensado,
    dispensadoAte: dispensadoAte || null,
  };
}

async function definirLimite(valor) {
  const n = Number(valor);
  if (!Number.isInteger(n) || n < 1 || n > 100000) return null;
  await settingsRepository.setValue(CHAVES.limite, n);
  return n;
}

// "Já pedi o aumento, não me avise por N dias." Volta a avisar depois porque
// pedido de aumento pode ser recusado, e um aviso silenciado para sempre é o
// mesmo que não existir.
async function adiarAviso(dias = 14) {
  const ate = new Date(Date.now() + dias * 86400000).toISOString();
  await settingsRepository.setValue(CHAVES.dispensadoAte, ate);
  return ate;
}

module.exports = { avaliar, definirLimite, adiarAviso, LIMITE_PADRAO, FATOR_DE_ALERTA, CHAVES };
