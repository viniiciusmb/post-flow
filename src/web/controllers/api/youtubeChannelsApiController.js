'use strict';

const youtubeChannelsRepository = require('../../../repositories/youtubeChannelsRepository');
const youtubeChannelService = require('../../../services/youtubeChannelService');

async function list(req, res) {
  const channels = await youtubeChannelsRepository.listByClientId(req.session.user.id);
  res.json({
    channels: channels.map((c) => ({
      id: c.id,
      channelName: c.channel_name,
      channelUrl: c.channel_url,
      avatarUrl: c.avatar_url,
      isActive: c.is_active,
      lastPolledAt: c.last_polled_at,
    })),
  });
}

async function create(req, res) {
  const { channelUrl } = req.body;
  if (!channelUrl) {
    return res.status(400).json({ error: 'Informe o link ou @handle do canal.' });
  }

  let resolved;
  try {
    resolved = await youtubeChannelService.resolveChannel(channelUrl);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const channel = await youtubeChannelsRepository.create({
    clientUserId: req.session.user.id,
    youtubeChannelId: resolved.channelId,
    channelName: resolved.channelName,
    channelUrl: resolved.channelUrl,
    avatarUrl: resolved.avatarUrl,
  });

  if (!channel) {
    return res.status(409).json({ error: 'Esse canal ja esta cadastrado.' });
  }

  res.status(201).json({
    channel: {
      id: channel.id,
      channelName: channel.channel_name,
      channelUrl: channel.channel_url,
      avatarUrl: channel.avatar_url,
      isActive: channel.is_active,
      lastPolledAt: channel.last_polled_at,
    },
  });
}

async function setActive(req, res) {
  const channel = await youtubeChannelsRepository.setActive(
    Number(req.params.id),
    req.session.user.id,
    req.body.isActive === true
  );
  if (!channel) return res.status(404).json({ error: 'Canal nao encontrado.' });
  res.json({ channel: { id: channel.id, isActive: channel.is_active } });
}

async function remove(req, res) {
  await youtubeChannelsRepository.remove(Number(req.params.id), req.session.user.id);
  res.status(204).end();
}

module.exports = { list, create, setActive, remove };
