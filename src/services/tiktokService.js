// Integracao com a API v2 do TikTok (Login Kit + dados basicos do perfil).
// Referencia: https://developers.tiktok.com/doc/oauth-user-access-token-management
'use strict';

const fs = require('fs');
const config = require('../config');
const logger = require('../lib/logger');

const AUTHORIZE_URL = 'https://www.tiktok.com/v2/auth/authorize/';
const TOKEN_URL = 'https://open.tiktokapis.com/v2/oauth/token/';
const REVOKE_URL = 'https://open.tiktokapis.com/v2/oauth/revoke/';
const USER_INFO_URL = 'https://open.tiktokapis.com/v2/user/info/';
const PUBLISH_INIT_URL = 'https://open.tiktokapis.com/v2/post/publish/inbox/video/init/';
// Publicacao DIRETA no perfil. Exige que o app tenha passado na auditoria da
// Content Posting API - antes disso a TikTok aceita a chamada mas forca tudo
// como SELF_ONLY (so o proprio criador ve).
const DIRECT_POST_INIT_URL = 'https://open.tiktokapis.com/v2/post/publish/video/init/';
// O que a conta do criador permite. A diretriz da TikTok exige que a tela de
// publicacao busque isso NA HORA, a cada abertura, e nao use valor guardado -
// o criador pode ter mudado as permissoes dele no aplicativo a qualquer
// momento, e oferecer uma opcao que ele desativou faz a publicacao falhar.
const CREATOR_INFO_URL = 'https://open.tiktokapis.com/v2/post/publish/creator_info/query/';
const PUBLISH_STATUS_URL = 'https://open.tiktokapis.com/v2/post/publish/status/fetch/';
// Teto de tamanho de pedaco da Content Posting API.
//
// ATENCAO: passar disso NAO e caso raro. O comentario aqui dizia que "qualquer
// corte nosso fica bem abaixo, entao na pratica e sempre 1 pedaco so" - deixou
// de ser verdade quando o modo "cortar o video inteiro em partes" comecou a
// gerar cortes de 3 minutos (~110 MB). Foi o que quebrou 6 postagens de um
// cliente em 23/08/2026.
const MAX_CHUNK_SIZE_BYTES = 64 * 1024 * 1024;

// Toda conversa com a TikTok passa por aqui.
//
// Duas protecoes que faltavam, e cuja ausencia perdeu uma publicacao real em
// 24/08/2026 ("fetch failed" no meio do envio, corte jogado direto pra aba de
// erros):
//
//   TIMEOUT - fetch sem AbortSignal espera pra sempre. Uma conexao pendurada
//             segurava o job inteiro ate o Node desistir sozinho.
//   RETENTATIVA - uma piscada de rede nao pode custar a publicacao. Repete so
//             o que e seguro repetir (ver abaixo) e so quando o erro e de
//             rede/sobrecarga; erro de parametro falha na hora, porque repetir
//             daria exatamente o mesmo resultado.
//
// SEGURANCA DE REPETIR: o PUT de um pedaco carrega Content-Range, entao
// reenviar o mesmo intervalo e inofensivo - a TikTok sobrescreve a mesma
// faixa. As consultas (creator info, status) sao leitura. O init reserva um
// publish_id novo a cada chamada: repetir pode deixar uma reserva orfa, que
// expira sozinha sem publicar nada, e isso e bem melhor que perder o corte.
const TIMEOUT_PADRAO_MS = 60 * 1000;
const TIMEOUT_UPLOAD_MS = 10 * 60 * 1000;
const TENTATIVAS_DE_REDE = 3;
const ESPERA_ENTRE_TENTATIVAS_MS = [2000, 8000];

function esperar(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Erro que vale repetir NESTE nivel: falha de transporte ou servidor
// sobrecarregado. Recusa por parametro invalido nao entra.
function falhaDeRede(erro) {
  const texto = String(erro?.message || '').toLowerCase();
  return (
    texto.includes('fetch failed') ||
    texto.includes('econnreset') ||
    texto.includes('econnrefused') ||
    texto.includes('etimedout') ||
    texto.includes('enotfound') ||
    texto.includes('eai_again') ||
    texto.includes('socket hang up') ||
    texto.includes('network') ||
    texto.includes('aborted') ||
    texto.includes('timeout')
  );
}

function statusMerecendoNovaTentativa(status) {
  return status === 429 || status >= 500;
}

async function fetchTiktok(url, opcoes = {}, { timeoutMs = TIMEOUT_PADRAO_MS, oQueE = 'a TikTok' } = {}) {
  let ultimoErro;
  for (let tentativa = 1; tentativa <= TENTATIVAS_DE_REDE; tentativa++) {
    const controlador = new AbortController();
    const alarme = setTimeout(() => controlador.abort(), timeoutMs);
    try {
      const resposta = await fetch(url, { ...opcoes, signal: controlador.signal });
      // 429/5xx: o problema e do outro lado e costuma passar. Erro de
      // parametro (4xx) sai daqui pro chamador tratar, sem repetir.
      if (statusMerecendoNovaTentativa(resposta.status) && tentativa < TENTATIVAS_DE_REDE) {
        ultimoErro = new Error(`http_${resposta.status} ao falar com ${oQueE}`);
        logger.warn(`TikTok devolveu HTTP ${resposta.status} (${oQueE}) - tentativa ${tentativa}/${TENTATIVAS_DE_REDE}.`);
        await esperar(ESPERA_ENTRE_TENTATIVAS_MS[tentativa - 1] || 8000);
        continue;
      }
      return resposta;
    } catch (err) {
      // AbortError do timeout chega aqui como "This operation was aborted".
      ultimoErro = err;
      if (!falhaDeRede(err) || tentativa === TENTATIVAS_DE_REDE) throw err;
      logger.warn(`Falha de rede falando com ${oQueE} (${err.message}) - tentativa ${tentativa}/${TENTATIVAS_DE_REDE}.`);
      await esperar(ESPERA_ENTRE_TENTATIVAS_MS[tentativa - 1] || 8000);
    } finally {
      clearTimeout(alarme);
    }
  }
  throw ultimoErro;
}

// Como o arquivo e dividido pro upload. Sao TRES regras da TikTok, e cada
// uma delas ja recusou uma publicacao nossa em producao (23/08/2026):
//
//   1. total_chunk_count = floor(video_size / chunk_size). O resto da divisao
//      NAO vira um pedaco a mais - ele e anexado ao ultimo pedaco, que por
//      isso pode passar de chunk_size (ate 128 MB). Usar Math.ceil manda um
//      pedaco a mais e a API recusa: "The total chunk count is invalid".
//
//   2. Um pedaco so exige chunk_size IGUAL ao tamanho do arquivo. Mandar
//      chunk_size=64 MB com total_chunk_count=1 pra um arquivo de 121 MB
//      passa na regra 1 (floor(121/64) = 1) mas e recusado com "The chunk
//      size is invalid" - foi o segundo erro, depois de corrigir o primeiro.
//
//   3. chunk_size vai de 5 MB a 64 MB.
//
// Juntando as tres: arquivo acima de 64 MB NUNCA pode ir num pedaco so (a
// regra 2 exigiria chunk_size maior que o teto da regra 3), entao ele vai em
// dois ou mais - e por isso limitamos o pedaco a metade do arquivo.
const MIN_CHUNK_SIZE_BYTES = 5 * 1024 * 1024;

function calcularPedacos(videoSizeBytes) {
  if (videoSizeBytes <= MAX_CHUNK_SIZE_BYTES) {
    return { chunkSize: videoSizeBytes, totalChunkCount: 1 };
  }
  // Metade do arquivo garante pelo menos 2 pedacos; o teto de 64 MB continua
  // valendo pros arquivos grandes. Acima de 64 MB, metade ja passa de 32 MB,
  // entao o minimo de 5 MB nunca fica em risco por essa conta.
  const chunkSize = Math.max(
    MIN_CHUNK_SIZE_BYTES,
    Math.min(MAX_CHUNK_SIZE_BYTES, Math.floor(videoSizeBytes / 2))
  );
  return { chunkSize, totalChunkCount: Math.floor(videoSizeBytes / chunkSize) };
}
// Status que a TikTok pode devolver enquanto ainda esta processando -
// qualquer coisa fora dessas duas listas conta como "ainda processando".
const PUBLISH_DONE_STATUSES = ['PUBLISH_COMPLETE', 'SEND_TO_USER_INBOX'];
const PUBLISH_FAILED_STATUSES = ['FAILED'];

// user.info.basic: nome/avatar pro painel. user.info.stats: seguidores/
// curtidas/videos pro dashboard do cliente. video.upload: escopo que a
// PUBLISH_INIT_URL de verdade exige, ja que ela usa o endpoint de INBOX
// (/inbox/video/init/, modo rascunho) - "video.publish" so vale pro
// endpoint de publicacao direta no perfil (/publish/video/init/), que
// nao e o que este app chama. Pedimos video.publish tambem so por
// seguranca/futuro, mas sozinho ele NAO autoriza o fluxo de inbox (foi
// a causa real do erro "did not authorize the scope" - nao tinha nada a
// ver com config do Developer Console). Pedimos tudo agora pra nao ter
// que refazer a conexao com o cliente depois - so vale a partir de
// quando o cliente reconectar (tokens antigos nao ganham escopo novo
// sozinhos).
const SCOPES = ['user.info.basic', 'user.info.stats', 'video.publish', 'video.upload'];

function buildAuthorizeUrl(state) {
  const params = new URLSearchParams({
    client_key: config.tiktok.clientKey,
    response_type: 'code',
    scope: SCOPES.join(','),
    redirect_uri: config.tiktok.redirectUri,
    state,
    // Sem isso, clicar em "Conectar outra conta" com o navegador ja logado
    // na TikTok pulava direto pra tela de sucesso reautorizando a MESMA
    // conta de antes (a TikTok reusa a sessao do navegador silenciosamente).
    // disable_auto_auth=1 forca a tela de autorizacao aparecer sempre, dando
    // chance da pessoa trocar de conta ali (ou sair/entrar com outra antes).
    disable_auto_auth: '1',
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

async function requestToken(body) {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  const data = await response.json();
  if (!response.ok || data.error) {
    throw new Error(`TikTok recusou a solicitacao de token: ${data.error_description || data.error || response.statusText}`);
  }
  return data;
}

function exchangeCodeForToken(code) {
  return requestToken(
    new URLSearchParams({
      client_key: config.tiktok.clientKey,
      client_secret: config.tiktok.clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: config.tiktok.redirectUri,
    })
  );
}

function refreshAccessToken(refreshToken) {
  return requestToken(
    new URLSearchParams({
      client_key: config.tiktok.clientKey,
      client_secret: config.tiktok.clientSecret,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    })
  );
}

async function getUserInfo(accessToken) {
  const params = new URLSearchParams({ fields: 'open_id,union_id,avatar_url,display_name' });
  const response = await fetch(`${USER_INFO_URL}?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  const data = await response.json();
  if (!response.ok || data.error?.code !== 'ok') {
    throw new Error(`Falha ao buscar dados do perfil TikTok: ${data.error?.message || response.statusText}`);
  }
  return data.data.user;
}

// Requer o escopo user.info.stats - se o token foi concedido so com
// user.info.basic (conexao antiga), a API devolve os campos de estatistica
// vazios/zerados em vez de dar erro, entao o chamador trata null com calma.
async function getUserStats(accessToken) {
  const params = new URLSearchParams({
    fields: 'follower_count,following_count,likes_count,video_count',
  });
  const response = await fetch(`${USER_INFO_URL}?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  const data = await response.json();
  if (!response.ok || data.error?.code !== 'ok') {
    throw new Error(`Falha ao buscar estatisticas do perfil TikTok: ${data.error?.message || response.statusText}`);
  }
  return data.data.user;
}

// Busca o que a conta do criador permite: apelido e foto (que a tela e
// obrigada a mostrar, pro criador saber em qual conta vai sair), quais niveis
// de privacidade ele pode escolher, se comentario/duet/juncao estao
// desativados na conta dele, e a duracao maxima de video que ele pode postar.
async function queryCreatorInfo(accessToken) {
  const response = await fetchTiktok(CREATOR_INFO_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json; charset=UTF-8' },
  });
  const data = await response.json();
  if (!response.ok || data.error?.code !== 'ok') {
    throw new Error(`Falha ao consultar as opcoes de publicacao no TikTok: ${data.error?.message || response.statusText}`);
  }
  const d = data.data || {};
  return {
    creatorNickname: d.creator_nickname || null,
    creatorUsername: d.creator_username || null,
    creatorAvatarUrl: d.creator_avatar_url || null,
    privacyLevelOptions: d.privacy_level_options || [],
    commentDisabled: Boolean(d.comment_disabled),
    duetDisabled: Boolean(d.duet_disabled),
    stitchDisabled: Boolean(d.stitch_disabled),
    maxVideoPostDurationSec: d.max_video_post_duration_sec ?? null,
  };
}

// Publicacao DIRETA no perfil. Tudo em post_info vem de escolha manual do
// criador na nossa tela (ver migration 048): a TikTok reprova app que
// pre-seleciona privacidade ou que liga comentario/duet/juncao sozinho.
async function initDirectPost(accessToken, videoSizeBytes, postInfo) {
  const { chunkSize, totalChunkCount } = calcularPedacos(videoSizeBytes);

  const response = await fetchTiktok(DIRECT_POST_INIT_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json; charset=UTF-8' },
    body: JSON.stringify({
      post_info: {
        title: postInfo.caption || '',
        privacy_level: postInfo.privacyLevel,
        disable_comment: postInfo.disableComment,
        disable_duet: postInfo.disableDuet,
        disable_stitch: postInfo.disableStitch,
        brand_content_toggle: postInfo.brandContentToggle,
        brand_organic_toggle: postInfo.brandOrganicToggle,
      },
      source_info: {
        source: 'FILE_UPLOAD',
        video_size: videoSizeBytes,
        chunk_size: chunkSize,
        total_chunk_count: totalChunkCount,
      },
    }),
  });

  const data = await response.json();
  if (!response.ok || data.error?.code !== 'ok') {
    // O CODIGO junto da mensagem, sempre. A TikTok manda quase todo erro de
    // publicacao com o mesmo texto generico ("review our integration
    // guidelines" + link), entao so a mensagem nao distingue "app sem
    // auditoria" de "video longo demais" de "privacidade invalida" - e sem
    // isso o log vira um erro sem pista, que foi o que aconteceu em producao.
    const codigo = data.error?.code || `http_${response.status}`;
    throw new Error(`TikTok recusou publicar no perfil [${codigo}]: ${data.error?.message || response.statusText}`);
  }
  return { publishId: data.data.publish_id, uploadUrl: data.data.upload_url, chunkSize, totalChunkCount };
}

// Inicia a publicacao em modo rascunho/inbox (o app ainda nao foi aprovado
// pra "Direct Post" - ver migrations/006_create_postings.sql). A TikTok
// devolve uma URL pra onde mandamos os bytes do video em seguida.
async function initInboxVideo(accessToken, videoSizeBytes) {
  const { chunkSize, totalChunkCount } = calcularPedacos(videoSizeBytes);

  const response = await fetchTiktok(PUBLISH_INIT_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json; charset=UTF-8' },
    body: JSON.stringify({
      source_info: {
        source: 'FILE_UPLOAD',
        video_size: videoSizeBytes,
        chunk_size: chunkSize,
        total_chunk_count: totalChunkCount,
      },
    }),
  });

  const data = await response.json();
  if (!response.ok || data.error?.code !== 'ok') {
    throw new Error(`TikTok recusou iniciar a publicacao: ${data.error?.message || response.statusText}`);
  }
  return { publishId: data.data.publish_id, uploadUrl: data.data.upload_url, chunkSize, totalChunkCount };
}

// Envia os bytes do arquivo pra upload_url devolvida pelo init, em pedacos
// (ver calcularPedacos - corte de 3 minutos passa de 64 MB e vai em varios).
async function uploadVideoFile(uploadUrl, filePath, videoSizeBytes, chunkSize, totalChunkCount) {
  const fd = fs.openSync(filePath, 'r');
  try {
    for (let i = 0; i < totalChunkCount; i++) {
      const ultimo = i === totalChunkCount - 1;
      const start = i * chunkSize;
      // O ULTIMO pedaco leva todo o resto do arquivo, nao apenas chunkSize
      // bytes: como total_chunk_count e arredondado pra baixo, os bytes que
      // sobram da divisao pertencem a ele. Parar em start+chunkSize deixaria
      // o fim do video pra tras e a TikTok ficaria esperando bytes que nunca
      // chegam.
      const end = (ultimo ? videoSizeBytes : Math.min(start + chunkSize, videoSizeBytes)) - 1;
      const length = end - start + 1;
      const buffer = Buffer.alloc(length);
      fs.readSync(fd, buffer, 0, length, start);

      const response = await fetchTiktok(
        uploadUrl,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'video/mp4',
            'Content-Range': `bytes ${start}-${end}/${videoSizeBytes}`,
            'Content-Length': String(length),
          },
          body: buffer,
        },
        { timeoutMs: TIMEOUT_UPLOAD_MS, oQueE: `envio do pedaco ${i + 1}/${totalChunkCount}` }
      );
      if (!response.ok && response.status !== 201) {
        const text = await response.text().catch(() => '');
        throw new Error(
          `Falha ao enviar o video pro TikTok (pedaco ${i + 1}/${totalChunkCount}): HTTP ${response.status} ${text.slice(0, 300)}`
        );
      }
    }
  } finally {
    fs.closeSync(fd);
  }
}

// Consulta se a TikTok ja terminou de processar a publicacao. Devolve
// { done, failed, raw } - "raw" fica disponivel pra log quando algo sair
// diferente do esperado (a API pode ter mudado desde a ultima checagem).
async function fetchPublishStatus(accessToken, publishId) {
  const response = await fetchTiktok(PUBLISH_STATUS_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json; charset=UTF-8' },
    body: JSON.stringify({ publish_id: publishId }),
  });

  const data = await response.json();
  if (!response.ok || data.error?.code !== 'ok') {
    throw new Error(`Falha ao consultar status da publicacao no TikTok: ${data.error?.message || response.statusText}`);
  }

  const status = data.data?.status;
  return {
    done: PUBLISH_DONE_STATUSES.includes(status),
    failed: PUBLISH_FAILED_STATUSES.includes(status),
    failReason: data.data?.fail_reason || null,
    postIds: data.data?.publicaly_available_post_id || null,
    raw: data.data,
  };
}

// Diz a TikTok pra esquecer a autorizacao desta conta.
//
// Sem isso, "Desconectar" so marcava inativo no NOSSO banco: a autorizacao
// continuava concedida do lado da TikTok pra sempre. Duas consequencias:
//
//   - a Politica de Privacidade promete "ao desconectar, apagamos os tokens de
//     acesso e o servico para de agir naquela conta imediatamente" - e a
//     segunda metade era verdade, a primeira nao;
//   - reconectar depois pulava a tela de permissoes (a TikTok trata como
//     reautorizacao silenciosa), o que atrapalha ate gravar a demonstracao do
//     app pra propria TikTok.
//
// Falhar aqui NAO impede a desconexao: se a TikTok estiver fora do ar, o
// cliente ainda tem direito de nos tirar o acesso agora. O token some do nosso
// lado de qualquer jeito.
async function revokeAccess(accessToken) {
  const response = await fetch(REVOKE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_key: config.tiktok.clientKey,
      client_secret: config.tiktok.clientSecret,
      token: accessToken,
    }).toString(),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error) {
    throw new Error(`TikTok recusou revogar o acesso: ${data.error_description || data.error || response.statusText}`);
  }
}

module.exports = {
  calcularPedacos,
  queryCreatorInfo,
  revokeAccess,
  initDirectPost,
  buildAuthorizeUrl,
  exchangeCodeForToken,
  refreshAccessToken,
  getUserInfo,
  getUserStats,
  initInboxVideo,
  uploadVideoFile,
  fetchPublishStatus,
};
