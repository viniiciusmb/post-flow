// Modelos de estilo de corte: listar (prontos + do cliente), salvar a
// configuração de um alvo como modelo, aplicar um modelo em vários alvos e
// apagar.
//
// Aplicar passa pelo MESMO validarEstilo da tela de configuração: um modelo
// nunca grava valor que o editor recusaria. E passa pelo mesmo upsert, então
// o alvo fica exatamente como se o cliente tivesse escolhido cada campo à mão.
'use strict';

const clientVideoSettingsRepository = require('../../../repositories/clientVideoSettingsRepository');
const clipStyleModelsRepository = require('../../../repositories/clipStyleModelsRepository');
const youtubeChannelsRepository = require('../../../repositories/youtubeChannelsRepository');
const sourceVideosRepository = require('../../../repositories/sourceVideosRepository');
const modelosDeCorte = require('../../../lib/modelosDeCorte');
const { toApiWithOptions, validarEstilo } = require('./clientVideoSettingsApiController');

const MAX_MODELOS = 30;

function modeloParaApi(m) {
  return { id: Number(m.id), nome: m.name, campos: m.campos };
}

async function listar(req, res) {
  const meus = await clipStyleModelsRepository.listByClient(req.session.user.id);
  res.json({
    padroes: modelosDeCorte.PADROES.map((p) => ({ chave: p.chave, nome: p.nome, descricao: p.descricao, campos: p.campos })),
    meus: meus.map(modeloParaApi),
  });
}

async function canalDoCliente(id, clientUserId) {
  const canal = await youtubeChannelsRepository.findById(Number(id));
  return canal && String(canal.client_user_id) === String(clientUserId) ? canal : null;
}

// A configuração atual de um alvo, sem herança escondida: canal sem estilo
// próprio e vídeo sem estilo próprio seguem o padrão do cliente, então é ele
// que vale.
async function configuracaoDoAlvo(clientUserId, alvo) {
  if (alvo.sourceVideoId) {
    return (
      (await clientVideoSettingsRepository.findVideoOverride(clientUserId, alvo.sourceVideoId)) ||
      (await clientVideoSettingsRepository.findByClientId(clientUserId))
    );
  }
  if (alvo.youtubeChannelId) {
    return (
      (await clientVideoSettingsRepository.findChannelOverride(clientUserId, alvo.youtubeChannelId)) ||
      (await clientVideoSettingsRepository.findByClientId(clientUserId))
    );
  }
  return clientVideoSettingsRepository.findByClientId(clientUserId);
}

// POST /modelos { nome, channelId? , sourceVideoId? } - salva o estilo do alvo.
async function salvar(req, res) {
  const nome = String(req.body?.nome ?? '').trim();
  if (!nome || nome.length > 60) return res.status(400).json({ error: 'Dê um nome de até 60 letras ao modelo.' });

  const clientUserId = req.session.user.id;
  let alvo = {};
  if (req.body.channelId) {
    const canal = await canalDoCliente(req.body.channelId, clientUserId);
    if (!canal) return res.status(404).json({ error: 'Canal não encontrado.' });
    alvo = { youtubeChannelId: Number(canal.id) };
  } else if (req.body.sourceVideoId) {
    const video = await sourceVideosRepository.findByIdOwnedByClient(Number(req.body.sourceVideoId), clientUserId);
    if (!video) return res.status(404).json({ error: 'Vídeo não encontrado.' });
    alvo = { sourceVideoId: Number(video.id) };
  }

  const existentes = await clipStyleModelsRepository.listByClient(clientUserId);
  const mesmoNome = existentes.some((m) => m.name.trim().toLowerCase() === nome.toLowerCase());
  if (!mesmoNome && existentes.length >= MAX_MODELOS) {
    return res.status(400).json({ error: `Você já tem ${MAX_MODELOS} modelos. Apague um pra salvar outro.` });
  }

  const atual = await configuracaoDoAlvo(clientUserId, alvo);
  const campos = modelosDeCorte.extrairCampos(toApiWithOptions(atual));
  const salvo = await clipStyleModelsRepository.salvar(clientUserId, nome, campos);
  res.status(salvo.substituido ? 200 : 201).json({ modelo: modeloParaApi(salvo), substituido: salvo.substituido });
}

async function apagar(req, res) {
  const ok = await clipStyleModelsRepository.remove(Number(req.params.id), req.session.user.id);
  if (!ok) return res.status(404).json({ error: 'Modelo não encontrado.' });
  res.json({ ok: true });
}

// POST /modelos/aplicar
//   { padrao: 'viral' } ou { modeloId: 3 }
//   alvos: { padraoDoCliente?: true, channelIds?: [1,2], sourceVideoId?: 9 }
async function aplicar(req, res) {
  const clientUserId = req.session.user.id;
  const body = req.body || {};

  let campos;
  if (body.padrao) {
    const p = modelosDeCorte.padraoPorChave(String(body.padrao));
    if (!p) return res.status(404).json({ error: 'Modelo não encontrado.' });
    campos = p.campos;
  } else if (body.modeloId) {
    const m = await clipStyleModelsRepository.findOwned(Number(body.modeloId), clientUserId);
    if (!m) return res.status(404).json({ error: 'Modelo não encontrado.' });
    campos = m.campos;
  } else {
    return res.status(400).json({ error: 'Escolha um modelo.' });
  }
  // Só os campos que um modelo pode levar - um modelo gravado à mão no banco
  // com idioma ou caminho de arquivo não passa por aqui.
  campos = modelosDeCorte.extrairCampos(campos);

  const pedido = body.alvos || {};
  const alvos = [];
  if (pedido.sourceVideoId) {
    const video = await sourceVideosRepository.findByIdOwnedByClient(Number(pedido.sourceVideoId), clientUserId);
    if (!video) return res.status(404).json({ error: 'Vídeo não encontrado.' });
    alvos.push({ sourceVideoId: Number(video.id) });
  }
  if (pedido.padraoDoCliente) alvos.push({});
  const ids = Array.isArray(pedido.channelIds) ? [...new Set(pedido.channelIds.map(Number))] : [];
  for (const id of ids) {
    // Canal de outro cliente invalida o pedido inteiro: aplicar nos outros e
    // calar sobre este esconderia que algo foi recusado.
    const canal = await canalDoCliente(id, clientUserId);
    if (!canal) return res.status(404).json({ error: 'Canal não encontrado.' });
    alvos.push({ youtubeChannelId: Number(canal.id) });
  }
  if (alvos.length === 0) return res.status(400).json({ error: 'Escolha onde aplicar o modelo.' });

  // Valida TUDO antes de gravar qualquer coisa: um alvo inválido no meio não
  // pode deixar metade dos canais com o modelo novo e metade sem.
  const planos = [];
  const avisos = [];
  for (const alvo of alvos) {
    const atual = await configuracaoDoAlvo(clientUserId, alvo);
    const corpo = { ...campos };
    // Fundo de imagem só existe onde a imagem foi enviada. Sem ela, o alvo
    // fica com o fundo desfocado (e a tela avisa), em vez de recusar o modelo
    // inteiro por causa de um detalhe.
    if (corpo.backgroundStyle === 'template' && !atual.background_template_path) {
      corpo.backgroundStyle = 'blur';
      avisos.push('fundo_de_imagem');
    }
    const validado = validarEstilo(corpo, atual);
    if (validado.erro) return res.status(400).json({ error: res.locals.t(validado.erro) });
    planos.push({ alvo, entrada: validado.entrada });
  }
  for (const { alvo, entrada } of planos) {
    await clientVideoSettingsRepository.upsert(clientUserId, entrada, alvo);
  }
  res.json({ aplicados: planos.length, avisos: [...new Set(avisos)] });
}

module.exports = { listar, salvar, apagar, aplicar, MAX_MODELOS };
