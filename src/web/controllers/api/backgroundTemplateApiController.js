// Template de fundo: a imagem que o cliente sobe pra aparecer atrás do corte
// (moldura, arte da marca, publicidade). O vídeo é composto POR CIMA dela.
//
// Cada alvo tem o seu: o padrão do cliente (todos os canais) e cada canal que
// tenha estilo próprio podem ter templates diferentes.
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('../../../config');
const logger = require('../../../lib/logger');
const clientVideoSettingsRepository = require('../../../repositories/clientVideoSettingsRepository');
const youtubeChannelsRepository = require('../../../repositories/youtubeChannelsRepository');

// Ficam junto dos arquivos de vídeo (mesmo volume compartilhado entre o web e
// o video-worker) porque quem lê a imagem na hora de renderizar é o
// video-worker, e quem grava é o web.
function pastaDoCliente(clientUserId) {
  return path.join(config.videoProcessing.workDir, 'templates', String(clientUserId));
}

async function resolverAlvo(req) {
  const bruto = req.query.channelId ?? req.body?.channelId;
  if (bruto === undefined || bruto === null || bruto === '' || bruto === 'all') {
    return { channelId: null };
  }
  const id = Number(bruto);
  if (!Number.isInteger(id)) return { erro: 'Canal inválido.' };
  const canal = await youtubeChannelsRepository.findById(id);
  if (!canal || String(canal.client_user_id) !== String(req.session.user.id)) {
    return { erro: 'Canal não encontrado.' };
  }
  return { channelId: id };
}

// Confere a assinatura real do arquivo (os primeiros bytes), não a extensão nem
// o content-type que o navegador declarou. Os dois são escolhidos por quem
// envia, então um .png pode ser qualquer coisa; esses bytes não mentem.
function tipoDaImagem(caminho) {
  const buffer = Buffer.alloc(12);
  const fd = fs.openSync(caminho, 'r');
  try {
    fs.readSync(fd, buffer, 0, 12, 0);
  } finally {
    fs.closeSync(fd);
  }
  if (buffer.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpeg';
  if (buffer.slice(0, 4).toString('ascii') === 'RIFF' && buffer.slice(8, 12).toString('ascii') === 'WEBP') return 'webp';
  return null;
}

async function upload(req, res) {
  if (!req.file) return res.status(400).json({ error: 'Nenhuma imagem foi enviada.' });

  const alvo = await resolverAlvo(req);
  if (alvo.erro) {
    fs.rmSync(req.file.path, { force: true });
    return res.status(404).json({ error: alvo.erro });
  }

  const tipo = tipoDaImagem(req.file.path);
  if (!tipo) {
    fs.rmSync(req.file.path, { force: true });
    return res.status(400).json({ error: 'Envie uma imagem PNG, JPG ou WEBP.' });
  }

  const destinoDir = pastaDoCliente(req.session.user.id);
  fs.mkdirSync(destinoDir, { recursive: true });
  const nome = `${alvo.channelId ?? 'padrao'}-${crypto.randomBytes(6).toString('hex')}.${tipo}`;
  const destino = path.join(destinoDir, nome);
  fs.renameSync(req.file.path, destino);

  // Guarda a configuração atual do alvo pra não perder o resto ao gravar só o
  // caminho do template.
  const atual = alvo.channelId
    ? (await clientVideoSettingsRepository.findChannelOverride(req.session.user.id, alvo.channelId)) ||
      (await clientVideoSettingsRepository.findByClientId(req.session.user.id))
    : await clientVideoSettingsRepository.findByClientId(req.session.user.id);

  // O template só faz sentido com o vídeo ocupando menos que a tela inteira.
  // Se ainda estiver em 100%, cai pra 70% pra imagem aparecer de cara, em vez
  // de o cliente subir a arte e achar que não funcionou.
  const alturaAtual = Number(atual.background_video_height_percent ?? 100);
  const salvo = await clientVideoSettingsRepository.upsert(
    req.session.user.id,
    {
      aspectRatio: atual.aspect_ratio,
      framing: atual.framing,
      quality: atual.quality,
      captionStyle: atual.caption_style,
      clipLength: atual.clip_length,
      clipMode: atual.clip_mode,
      maxClips: atual.max_clips,
      showTitle: atual.show_title,
      titleSeconds: atual.title_seconds,
      descriptionMode: atual.description_mode,
      descriptionTemplate: atual.description_template,
      cropStyleMode: atual.crop_style_mode,
      cropZoomPercent: atual.crop_zoom_percent,
      showPartLabel: atual.show_part_label,
      partLabelPosition: atual.part_label_position,
      titleStyle: atual.title_style,
      backgroundTemplatePath: destino,
      backgroundVideoHeightPercent: alturaAtual >= 100 ? 70 : alturaAtual,
      backgroundVideoOffsetPercent: Number(atual.background_video_offset_percent ?? 50),
    },
    alvo.channelId
  );

  // O arquivo antigo vira lixo em disco assim que o novo entra.
  if (atual.background_template_path && atual.background_template_path !== destino) {
    fs.rmSync(atual.background_template_path, { force: true });
  }

  res.json({
    ok: true,
    backgroundVideoHeightPercent: salvo.background_video_height_percent,
    backgroundVideoOffsetPercent: salvo.background_video_offset_percent,
  });
}

// Serve a imagem pro editor. Nunca expõe caminho de disco: a rota recebe o
// alvo, o servidor descobre o arquivo e confere que ele é daquele cliente.
async function download(req, res) {
  const alvo = await resolverAlvo(req);
  if (alvo.erro) return res.status(404).json({ error: alvo.erro });

  const settings = alvo.channelId
    ? await clientVideoSettingsRepository.findChannelOverride(req.session.user.id, alvo.channelId)
    : await clientVideoSettingsRepository.findByClientId(req.session.user.id);

  const caminho = settings && settings.background_template_path;
  if (!caminho || !fs.existsSync(caminho)) {
    return res.status(404).json({ error: 'Nenhum template enviado pra esse alvo.' });
  }
  // Segunda checagem de posse: mesmo com o registro no banco, o arquivo tem que
  // estar dentro da pasta desse cliente.
  if (!path.resolve(caminho).startsWith(path.resolve(pastaDoCliente(req.session.user.id)) + path.sep)) {
    logger.error(`Template fora da pasta do cliente ${req.session.user.id}: ${caminho}`);
    return res.status(404).json({ error: 'Template não encontrado.' });
  }
  res.sendFile(path.resolve(caminho));
}

async function remove(req, res) {
  const alvo = await resolverAlvo(req);
  if (alvo.erro) return res.status(404).json({ error: alvo.erro });

  const atual = alvo.channelId
    ? await clientVideoSettingsRepository.findChannelOverride(req.session.user.id, alvo.channelId)
    : await clientVideoSettingsRepository.findByClientId(req.session.user.id);

  if (atual && atual.background_template_path) {
    fs.rmSync(atual.background_template_path, { force: true });
    await clientVideoSettingsRepository.upsert(
      req.session.user.id,
      {
        aspectRatio: atual.aspect_ratio,
        framing: atual.framing,
        quality: atual.quality,
        captionStyle: atual.caption_style,
        clipLength: atual.clip_length,
        clipMode: atual.clip_mode,
        maxClips: atual.max_clips,
        showTitle: atual.show_title,
        titleSeconds: atual.title_seconds,
        descriptionMode: atual.description_mode,
        descriptionTemplate: atual.description_template,
        cropStyleMode: atual.crop_style_mode,
        cropZoomPercent: atual.crop_zoom_percent,
        showPartLabel: atual.show_part_label,
        partLabelPosition: atual.part_label_position,
        titleStyle: atual.title_style,
        backgroundTemplatePath: null,
        backgroundVideoHeightPercent: 100,
        backgroundVideoOffsetPercent: 50,
      },
      alvo.channelId
    );
  }
  res.json({ ok: true });
}

module.exports = { upload, download, remove };
