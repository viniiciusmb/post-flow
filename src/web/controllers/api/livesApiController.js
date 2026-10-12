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
  };
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
  const r = await admin.seguirCanal(userId, req.body, { admin: ehAdmin(req) });
  if (r.error) return res.status(r.status).json({ error: r.error, ...(r.limite ? { limite: true } : {}) });
  if (req.body?.autoClipar === false) await livesRepository.setPaused(userId, r.canal.id, true);
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
  const ok = await livesRepository.setPaused(userId, id, !req.body.ligado);
  if (!ok) return res.status(404).json({ error: 'Voce nao acompanha esse canal.' });
  // Ligou o automatico: a marca de "so esta live" fica redundante.
  if (req.body.ligado) await livesRepository.setClipThisLive(userId, id, false);
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
