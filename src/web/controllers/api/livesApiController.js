// Tela "Lives" que vai pros clientes (menu "Lives"). A tela do admin
// ("Lives Admin", adminLivesApiController) continua sendo onde se liga o
// modulo, se mexe nos limites do servidor e se ve o custo; esta aqui so tem o
// que e do usuario: os canais dele, o "clipar sempre que estiver ao vivo", o
// botao de clipar e os cortes.
//
// Tudo opera sobre o usuario da sessao - nenhuma rota recebe id de usuario.
'use strict';

const livesRepository = require('../../../repositories/livesRepository');
const settingsRepository = require('../../../repositories/settingsRepository');
const livesUserSettings = require('../../../services/lives/livesUserSettings');
const tiposDeMomento = require('../../../services/lives/tiposDeMomento');
const plataformas = require('../../../services/lives/plataformas');
const config = require('../../../config');
const admin = require('./adminLivesApiController');
const liveCreditosService = require('../../../services/lives/liveCreditosService');
const limitesDasLivesService = require('../../../services/lives/limitesDasLivesService');
const planLimitsService = require('../../../services/planLimitsService');

function ehAdmin(req) {
  return req.session.user.role === 'admin';
}

// O canal como o usuario enxerga: alem do que a tela do admin mostra, se o
// automatico esta ligado PRA ELE e se ele mandou clipar so esta live.
function canalDoUsuario(c, usoDaLive) {
  const base = admin.canalParaApi(c);
  const autoClipar = !c.paused_at;
  const clipandoEstaLive = Boolean(c.clip_this_live_at) && Boolean(c.is_live);
  return {
    ...base,
    autoClipar,
    clipandoEstaLive,
    clipandoEstaLiveDesde: clipandoEstaLive ? c.clip_this_live_at : null,
    // Recebe corte desta live: automatico ligado ou "clipar esta live" pedido,
    // e o limite do plano deixando (ver limitesDasLivesService).
    recebendoCortes: (autoClipar || clipandoEstaLive) && !c.bloqueio,
    // 'fora_do_plano' | 'outra_live' | null - a tela explica cada um.
    bloqueio: c.bloqueio || null,
    seguindoDesde: c.followed_at || null,
    // Creditos que a gravacao EM ANDAMENTO ja usou pra esta pessoa, e se o
    // credito acabou nela (a pessoa parou de receber cortes desta live).
    creditosNestaLive: usoDaLive ? Number(usoDaLive.credits_charged) : 0,
    semCredito: Boolean(usoDaLive?.out_of_credit_at),
    // Limites de segurança escolhidos pra este canal (null = sem aquele limite).
    limites: {
      horas: c.limite_horas === null || c.limite_horas === undefined ? null : Number(c.limite_horas),
      cortes: c.limite_cortes === null || c.limite_cortes === undefined ? null : Number(c.limite_cortes),
      pctCota: c.limite_pct_cota === null || c.limite_pct_cota === undefined ? null : Number(c.limite_pct_cota),
    },
    // A live em andamento parou num limite: 'horas' | 'cortes' | 'cota' | null.
    paradoPorLimite: usoDaLive?.parado_por_limite_at ? usoDaLive.motivo_limite : null,
  };
}

// Limites de segurança do "Clipar sempre" (ver liveCreditosService.limiteAtingido).
// Cada um pode vir null (sem aquele limite). Devolve { limites } ou { error }.
function validarLimites(corpo) {
  if (!corpo || typeof corpo !== 'object') return { error: 'Informe os limites.' };
  const faixa = (valor, min, max, nome, inteiro) => {
    if (valor === null || valor === undefined || valor === '') return { v: null };
    const n = Number(valor);
    if (!Number.isFinite(n) || n < min || n > max || (inteiro && !Number.isInteger(n))) {
      return { error: `${nome} precisa ficar entre ${min} e ${max}.` };
    }
    return { v: inteiro ? n : Math.round(n * 2) / 2 };
  };
  const horas = faixa(corpo.horas, 0.5, 24, 'O limite de horas', false);
  const cortes = faixa(corpo.cortes, 1, 500, 'O limite de cortes', true);
  const pctCota = faixa(corpo.pctCota, 5, 100, 'O limite da cota', true);
  const erro = horas.error || cortes.error || pctCota.error;
  if (erro) return { error: erro };
  return { limites: { horas: horas.v, cortes: cortes.v, pctCota: pctCota.v } };
}

async function estado(req, res) {
  const userId = req.session.user.id;
  await admin.atualizarStatus(await livesRepository.listChannelsForUser(userId));
  // O status ao vivo acabou de ser atualizado: o bloqueio de "uma live por vez"
  // precisa refletir isso antes de a tela ser montada.
  await limitesDasLivesService.recalcular();
  const [ligado, canais, opcoes, usos, saldo, isento, limites] = await Promise.all([
    settingsRepository.getValue('lives_enabled', false),
    livesRepository.listChannelsForUser(userId),
    livesUserSettings.obter(userId),
    livesRepository.creditUsageForUser(userId),
    liveCreditosService.saldo(userId),
    liveCreditosService.isento(userId),
    planLimitsService.limitesDasNovidadesDoCliente(userId, { admin: ehAdmin(req) }),
  ]);
  const usoPorCanal = new Map(usos.map((u) => [Number(u.live_channel_id), u]));
  res.json({
    // Desligado pelo admin: a tela avisa que nada esta sendo gravado agora, em
    // vez de o botao "Clipar" parecer quebrado.
    servicoAtivo: ligado === true && !config.lives.forcarDesligado,
    plataformas: plataformas.PLATAFORMAS.map((p) => ({ id: p, nome: plataformas.NOMES[p], disponivel: plataformas.disponivel(p) })),
    canais: canais.map((c) => canalDoUsuario(c, usoPorCanal.get(Number(c.id)))),
    // O mesmo credito dos cortes do YouTube: 3 minutos de live = 1 credito.
    creditos: {
      disponiveis: saldo,
      isento,
      minutosDeLivePorCredito: liveCreditosService.SEGUNDOS_POR_CREDITO / 60,
      cliparAgora: liveCreditosService.CREDITOS_CLIPAR_AGORA,
    },
    // Quantos segundos pra tras o "Clipar este momento" pega - a tela mostra
    // essa janela no relogio da live antes do clique.
    janelaCliparAgoraS: admin.JANELA_CLIPAR_AGORA_S,
    // Limite do plano (o mesmo número que o servidor usa pra barrar).
    limites: {
      semPlano: limites.semPlano,
      plano: limites.plano,
      canais: limites.canaisDeLive,
      aoMesmoTempo: limites.livesAoMesmoTempo,
    },
    opcoes: admin.opcoesParaApi(opcoes),
    niveis: livesUserSettings.NIVEIS,
    categorias: tiposDeMomento.CATEGORIAS.map(({ id, nome, descricao }) => ({ id, nome, descricao })),
  });
}

async function salvarOpcoes(req, res) {
  const r = await admin.validarOpcoes(req.session.user.id, req.body || {});
  if (r.error) return res.status(400).json({ error: r.error });
  return estado(req, res);
}

// Adicionar ja diz se e pra clipar sempre (padrao) ou so quando a pessoa pedir.
async function adicionarCanal(req, res) {
  const userId = req.session.user.id;
  let limites = null;
  if (req.body?.limites !== undefined) {
    const v = validarLimites(req.body.limites);
    if (v.error) return res.status(400).json({ error: v.error });
    limites = v.limites;
  }
  const r = await admin.seguirCanal(userId, req.body, { admin: ehAdmin(req) });
  if (r.error) return res.status(r.status).json({ error: r.error, ...(r.limite ? { limite: true } : {}) });
  if (req.body?.autoClipar === false) await livesRepository.setPaused(userId, r.canal.id, true);
  if (limites) await livesRepository.setFollowLimits(userId, r.canal.id, limites);
  return estado(req, res);
}

async function removerCanal(req, res) {
  const removeu = await livesRepository.unfollow(req.session.user.id, Number(req.params.id));
  if (!removeu) return res.status(404).json({ error: 'Voce nao acompanha esse canal.' });
  // Remover um canal libera vaga pro que estava fora do plano.
  await limitesDasLivesService.recalcular();
  return estado(req, res);
}

// "Clipar sempre que estiver ao vivo" = o canal sem pausa. Desligar com a live
// em andamento para de gravar pra essa pessoa na proxima volta do supervisor
// (o "clipar esta live" e o caminho pra continuar so nesta).
async function definirAutomatico(req, res) {
  const userId = req.session.user.id;
  const id = Number(req.params.id);
  if (typeof req.body?.ligado !== 'boolean') return res.status(400).json({ error: 'Informe ligado: true ou false.' });
  // Ligar pode vir junto com os limites de segurança que a janela perguntou.
  let limites = null;
  if (req.body.ligado && req.body.limites !== undefined) {
    const v = validarLimites(req.body.limites);
    if (v.error) return res.status(400).json({ error: v.error });
    limites = v.limites;
  }
  const ok = await livesRepository.setPaused(userId, id, !req.body.ligado);
  if (!ok) return res.status(404).json({ error: 'Voce nao acompanha esse canal.' });
  if (limites) await livesRepository.setFollowLimits(userId, id, limites);
  // Ligou o automatico: a marca de "so esta live" fica redundante.
  if (req.body.ligado) await livesRepository.setClipThisLive(userId, id, false);
  await limitesDasLivesService.recalcular();
  return estado(req, res);
}

async function definirLimites(req, res) {
  const v = validarLimites(req.body);
  if (v.error) return res.status(400).json({ error: v.error });
  const ok = await livesRepository.setFollowLimits(req.session.user.id, Number(req.params.id), v.limites);
  if (!ok) return res.status(404).json({ error: 'Voce nao acompanha esse canal.' });
  return estado(req, res);
}

// A live em andamento parou num limite de segurança e o cliente quer seguir:
// volta a receber cortes dela, e os limites não valem mais nesta live.
async function continuarMesmoAssim(req, res) {
  const ok = await livesRepository.continueDespiteLimits(req.session.user.id, Number(req.params.id));
  if (!ok) return res.status(404).json({ error: 'Esta live não está parada por um limite.' });
  await limitesDasLivesService.recalcular();
  return estado(req, res);
}

async function cliparEstaLive(req, res) {
  const userId = req.session.user.id;
  const id = Number(req.params.id);
  if (!(await livesRepository.isFollowing(userId, id))) return res.status(404).json({ error: 'Voce nao acompanha esse canal.' });
  const bloqueioAntes = await livesRepository.followBlock(userId, id);
  if (bloqueioAntes === 'fora_do_plano') {
    return res.status(403).json({
      error: 'Este canal passou do limite de canais de live do seu plano. Remova outro canal ou troque de plano em "Plano e uso".',
    });
  }
  const ok = await livesRepository.setClipThisLive(userId, id, true);
  if (!ok) return res.status(409).json({ error: 'Esse canal nao esta ao vivo agora.' });
  await limitesDasLivesService.recalcular();
  // O plano clipa N lives por vez e as N vagas já estão em uso: desfaz o
  // pedido e diz qual live está ocupando a vaga, em vez de aceitar e não
  // gravar nada.
  if ((await livesRepository.followBlock(userId, id)) === 'outra_live') {
    await livesRepository.setClipThisLive(userId, id, false);
    await limitesDasLivesService.recalcular();
    const ocupando = (await livesRepository.listChannelsForUser(userId)).filter(
      (c) => Number(c.id) !== id && c.is_live && !c.bloqueio && (!c.paused_at || c.clip_this_live_at)
    );
    const nomes = ocupando.map((c) => c.display_name || c.login).join(', ');
    return res.status(409).json({
      error: `Seu plano clipa 1 live por vez${nomes ? ` e você já está clipando ${nomes}` : ''}. Pare aquela live antes de clipar esta.`,
      limite: true,
    });
  }
  return estado(req, res);
}

async function pararEstaLive(req, res) {
  const ok = await livesRepository.setClipThisLive(req.session.user.id, Number(req.params.id), false);
  if (!ok) return res.status(404).json({ error: 'Voce nao acompanha esse canal.' });
  await limitesDasLivesService.recalcular();
  return estado(req, res);
}

module.exports = {
  validarLimites,
  definirLimites,
  continuarMesmoAssim,
  estado,
  salvarOpcoes,
  adicionarCanal,
  removerCanal,
  definirAutomatico,
  cliparEstaLive,
  pararEstaLive,
  // Estes ja respondem por conta propria e so olham o usuario da sessao.
  obterEstilo: admin.obterEstilo,
  salvarEstilo: admin.salvarEstilo,
  cliparAgora: admin.cliparAgora,
  listarCortes: admin.listarCortes,
  arquivoDoCorte: admin.arquivoDoCorte,
  apagarCorte: admin.apagarCorte,
};
