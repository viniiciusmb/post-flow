// Resolve um link/@handle de canal do YouTube pro ID real + nome/avatar,
// buscando a pagina publica do canal (nao precisa de cookie nem de login -
// isso so e necessario pra listar/baixar videos, ver ytDlpService.js).
'use strict';

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

function extractChannelId(html, fallbackUrl) {
  const canonical = html.match(/\/channel\/(UC[\w-]{10,})/);
  if (canonical) return canonical[1];
  const fromUrl = fallbackUrl.match(/\/channel\/(UC[\w-]{10,})/);
  return fromUrl ? fromUrl[1] : null;
}

async function resolveChannel(input) {
  const raw = String(input || '').trim();
  if (!raw) throw new Error('Informe o link ou @handle do canal.');

  const pageUrl = /^https?:\/\//i.test(raw)
    ? raw
    : `https://www.youtube.com/${raw.startsWith('@') ? raw : `@${raw}`}`;

  const response = await fetch(pageUrl, { headers: { 'User-Agent': USER_AGENT } });
  if (!response.ok) {
    throw new Error(`Nao foi possivel acessar o canal (HTTP ${response.status}). Confira o link.`);
  }
  const html = await response.text();

  const channelId = extractChannelId(html, pageUrl);
  if (!channelId) {
    throw new Error('Nao foi possivel identificar o ID do canal. Confira se o link esta correto.');
  }

  const titleMatch = html.match(/<meta property="og:title" content="([^"]*)"/);
  const imageMatch = html.match(/<meta property="og:image" content="([^"]*)"/);

  return {
    channelId,
    channelName: titleMatch ? titleMatch[1] : null,
    avatarUrl: imageMatch ? imageMatch[1] : null,
    channelUrl: `https://www.youtube.com/channel/${channelId}`,
  };
}

module.exports = { resolveChannel };
