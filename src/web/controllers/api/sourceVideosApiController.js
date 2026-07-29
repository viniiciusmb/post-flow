'use strict';

const sourceVideosRepository = require('../../../repositories/sourceVideosRepository');
const clipsRepository = require('../../../repositories/clipsRepository');

async function list(req, res) {
  const channelId = req.query.channelId ? Number(req.query.channelId) : null;
  const videos = await sourceVideosRepository.listForClient(req.session.user.id, { youtubeChannelId: channelId });
  res.json({
    videos: videos.map((v) => ({
      id: v.id,
      title: v.title,
      thumbnailUrl: v.thumbnail_url,
      channelName: v.channel_name,
      publishedAt: v.published_at,
      durationSeconds: v.duration_seconds,
      status: v.status,
      errorMessage: v.error_message,
      clipCount: v.clip_count,
    })),
  });
}

async function listClips(req, res) {
  const sourceVideo = await sourceVideosRepository.findById(Number(req.params.id));
  if (!sourceVideo) return res.status(404).json({ error: 'Video nao encontrado.' });

  const clips = await clipsRepository.listBySourceVideoId(sourceVideo.id);
  res.json({
    clips: clips.map((c) => ({
      id: c.id,
      title: c.title,
      startSeconds: Number(c.start_seconds),
      endSeconds: Number(c.end_seconds),
      status: c.status,
      errorMessage: c.error_message,
    })),
  });
}

module.exports = { list, listClips };
