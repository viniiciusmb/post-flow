// Listagem e download de videos via yt-dlp.
//
// O YouTube bloqueia IP de servidor por padrao ("Sign in to confirm you're
// not a bot"). Testado manualmente (ver commits e memoria
// post-flow-youtube-bot-block-fix) contra videos reais:
//   - So o provedor de PO token (bgutil-ytdlp-pot-provider, ja rodando em
//     producao como servico `postflow_potprovider`) sem cookie: passa pra
//     quase todo video, mas um video especifico (canal "Renato Cariani")
//     ainda falhou com "Sign in to confirm you're not a bot" mesmo assim -
//     sinal de que alguns videos caem num nivel mais rigoroso de checagem.
//   - Cookie sozinho (sem forcar client) e contraproducente: faz o yt-dlp
//     preferir o client "web", que o YouTube trava via streaming SABR-only
//     (so devolve storyboard, nenhum formato de video real).
//   - Um proxy residencial pago (YTDLP_PROXY_URL) resolveria pra qualquer
//     video, mas o usuario pediu pra evitar custo recorrente - so fica como
//     ultimo recurso, nao configurado em producao hoje.
// A combinacao ainda nao testada (2026-07-30): cookie de uma conta AUTENTICADA
// de verdade + POT token + client explicito nao-web (android/tv, que nao sao
// SABR-forcados) ao mesmo tempo - antes cookie e POT eram mutuamente
// exclusivos no codigo, o que nunca deixou essa combinacao ser tentada.
'use strict';

const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');
const config = require('../config');
const { PausedError } = require('../lib/errors');
const downloadTunnelsRepository = require('../repositories/downloadTunnelsRepository');
const settingsRepository = require('../repositories/settingsRepository');

const RESIDENTIAL_PROXY_ENABLED_KEY = 'residential_proxy_enabled';

let cookiesFilePathCache = null;

function getCookiesFilePath() {
  if (cookiesFilePathCache) return cookiesFilePathCache;
  if (!config.youtube.cookiesBase64) return null;

  const filePath = path.join(os.tmpdir(), 'post-flow-youtube-cookies.txt');
  fs.writeFileSync(filePath, Buffer.from(config.youtube.cookiesBase64, 'base64'));
  cookiesFilePathCache = filePath;
  return filePath;
}

// Lista de candidatos em ordem de prioridade, cada um com o tipo (pra
// rastrear consumo de banda por origem no painel "Banda") e checando o
// proprio "ligado": tunel do cliente dono do video (se ele tiver o
// programa instalado e o founder nao tiver desativado essa chave em
// especifico), tunel de fallback do dono do sistema (se ligado no painel),
// proxy pago (se ligado no painel). Nao filtra por "connected" nos tuneis
// (esse campo so alimenta o painel) - a tentativa de verdade e o teste
// mais confiavel, e o loop de candidatos ja lida com falha.
async function getCandidates(clientUserId) {
  const candidates = [];

  if (config.tunnel.relaySocksHost) {
    if (clientUserId) {
      const clientTunnel = await downloadTunnelsRepository.findByClientId(clientUserId);
      if (clientTunnel && clientTunnel.enabled) {
        candidates.push({
          type: 'client_tunnel',
          tunnelId: clientTunnel.id,
          url: `socks5://${config.tunnel.relaySocksHost}:${clientTunnel.assigned_port}`,
        });
      }
    }

    const founderTunnel = await downloadTunnelsRepository.findFounderTunnel();
    if (founderTunnel && founderTunnel.enabled) {
      candidates.push({
        type: 'founder_tunnel',
        tunnelId: founderTunnel.id,
        url: `socks5://${config.tunnel.relaySocksHost}:${founderTunnel.assigned_port}`,
      });
    }
  }

  // Rele Tailscale (dormant hoje, YTDLP_TAILSCALE_PROXY_URL nao configurado
  // em producao) - sem toggle proprio, so entra se um dia for configurado.
  if (config.youtube.tailscaleProxyUrl) {
    candidates.push({ type: 'proxy', tunnelId: null, url: config.youtube.tailscaleProxyUrl });
  }

  if (config.youtube.proxyUrl) {
    const proxyEnabled = await settingsRepository.getValue(RESIDENTIAL_PROXY_ENABLED_KEY, true);
    if (proxyEnabled) {
      candidates.push({ type: 'proxy', tunnelId: null, url: config.youtube.proxyUrl });
    }
  }

  return candidates;
}

// null = deixa o yt-dlp escolher sozinho (hoje cai no android_vr quando nao
// ha cookie); os outros forcam um client explicito via extractor-args - nem
// "android" nem "tv" sao afetados pelo SABR-only que trava o client "web".
// Tentados em sequencia quando um falha, nao em paralelo.
function getPlayerClientCandidates() {
  return [null, 'android', 'tv'];
}

// A DataImpulse e um proxy residencial ROTATIVO por padrao: sem sessao fixa,
// cada conexao pode sair por um IP diferente. O YouTube assina a URL de
// download do video com o IP que pediu os metadados (player API) - se o
// pedido do video em si sair por outro IP, da 403 mesmo com o proxy
// funcionando perfeitamente (confirmado testando ao vivo, 2026-08-14). O
// parametro `;sessid.X` da DataImpulse prende a mesma tentativa (um
// processo yt-dlp = varios requests HTTP internos) num unico IP por ate
// 30min - gerar um id aleatorio novo a cada tentativa (nao por video, nao
// fixo) tambem evita um unico IP residencial acumular todo o trafego do
// sistema.
function withFreshDataImpulseSession(proxyUrl) {
  const match = /^(https?:\/\/)([^:]+):([^@]+)@(gw\.dataimpulse\.com.*)$/.exec(proxyUrl || '');
  if (!match) return proxyUrl;
  const [, scheme, username, password, hostPort] = match;
  const sessionId = crypto.randomBytes(6).toString('hex');
  return `${scheme}${username};sessid.${sessionId}:${password}@${hostPort}`;
}

function runOnce(args, { timeoutMs = 5 * 60 * 1000, proxyUrl = null, playerClient = null, checkCancelled = null } = {}) {
  return new Promise((resolve, reject) => {
    const authArgs = [];

    if (proxyUrl) {
      authArgs.push('--proxy', withFreshDataImpulseSession(proxyUrl));
    }
    if (playerClient) {
      authArgs.push('--extractor-args', `youtube:player_client=${playerClient}`);
    }
    if (config.youtube.potProviderUrl) {
      authArgs.push('--extractor-args', `youtubepot-bgutilhttp:base_url=${config.youtube.potProviderUrl}`);
    }
    // Cookie agora e somado ao POT/client explicito (nao mais mutuamente
    // exclusivo) - ver comentario no topo do arquivo.
    const cookies = getCookiesFilePath();
    if (cookies) {
      authArgs.push('--cookies', cookies);
    }

    const hasAnyAuth = Boolean(proxyUrl || config.youtube.potProviderUrl || cookies);
    if (!hasAnyAuth) {
      return reject(
        new Error('Nenhum proxy, POT provider nem cookie configurados - sem isso o YouTube bloqueia a VPS.')
      );
    }

    // detached:true poe o yt-dlp num grupo de processos proprio - importante
    // porque yt-dlp as vezes chama ffmpeg internamente (pra juntar
    // video+audio, --merge-output-format). Matando so o yt-dlp direto
    // (child.kill), esse ffmpeg filho vira orfao e continua rodando sozinho -
    // e o 'close' do child so dispara quando TODOS os descritores herdados
    // fecham, entao o processo parecia "nao morrer" ate o ffmpeg orfao
    // terminar sozinho. killGroup mata o grupo inteiro de uma vez.
    const child = spawn(config.ytdlpPath, [...authArgs, ...args], { detached: true });
    function killGroup() {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        // grupo ja morreu - ignora
      }
    }
    let stdout = '';
    let stderr = '';
    let cancelled = false;
    const timer = setTimeout(() => {
      killGroup();
      reject(new Error(`yt-dlp excedeu o tempo limite (${timeoutMs / 1000}s).`));
    }, timeoutMs);

    // Confere pausa a cada 2s enquanto o download roda - sem isso, pausar so
    // tinha efeito depois que o yt-dlp inteiro terminasse (podia levar
    // minutos num video longo).
    const cancelPoll = checkCancelled
      ? setInterval(async () => {
          if (cancelled) return;
          if (await checkCancelled()) {
            cancelled = true;
            killGroup();
          }
        }, 2000)
      : null;

    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (err) => {
      clearTimeout(timer);
      if (cancelPoll) clearInterval(cancelPoll);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (cancelPoll) clearInterval(cancelPoll);
      if (cancelled) {
        return reject(new PausedError('Download interrompido pelo cliente.'));
      }
      if (code !== 0) {
        return reject(new Error(`yt-dlp saiu com codigo ${code}: ${stderr.slice(-800)}`));
      }
      resolve(stdout);
    });
  });
}

// Tenta cada combinacao de client (null/android/tv) x candidato (tunel do
// cliente > tunel de fallback do founder > proxy pago, cada um so se
// "ligado") em sequencia; se todas falharem, desiste (sem dobrar tentativas
// de novo - variar o client ja cobre o caso "esse video caiu num nivel de
// checagem mais rigoroso", que era o motivo de tentar de novo antes).
// Devolve tambem QUAL candidato funcionou (usedCandidate) - usado pra
// registrar consumo de banda por origem no painel "Banda".
// allowDirect: acrescenta "sair pelo IP da propria VPS" como ULTIMA tentativa.
// Vale so pras chamadas leves (listar canal, ler metadados): elas funcionam
// direto da VPS, enquanto o DOWNLOAD e justamente o que o YouTube bloqueia por
// IP de datacenter - por isso o download nao ganha esse fallback.
//
// Isso conserta uma falha real: a checagem de canal saia obrigatoriamente pelo
// tunel (a internet de casa do dono do sistema). Com o computador dele
// desligado, a checagem falhava - e ficava 3 dias sem detectar video novo, sem
// nenhum aviso, mesmo com o YouTube respondendo normalmente pra VPS.
async function run(args, { clientUserId, allowDirect = false, ...opts } = {}) {
  const candidates = await getCandidates(clientUserId);
  if (allowDirect) candidates.push({ type: 'direct', tunnelId: null, url: null });
  const candidatesToTry = candidates.length ? candidates : [{ type: 'direct', tunnelId: null, url: null }];
  const playerClientsToTry = getPlayerClientCandidates();

  let lastErr;
  for (const playerClient of playerClientsToTry) {
    for (const candidate of candidatesToTry) {
      try {
        const stdout = await runOnce(args, { ...opts, proxyUrl: candidate.url, playerClient });
        return { stdout, usedCandidate: candidate };
      } catch (err) {
        // Pausa pedida pelo cliente nao e um erro transitorio de bloqueio -
        // continuar tentando outros clients fazia o "Pausar" demorar bem mais
        // do que devia, porque cada nova tentativa precisava do seu proprio
        // ciclo de detectar+matar de novo. Propaga na hora, sem tentar de novo.
        if (err instanceof PausedError) throw err;
        lastErr = err;
      }
    }
  }
  throw lastErr;
}

// Espera aleatoria (10-40s) antes de cada download de verdade (nao na
// listagem/metadados, que e leve e ja funcionava sem isso) - evita um padrao
// de rajada (varios downloads em sequencia imediata) que pode ajudar a
// contar como sinal de trafego automatizado pro YouTube. Confere pausa a
// cada 2s igual ao resto do pipeline, pra "Pausar" continuar instantaneo.
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitBeforeDownload(checkCancelled) {
  const totalMs = 10_000 + Math.floor(Math.random() * 30_000);
  const stepMs = 2000;
  let waited = 0;
  while (waited < totalMs) {
    if (checkCancelled && (await checkCancelled())) {
      throw new PausedError('Download interrompido pelo cliente (durante espera anti-bloqueio).');
    }
    const step = Math.min(stepMs, totalMs - waited);
    await sleep(step);
    waited += step;
  }
}

function parseUploadDate(value) {
  if (!value || value.length !== 8) return null;
  return new Date(`${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`);
}

// Lista os videos recentes de um canal (modo "flat" - rapido, sem baixar nada).
async function listChannelVideos(channelUrl, { limit = 15 } = {}) {
  const { stdout } = await run(
    [
      '--flat-playlist',
      '--dump-json',
      '--playlist-end', String(limit),
      '--no-warnings',
      // Com cookie configurado, o yt-dlp faz uma checagem extra de sessao antes
      // de listar a playlist do canal. Essa checagem falhava sozinha quando a
      // conexao oscilava e derrubava a listagem inteira com uma mensagem que
      // nao tem nada a ver ("Playlists that require authentication...") - o
      // proprio yt-dlp recomenda pular isso quando nao se baixa conteudo
      // privado, que e o nosso caso.
      '--extractor-args', 'youtubetab:skip=authcheck',
      `${channelUrl.replace(/\/$/, '')}/videos`,
    ],
    { allowDirect: true }
  );

  return stdout
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .map((entry) => ({
      videoId: entry.id,
      title: entry.title,
      thumbnailUrl: entry.thumbnails?.at(-1)?.url || null,
      publishedAt: parseUploadDate(entry.upload_date),
      durationSeconds: entry.duration || null,
    }));
}

// Aceita watch?v=, youtu.be/, /shorts/ - o que o cliente for colar.
function extractVideoId(url) {
  const match = String(url || '').match(/(?:v=|youtu\.be\/|\/shorts\/)([a-zA-Z0-9_-]{11})/);
  return match ? match[1] : null;
}

// Busca so os metadados de um video (sem baixar).
//
// Usado em dois lugares: quando o cliente cola um link manualmente, e quando a
// checagem de canal encontra um video novo.
//
// O segundo caso existe por um motivo especifico: a listagem do canal
// (--flat-playlist) devolve o titulo TRADUZIDO pelo YouTube - um video com
// titulo "ABRIMOS UM RESTAURANTE" chegava como "WE OPENED A RESTAURANT". Ja a
// consulta de UM video devolve o titulo original e o idioma declarado. E uma
// chamada a mais por video NOVO (nao por checagem), o que e barato.
async function getVideoMetadata(url) {
  const { stdout } = await run(['--dump-json', '--no-warnings', '--no-playlist', '--skip-download', url], {
    allowDirect: true,
  });
  const entry = JSON.parse(stdout.trim().split('\n')[0]);
  return {
    videoId: entry.id,
    title: entry.title,
    thumbnailUrl: entry.thumbnails?.at(-1)?.url || null,
    publishedAt: parseUploadDate(entry.upload_date),
    durationSeconds: entry.duration || null,
    // Idioma declarado do video ('pt-BR', 'en'...). Serve de palpite inicial
    // ate o Whisper detectar o idioma falado de verdade.
    language: entry.language || null,
  };
}

// Baixa video+audio pro disco (mp4, ate 480p) e devolve o caminho do arquivo.
//
// 480p e uma decisao de CUSTO, tomada pelo fundador em 23/08/2026: o corte
// final e um recorte vertical bem mais estreito que a largura do original,
// e a banda e paga por GB quando sai pelo proxy residencial. Era 720p antes.
// Trocar de volta e mudar os dois numeros da linha abaixo - nada mais no
// pipeline depende dessa resolucao.
async function downloadVideo(videoId, outputDir, { checkCancelled, clientUserId } = {}) {
  fs.mkdirSync(outputDir, { recursive: true });
  const outputTemplate = path.join(outputDir, '%(id)s.%(ext)s');

  await waitBeforeDownload(checkCancelled);

  const { usedCandidate } = await run(
    [
      '-f', 'bestvideo[height<=480]+bestaudio/best[height<=480]',
      '--merge-output-format', 'mp4',
      '--no-warnings',
      '-o', outputTemplate,
      `https://www.youtube.com/watch?v=${videoId}`,
    ],
    { timeoutMs: 20 * 60 * 1000, checkCancelled, clientUserId }
  );

  const filePath = path.join(outputDir, `${videoId}.mp4`);
  if (!fs.existsSync(filePath)) {
    throw new Error('Download concluído mas o arquivo esperado não foi encontrado em disco.');
  }
  return { filePath, egressType: usedCandidate.type, tunnelId: usedCandidate.tunnelId };
}

module.exports = { listChannelVideos, downloadVideo, extractVideoId, getVideoMetadata };
