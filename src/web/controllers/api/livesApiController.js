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

// O canal como o usuario enxerga: alem do que a tela do admin mostra, se o
// automatico esta ligado PRA ELE e se ele mandou clipar so esta live.
function canalDoUsuario(c) {
  const base = admin.canalParaApi(c);
  const autoClipar = !c.paused_at;
  const clipandoEstaLive = Boolean(c.clip_this_live_at) && Boolean(c.is_live);
  return {
    ...base,
    autoClipar,
    clipandoEstaLive,
    clipandoEstaLiveDesde: clipandoEstaLive ? c.clip_this_live_at : null,
    // Recebe corte desta live: automatico ligado ou "clipar esta live" pedido.
    recebendoCortes: autoClipar || clipandoEstaLive,
    seguindoDesde: c.followed_at || null,
  };
}

async function estado(req, res) {
  const userId = req.session.user.id;
  await admin.atualizarStatus(await livesRepository.listChannelsForUser(userId));
  const [ligado, canais, opcoes] = await Promise.all([
    settingsRepository.getValue('lives_enabled', false),
    livesRepository.listChannelsForUser(userId),
    livesUserSettings.obter(userId),
  ]);
  res.json({
    // Desligado pelo admin: a tela avisa que nada esta sendo gravado agora, em
    // vez de o botao "Clipar" parecer quebrado.
    servicoAtivo: ligado === true && !config.lives.forcarDesligado,
    plataformas: plataformas.PLATAFORMAS.map((p) => ({ id: p, nome: plataformas.NOMES[p], disponivel: plataformas.disponivel(p) })),
    canais: canais.map(canalDoUsuario),
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
  const r = await admin.seguirCanal(userId, req.body);
  if (r.error) return res.status(r.status).json({ error: r.error });
  if (req.body?.autoClipar === false) await livesRepository.setPaused(userId, r.canal.id, true);
  return estado(req, res);
}

async function removerCanal(req, res) {
  const removeu = await livesRepository.unfollow(req.session.user.id, Number(req.params.id));
  if (!removeu) return res.status(404).json({ error: 'Voce nao acompanha esse canal.' });
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
  return estado(req, res);
}

async function cliparEstaLive(req, res) {
  const userId = req.session.user.id;
  const id = Number(req.params.id);
  if (!(await livesRepository.isFollowing(userId, id))) return res.status(404).json({ error: 'Voce nao acompanha esse canal.' });
  const ok = await livesRepository.setClipThisLive(userId, id, true);
  if (!ok) return res.status(409).json({ error: 'Esse canal nao esta ao vivo agora.' });
  return estado(req, res);
}

async function pararEstaLive(req, res) {
  const ok = await livesRepository.setClipThisLive(req.session.user.id, Number(req.params.id), false);
  if (!ok) return res.status(404).json({ error: 'Voce nao acompanha esse canal.' });
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
