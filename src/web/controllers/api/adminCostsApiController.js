// Painel de custo do admin: quanto a operacao gasta, por onde, e quanto sobra
// de cada plano.
//
// Tudo sai de video_costs (o livro que sobrevive ao video ser apagado) e
// respeita o filtro de periodo compartilhado com os outros dashboards.
'use strict';

const videoCostsRepository = require('../../../repositories/videoCostsRepository');
const usersRepository = require('../../../repositories/usersRepository');
const { ROLES } = require('../../../config/constants');
const subscriptionPlansRepository = require('../../../repositories/subscriptionPlansRepository');
const clientSubscriptionsRepository = require('../../../repositories/clientSubscriptionsRepository');
const settingsRepository = require('../../../repositories/settingsRepository');
const { resolveRange } = require('../../../lib/dateRanges');

// Semanas por mes: 52/12. Usar 4 subestimaria a cota mensal em 8% e a margem
// apareceria melhor do que e.
const SEMANAS_POR_MES = 52 / 12;

function porMinuto(custoUsd, segundos) {
  if (!segundos) return null;
  return custoUsd / (segundos / 60);
}

async function overview(req, res) {
  const { range, since, until } = resolveRange(req.query.range, {
    since: req.query.since,
    until: req.query.until,
  });

  const [resumo, porDia, porCliente, clientes, planos, cotacao, infraMensal] = await Promise.all([
    videoCostsRepository.resumo({ since, until }),
    videoCostsRepository.porDia({ since, until }),
    videoCostsRepository.porCliente({ since, until }),
    usersRepository.listByRole(ROLES.CLIENT),
    subscriptionPlansRepository.listActive(),
    settingsRepository.getValue('cotacao_usd_brl', 5.4),
    settingsRepository.getValue('custo_infra_mensal_usd', 0),
  ]);

  const nomePorId = new Map(clientes.map((c) => [Number(c.id), c]));
  const assinaturasPorPlano = await clientSubscriptionsRepository.countActiveByPlan();

  const segundosEntregues = Number(resumo.segundos_entregues) || 0;
  const segundosNovos = Number(resumo.segundos_novos) || 0;
  const totalUsd = Number(resumo.total_usd) || 0;
  const totalNovosUsd = Number(resumo.total_novos_usd) || 0;

  // O custo por minuto que vale pra decidir preco e o do video NOVO: e o que
  // sai da nossa conta quando entra trabalho de verdade. O "entregue" mistura
  // os videos reaproveitados (custo zero) e sempre parece mais barato - util
  // pra medir eficiencia, perigoso pra precificar.
  const usdPorMinutoNovo = porMinuto(totalNovosUsd, segundosNovos);
  const usdPorMinutoEntregue = porMinuto(totalUsd, segundosEntregues);
  const usd_brl = Number(cotacao) || 5.4;

  // Margem por plano, com o custo por minuto MEDIDO. Sem medicao no periodo
  // (nenhum video novo), nao ha margem pra calcular - e melhor dizer isso do
  // que devolver um numero inventado.
  const margens = planos.map((p) => {
    const minutosMes = (Number(p.weekly_minutes_normal) || 0) * SEMANAS_POR_MES;
    const custoBrl = usdPorMinutoNovo === null ? null : usdPorMinutoNovo * minutosMes * usd_brl;
    const receitaBrl = Number(p.price_cents) / 100;
    return {
      key: p.key,
      name: p.name,
      priceCents: p.price_cents,
      firstMonthPriceCents: p.first_month_price_cents,
      weeklyMinutes: Number(p.weekly_minutes_normal) || 0,
      minutosMes: Math.round(minutosMes),
      custoBrl,
      margemBrl: custoBrl === null ? null : receitaBrl - custoBrl,
      margemPercent: custoBrl === null || !receitaBrl ? null : ((receitaBrl - custoBrl) / receitaBrl) * 100,
      assinaturasAtivas: assinaturasPorPlano.get(Number(p.id)) || 0,
      overageCentsNormal: p.overage_cents_normal,
    };
  });

  res.json({
    range: { key: range, since, until },
    cotacaoUsdBrl: usd_brl,
    infraMensalUsd: Number(infraMensal) || 0,
    resumo: {
      totalUsd,
      whisperUsd: Number(resumo.whisper_usd) || 0,
      iaUsd: Number(resumo.ia_usd) || 0,
      bandaUsd: Number(resumo.banda_usd) || 0,
      bytes: Number(resumo.bytes) || 0,
      videos: Number(resumo.videos) || 0,
      minutosEntregues: segundosEntregues / 60,
      minutosNovos: segundosNovos / 60,
      minutosReaproveitados: (Number(resumo.segundos_reaproveitados) || 0) / 60,
      videosReaproveitados: Number(resumo.videos_reaproveitados) || 0,
      totalSemDonoUsd: Number(resumo.total_sem_dono_usd) || 0,
      usdPorMinutoNovo,
      usdPorMinutoEntregue,
      // Numerador da conta do "video novo". Vai junto pra tela poder mostrar a
      // divisao inteira em vez de so o resultado.
      totalNovosUsd,
    },
    porDia: porDia.map((d) => ({
      dia: d.dia,
      totalUsd: Number(d.total_usd) || 0,
      whisperUsd: Number(d.whisper_usd) || 0,
      iaUsd: Number(d.ia_usd) || 0,
      bandaUsd: Number(d.banda_usd) || 0,
      minutos: (Number(d.segundos) || 0) / 60,
    })),
    porCliente: porCliente
      .map((c) => {
        const u = nomePorId.get(Number(c.client_user_id));
        const minutos = (Number(c.segundos) || 0) / 60;
        const total = Number(c.total_usd) || 0;
        return {
          clientUserId: Number(c.client_user_id),
          nome: u ? u.business_name || u.email : `Cliente #${c.client_user_id}`,
          email: u ? u.email : null,
          totalUsd: total,
          whisperUsd: Number(c.whisper_usd) || 0,
          iaUsd: Number(c.ia_usd) || 0,
          bandaUsd: Number(c.banda_usd) || 0,
          videos: Number(c.videos) || 0,
          minutos,
          usdPorMinuto: minutos ? total / minutos : null,
        };
      })
      .sort((a, b) => b.totalUsd - a.totalUsd),
    margens,
  });
}

async function setCotacao(req, res) {
  const valor = Number(req.body.cotacaoUsdBrl);
  if (!Number.isFinite(valor) || valor <= 0) {
    return res.status(400).json({ error: 'Informe uma cotação do dólar maior que zero.' });
  }
  await settingsRepository.setValue('cotacao_usd_brl', valor);
  res.json({ ok: true, cotacaoUsdBrl: valor });
}

// Custo fixo mensal (VPS, proxy comprado, o que nao depende de quantos videos
// rodaram). Fica separado do custo por video de proposito: somar os dois num
// numero so faria o "custo por minuto" subir quando o mes tem POUCO video, que
// e o contrario do que a palavra sugere.
async function setInfra(req, res) {
  const valor = Number(req.body.infraMensalUsd);
  if (!Number.isFinite(valor) || valor < 0) {
    return res.status(400).json({ error: 'Informe um valor mensal válido (0 ou mais).' });
  }
  await settingsRepository.setValue('custo_infra_mensal_usd', valor);
  res.json({ ok: true, infraMensalUsd: valor });
}

module.exports = { overview, setCotacao, setInfra };
