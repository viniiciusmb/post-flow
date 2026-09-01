// Edicao de video via ffmpeg: extrair audio (pra mandar pro Whisper),
// cortar um trecho, reenquadrar (proporcao/enquadramento configuraveis por
// cliente), queimar legenda estilo TikTok e titulo opcional, tudo numa
// passada so, mais a capa (thumbnail) do corte pronto.
'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { PausedError } = require('../lib/errors');
const logger = require('../lib/logger');

const FFMPEG_PATH = process.env.FFMPEG_PATH || 'ffmpeg';
const FFPROBE_PATH = process.env.FFPROBE_PATH || 'ffprobe';

// Um formato de saida so. O produto publica em TikTok e Reels, e os dois
// querem 9:16 em 1080x1920 - as outras proporcoes que existiam aqui geravam
// arquivo que nenhum destino do sistema aceita (migration 070).
const SAIDA = { w: 1080, h: 1920 };

// Um preset de render so, pelo mesmo motivo: a escolha "alta/media" saiu da
// tela (migration 070). CRF 20 com preset 'medium' era o padrao de sempre.
const RENDER = { crf: 20, preset: 'medium' };

// Um estilo de legenda/titulo e um punhado de numeros do formato ASS. Em vez
// de guardar a linha inteira pronta (como era antes), guardamos so o que MUDA
// entre os estilos - porque a fonte e a altura agora sao escolha do cliente e
// precisam entrar em qualquer um deles.
//
// Campos que importam:
//   corLetra    cor do texto (&HAABBGGRR - o ASS inverte, e AA=00 e opaco)
//   corCaixa    fundo atras do texto; so tem efeito com caixa: true
//   caixa       true = retangulo solido atras do texto (ASS BorderStyle 3),
//               false = contorno + sombra (BorderStyle 1)
//   contorno    espessura do contorno; com caixa:true vira o respiro da caixa
//   tamanho     corpo da fonte, em pixels de um quadro de 1080x1920
//
// Se um dia forem guardadas linhas prontas de novo, fonte e altura voltam a
// ser impossiveis de aplicar sem reescrever texto na mao.
const PRETO = '&H00000000';
const BRANCO = '&H00FFFFFF';

const CAPTION_STYLES = {
  classic: { tamanho: 96, corLetra: BRANCO, caixa: false, contorno: 7 },
  bold: { tamanho: 112, corLetra: '&H0000D7FF', caixa: false, contorno: 9 },
  minimal: { tamanho: 64, corLetra: BRANCO, caixa: false, contorno: 3 },
  bubble_dark: { tamanho: 90, corLetra: BRANCO, caixa: true, corCaixa: '&H50000000', contorno: 14 },
  bubble_purple: { tamanho: 90, corLetra: BRANCO, caixa: true, corCaixa: '&H50B26EF2', contorno: 14 },
  // Modelos novos. Cada um tem que ser reconhecivel A DISTANCIA na galeria da
  // tela - dois estilos que so diferem em 4 pixels de contorno viram uma
  // escolha sem sentido pra quem esta decidindo.
  neon_verde: { tamanho: 100, corLetra: '&H0000FF7F', caixa: false, contorno: 8 },
  vermelho_forte: { tamanho: 104, corLetra: BRANCO, caixa: true, corCaixa: '&H002323D9', contorno: 16 },
  amarelo_caixa: { tamanho: 96, corLetra: PRETO, caixa: true, corCaixa: '&H0000D7FF', contorno: 16 },
  branco_caixa: { tamanho: 92, corLetra: PRETO, caixa: true, corCaixa: '&H00FFFFFF', contorno: 16 },
  contorno_grosso: { tamanho: 108, corLetra: BRANCO, caixa: false, contorno: 14 },
  // Caixa na cor que o cliente escolher. corCaixa vem de fora (ver corDaCaixa
  // em linhaDeEstilo) - um modelo so cobre qualquer cor, em vez de um modelo
  // por cor.
  caixa_colorida: { tamanho: 96, corLetra: BRANCO, caixa: true, corPersonalizada: true, contorno: 16 },
};

const TITLE_STYLES = {
  classic: { tamanho: 72, corLetra: BRANCO, caixa: false, contorno: 6 },
  bold: { tamanho: 80, corLetra: '&H0000D7FF', caixa: false, contorno: 7 },
  minimal: { tamanho: 56, corLetra: BRANCO, caixa: false, contorno: 3 },
  bubble_dark: { tamanho: 64, corLetra: BRANCO, caixa: true, corCaixa: '&H50000000', contorno: 12 },
  bubble_purple: { tamanho: 64, corLetra: BRANCO, caixa: true, corCaixa: '&H50B26EF2', contorno: 12 },
  neon_verde: { tamanho: 76, corLetra: '&H0000FF7F', caixa: false, contorno: 7 },
  vermelho_forte: { tamanho: 72, corLetra: BRANCO, caixa: true, corCaixa: '&H002323D9', contorno: 14 },
  amarelo_caixa: { tamanho: 72, corLetra: PRETO, caixa: true, corCaixa: '&H0000D7FF', contorno: 14 },
  branco_caixa: { tamanho: 70, corLetra: PRETO, caixa: true, corCaixa: '&H00FFFFFF', contorno: 14 },
  contorno_grosso: { tamanho: 82, corLetra: BRANCO, caixa: false, contorno: 12 },
  caixa_colorida: { tamanho: 76, corLetra: BRANCO, caixa: true, corPersonalizada: true, contorno: 14 },
  // Papel rasgado: o texto sai SEM caixa (o fundo e a imagem sobreposta pelo
  // ffmpeg, nao o formato de legenda). So contorno leve, pra garantir leitura
  // caso o texto passe da borda do papel.
  papel_rasgado: { tamanho: 76, corLetra: BRANCO, caixa: false, contorno: 3 },
};

// Fontes que existem DENTRO do container (ver assets/fonts/LEIA-ME.md e o
// Dockerfile). Pedir uma que nao esta instalada nao da erro: o libass troca
// por outra em silencio, e o video sai com um visual que ninguem escolheu -
// foi exatamente o que acontecia quando os estilos pediam "Arial Black" num
// container que so tinha DejaVu.
const FONTES = {
  Anton: 'Anton',
  'Bebas Neue': 'Bebas Neue',
  Poppins: 'Poppins',
  'Liberation Sans': 'Liberation Sans',
  'DejaVu Sans': 'DejaVu Sans',
};
const FONTE_PADRAO = 'Anton';

// A imagem do papel rasgado. Vai junto no repositorio (nao e baixada) e e
// gerada por scripts/gerar-papel-rasgado.js de forma deterministica: rodar de
// novo produz o mesmo arquivo, entao o visual nao muda sem alguem decidir.
const CAMINHO_PAPEL_RASGADO = path.join(__dirname, '..', '..', 'assets', 'imagens', 'papel-rasgado.png');

// Largura do papel em relacao a do quadro. Nao e o texto que define o tamanho:
// medir a largura que o texto VAI ter exigiria renderizar antes, e uma imagem
// esticada pra caber no texto deformaria o rasgado - o que denuncia na hora
// que e falso. Faixa de largura fixa e o que o visual de referencia usa.
const LARGURA_DO_PAPEL = 0.86;

// Tamanho real do arquivo de papel (assets/imagens/papel-rasgado.png). Escrito
// aqui porque o filtro passou a declarar a altura explicitamente pra poder
// crescer com o titulo - e sem a proporcao original, o papel de UMA linha
// sairia esticado ou achatado em relacao ao que sempre foi.
const LARGURA_DO_PAPEL_ORIGINAL = 1080;
const ALTURA_DO_PAPEL_ORIGINAL = 300;

// Respiro entre a ultima letra e a borda rasgada, quando o papel precisa
// crescer pra caber o titulo.
const RESPIRO_DO_PAPEL = 40;

// #RRGGBB -> &HAABBGGRR. O ASS inverte a ordem dos canais e usa 00 como
// OPACO no primeiro par - errar isso da uma cor plausivel mas trocada (azul
// virando vermelho), que passa despercebido ate alguem reparar.
function hexParaAss(hex) {
  const limpo = String(hex || '').replace('#', '').trim();
  if (!/^[0-9a-fA-F]{6}$/.test(limpo)) return '&H000000FF';
  const r = limpo.slice(0, 2);
  const g = limpo.slice(2, 4);
  const b = limpo.slice(4, 6);
  return `&H00${b}${g}${r}`.toUpperCase();
}

// #RRGGBB -> fatores 0..1 pro colorchannelmixer do ffmpeg. A imagem do papel e
// BRANCA, entao multiplicar pelos fatores da exatamente a cor pedida, e a
// transparencia das bordas passa intacta.
function hexParaFatores(hex) {
  const limpo = String(hex || '').replace('#', '').trim();
  const valido = /^[0-9a-fA-F]{6}$/.test(limpo) ? limpo : 'D92323';
  return {
    r: parseInt(valido.slice(0, 2), 16) / 255,
    g: parseInt(valido.slice(2, 4), 16) / 255,
    b: parseInt(valido.slice(4, 6), 16) / 255,
  };
}

function fonteValida(nome) {
  return FONTES[nome] || FONTE_PADRAO;
}

// Altura vem em % da altura do video, medida a partir da borda mais proxima
// (legenda sobe de baixo, titulo desce de cima). Vira MarginV, que no ASS e
// justamente a distancia ate a borda do lado do alinhamento.
const ALTURA_DO_VIDEO = 1920;

function margemVertical(percentual, padrao) {
  const p = Number.isFinite(Number(percentual)) ? Number(percentual) : padrao;
  const limitado = Math.min(Math.max(p, 0), 80);
  return Math.round((limitado / 100) * ALTURA_DO_VIDEO);
}

// Monta a linha "Style:" do ASS a partir do preset + escolhas do cliente.
// A ordem dos campos e fixa pelo formato (ver o Format: no cabecalho) - por
// isso ela e montada num lugar so.
function linhaDeEstilo({ nome, preset, fonte, alinhamento, margemV, corEscolhida }) {
  const borderStyle = preset.caixa ? 3 : 1;

  // A COR DA CAIXA VAI EM OutlineColour, nao em BackColour.
  //
  // Com BorderStyle=3 o libass pinta o retangulo com a cor de CONTORNO;
  // BackColour vira so a sombra. Nao e o que o nome dos campos sugere, e o
  // erro e invisivel em teste de codigo: o video renderiza sem erro nenhum,
  // so com a caixa na cor errada.
  //
  // Foi assim que o modelo "balao roxo" passou a existencia inteira saindo
  // PRETO - a cor roxa estava em BackColour, que nunca pintou nada. Confere o
  // relato antigo de "escolhi uma legenda e saiu outra parecida, com cor
  // errada", que na epoca foi atribuido a outra causa.
  const corDoContorno = preset.caixa
    ? preset.corPersonalizada
      ? hexParaAss(corEscolhida)
      : preset.corCaixa
    : PRETO;
  const corDeFundo = preset.caixa ? '&H80000000' : PRETO;

  return [
    `Style: ${nome}`,
    fonte,
    preset.tamanho,
    preset.corLetra,
    '&H000000FF',
    corDoContorno,
    corDeFundo,
    1, 0, 0, 0,
    100, 100, 0, 0,
    borderStyle,
    preset.contorno,
    0,
    alinhamento,
    80, 80,
    margemV,
    1,
  ].join(',');
}

// Tamanho do adesivo "Parte N" quando o cliente deixa em 100%.
//
// Era 56 fixo no codigo - menos da metade da legenda (96-112) num video que e
// assistido no celular. O fundador relatou em 01/09/2026 que ele "quase nao
// aparece". 96 poe a numeracao no mesmo patamar de leitura da legenda, e o
// cliente ajusta de 50% a 200% a partir dai (part_label_size_percent).
const TAMANHO_BASE_DA_NUMERACAO = 96;

// O respiro da caixa atras da numeracao acompanha o tamanho da letra. Fixo em
// 10 (como era), uma numeracao de 200% ficaria espremida numa caixa de 56 -
// o tipo de defeito que so aparece no tamanho que ninguem testou.
const RESPIRO_DA_CAIXA_DA_NUMERACAO = 10 / 56;

function tamanhoDaNumeracao(percentual) {
  const p = Number.isFinite(Number(percentual)) ? Number(percentual) : 100;
  const limitado = Math.min(Math.max(p, 50), 200);
  return Math.round((TAMANHO_BASE_DA_NUMERACAO * limitado) / 100);
}

// ---------------------------------------------------------------------------
// Titulo que quebra linha
// ---------------------------------------------------------------------------

// Quanto uma letra ocupa, em media, em relacao ao corpo da fonte.
//
// Serve so pra DECIDIR ONDE QUEBRAR a linha - nao ha como medir texto de
// verdade aqui (quem tem as metricas e o libass, dentro do ffmpeg). Os valores
// sao propositalmente GENEROSOS: superestimar a largura quebra a linha antes
// do necessario (o titulo fica com uma linha a mais, e continua centralizado),
// enquanto subestimar deixaria o texto passar da borda do quadro. Errar pro
// lado da quebra e barato; errar pro outro estraga o corte.
const LARGURA_MEDIA_DA_LETRA = {
  Anton: 0.5,
  'Bebas Neue': 0.45,
  Poppins: 0.62,
  'Liberation Sans': 0.58,
  'DejaVu Sans': 0.6,
};
const LARGURA_MEDIA_PADRAO = 0.6;

// Distancia entre as bases de duas linhas, em relacao ao corpo da fonte. E o
// entrelinha que o libass usa por padrao.
const ENTRELINHA = 1.2;

// Margem lateral do titulo, igual dos dois lados (e o que a linha de estilo
// declara em MarginL/MarginR).
const MARGEM_LATERAL = 80;

// Teto de linhas. Um titulo gigante quebrado em 6 linhas cobriria o video
// inteiro; cortar com reticencias e feio, mas e melhor que tapar o corte.
const MAX_LINHAS_DO_TITULO = 3;

// Quebra o titulo em linhas ANTES de entregar ao libass, em vez de deixar ele
// quebrar sozinho.
//
// O motivo nao e estetico: e que o numero de linhas precisa ser CONHECIDO aqui
// pra centralizar o texto e dimensionar o fundo (papel rasgado) em volta dele.
// Deixando o libass quebrar, o texto ia parar num lugar que este codigo nao
// sabe calcular - foi exatamente o defeito relatado em 01/09/2026, com a
// segunda linha do titulo caindo pra fora do papel.
//
// A quebra e por PALAVRA (nunca no meio de uma) e o libass continua com a
// quebra automatica ligada como rede de seguranca: se a estimativa errar pra
// menos, ele ainda evita o texto sair do quadro.
function quebrarTitulo(texto, fonte, tamanho, larguraUtil = SAIDA.w - 2 * MARGEM_LATERAL) {
  const palavras = String(texto || '').trim().split(/\s+/).filter(Boolean);
  if (!palavras.length) return [];

  const larguraDaLetra = (LARGURA_MEDIA_DA_LETRA[fonte] ?? LARGURA_MEDIA_PADRAO) * tamanho;
  const maxLetras = Math.max(1, Math.floor(larguraUtil / larguraDaLetra));

  const linhas = [];
  let atual = '';
  for (const palavra of palavras) {
    const candidata = atual ? `${atual} ${palavra}` : palavra;
    if (candidata.length <= maxLetras || !atual) {
      atual = candidata;
    } else {
      linhas.push(atual);
      atual = palavra;
    }
  }
  if (atual) linhas.push(atual);

  // Passou do teto: junta o resto na ultima linha permitida. O libass ainda
  // quebra o excedente sozinho - o titulo fica maior que o previsto, mas nada
  // sai do quadro.
  if (linhas.length > MAX_LINHAS_DO_TITULO) {
    const cabeca = linhas.slice(0, MAX_LINHAS_DO_TITULO - 1);
    cabeca.push(linhas.slice(MAX_LINHAS_DO_TITULO - 1).join(' '));
    return cabeca;
  }
  return linhas;
}

// Onde fica o CENTRO do bloco de titulo, em pixels a partir do topo.
//
// A altura escolhida pelo cliente (title_height_percent) sempre marcou o TOPO
// da primeira linha. Com uma linha so isso da no mesmo; com duas, o texto
// crescia so pra BAIXO e escapava do fundo, que fica parado. Ancorar pelo
// CENTRO da primeira linha faz o titulo de uma linha sair exatamente onde
// sempre saiu (ninguem ve mudanca) e o de duas ou tres crescer pros dois
// lados, centrado no mesmo ponto que o fundo.
function centroDoTitulo(margemV, tamanhoDaFonte) {
  return Math.round(margemV + (tamanhoDaFonte * ENTRELINHA) / 2);
}

// Altura total do bloco de titulo, pra quem precisa desenhar um fundo em volta.
function alturaDoTitulo(linhas, tamanhoDaFonte) {
  return Math.round(Math.max(1, linhas) * tamanhoDaFonte * ENTRELINHA);
}

// Mapeia a posicao escolhida (numeracao "Parte N") pro campo Alignment do
// ASS - que ja usa a mesma convencao de teclado numerico (7/8/9 = topo
// esquerda/centro/direita, 1/2/3 = baixo esquerda/centro/direita).
const PART_LABEL_ALIGNMENT = {
  top_left: 7,
  top_center: 8,
  top_right: 9,
  bottom_left: 1,
  bottom_center: 2,
  bottom_right: 3,
};

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(FFMPEG_PATH, ['-y', '-hide_banner', '-loglevel', 'error', ...args]);
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(`ffmpeg saiu com codigo ${code}: ${stderr.slice(-800)}`));
      }
      resolve();
    });
  });
}

// Igual runFfmpeg, mas acompanha o progresso (via -progress) e chama
// onProgress(percent) periodicamente enquanto roda - usado pra mostrar a
// barra de "% concluido" de cada corte na tela. Se checkCancelled for
// passado, confere a cada tick (mesmo timer do progresso) e mata o ffmpeg na
// hora se o cliente pediu pausa - sem isso, pausar so tinha efeito depois
// que o corte inteiro terminasse de renderizar (podia levar minutos).
// Teto de tempo pra uma renderizacao, e o piso de velocidade abaixo do qual
// ela e considerada travada.
//
// Existem porque a rede de seguranca que ja havia NAO pega este caso. O
// videoStuckRecoveryJob acorda video "silencioso", e silencio e medido pelo
// processing_heartbeat_at - que continua batendo normalmente enquanto o job
// esta vivo esperando um ffmpeg eterno. Foi exatamente assim que um corte
// ficou horas rodando sem ninguem perceber, ate o fundador reclamar da
// demora: nada no sistema achava que havia problema.
//
// A velocidade e o sinal mais rapido. Um corte normal renderiza perto de
// 0,5x nesta VPS (3s de video em 5,8s); o corte quebrado rodava a 0,0034x.
// 0,05x e 10x pior que o normal e 15x melhor que o defeito - larga o
// suficiente pra nao acusar corte legitimo em VPS ocupada.
//
// So vale depois de um tempo de aquecimento: os primeiros segundos incluem
// abrir arquivo e encher buffer, e a velocidade comeca baixa em todo corte.
const VELOCIDADE_MINIMA = 0.05;
const AQUECIMENTO_MS = 90_000;

// Teto absoluto, para o que a velocidade nao pegar. Generoso de proposito: a
// funcao dele e transformar "eterno" em "erro visivel", nao apertar corte
// legitimo. 30x a duracao do corte, com piso de 15min e teto de 2h.
function tetoDeTempoMs(duracaoSegundos) {
  const porDuracao = (Number(duracaoSegundos) || 0) * 30 * 1000;
  return Math.min(Math.max(porDuracao, 15 * 60 * 1000), 2 * 60 * 60 * 1000);
}

function runFfmpegWithProgress(args, totalDurationSeconds, onProgress, checkCancelled) {
  return new Promise((resolve, reject) => {
    const progressFile = path.join(os.tmpdir(), `ffmpeg-progress-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);
    fs.writeFileSync(progressFile, '');

    const child = spawn(FFMPEG_PATH, ['-y', '-hide_banner', '-loglevel', 'error', ...args, '-progress', progressFile, '-nostats'], {
      detached: true,
    });
    function killGroup() {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        // grupo ja morreu - ignora
      }
    }
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk; });

    let closed = false;
    let cancelling = false;
    // Sem isto o SIGKILL do teto viraria PausedError, e o corte ficaria
    // "pausado pelo cliente" - some da fila sem nunca virar erro visivel.
    let motivoDaMorte = null;
    const comecouEm = Date.now();
    const tetoMs = tetoDeTempoMs(totalDurationSeconds);

    const poll = setInterval(async () => {
      if (closed) return;

      const rodandoHaMs = Date.now() - comecouEm;
      if (rodandoHaMs > tetoMs) {
        motivoDaMorte = new Error(
          `Renderizacao passou de ${Math.round(tetoMs / 60000)} minutos sem terminar - interrompida.`
        );
        killGroup();
        return;
      }
      if (checkCancelled && !cancelling) {
        cancelling = true;
        try {
          if (await checkCancelled()) {
            killGroup();
            return;
          }
        } finally {
          cancelling = false;
        }
      }
      if (!totalDurationSeconds) return;
      try {
        const content = fs.readFileSync(progressFile, 'utf8');
        const match = [...content.matchAll(/out_time_ms=(\d+)/g)].at(-1);
        if (match) {
          const outSeconds = Number(match[1]) / 1_000_000;
          const percent = Math.min(99, Math.max(0, Math.round((outSeconds / totalDurationSeconds) * 100)));
          onProgress(percent);
        }

        // O proprio ffmpeg publica a velocidade. Ler dela e mais confiavel do
        // que cronometrar por fora, porque ja desconta pausa de I/O.
        const vel = [...content.matchAll(/speed=\s*([\d.]+)x/g)].at(-1);
        if (vel && rodandoHaMs > AQUECIMENTO_MS && Number(vel[1]) < VELOCIDADE_MINIMA) {
          motivoDaMorte = new Error(
            `Renderizacao lenta demais (${vel[1]}x, minimo ${VELOCIDADE_MINIMA}x) - interrompida. ` +
              'Costuma ser taxa de quadros incompativel entre o video e uma imagem da composicao.'
          );
          killGroup();
        }
      } catch {
        // arquivo pode nao existir ainda no primeiro instante - ignora
      }
    }, 1500);

    // 'error' e 'close' podem os dois disparar pro mesmo processo que falhou
    // ao dar spawn (ex: binario do ffmpeg sumiu/ficou corrompido) - sem a
    // guarda de "closed" aqui, o segundo handler tentava apagar um arquivo
    // que o primeiro ja tinha apagado (unlinkSync lancava ENOENT sem try/
    // catch) e derrubava o processo inteiro do video-worker, nao so esse
    // corte. fs.rm com force:true tambem nao lanca se o arquivo ja sumiu.
    child.on('error', (err) => {
      if (closed) return;
      closed = true;
      clearInterval(poll);
      fs.rm(progressFile, { force: true }, () => {});
      reject(err);
    });
    child.on('close', (code, signal) => {
      if (closed) return;
      closed = true;
      clearInterval(poll);
      fs.rm(progressFile, { force: true }, () => {});
      if (motivoDaMorte) return reject(motivoDaMorte);
      if (signal === 'SIGKILL') {
        return reject(new PausedError('Renderizacao interrompida pelo cliente.'));
      }
      if (code !== 0) {
        return reject(new Error(`ffmpeg saiu com codigo ${code}: ${stderr.slice(-800)}`));
      }
      resolve();
    });
  });
}

// Extrai so o audio, comprimido e mono - fica bem abaixo do limite de 25MB
// da API de transcricao mesmo em videos longos (~40-50min nesse bitrate).
async function extractAudio(videoPath, audioPath) {
  await runFfmpeg(['-i', videoPath, '-vn', '-ac', '1', '-ar', '16000', '-b:a', '64k', audioPath]);
  return audioPath;
}

// Duracao (em segundos) de um arquivo de video - usado pro upload direto
// (sem metadado do YouTube pra saber a duracao) e pro calculo de progresso.
function probeDuration(videoPath) {
  return new Promise((resolve, reject) => {
    const child = spawn(FFPROBE_PATH, [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      videoPath,
    ]);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => { stdout += c; });
    child.stderr.on('data', (c) => { stderr += c; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`ffprobe saiu com codigo ${code}: ${stderr.slice(-500)}`));
      const seconds = Number(stdout.trim());
      if (!Number.isFinite(seconds)) return reject(new Error('Nao foi possivel ler a duracao do video.'));
      resolve(seconds);
    });
  });
}

// Captura um frame do proprio corte pronto - usado como capa no preview (sem
// isso o player fica com tela em branco ate a pessoa dar play).
async function extractThumbnail(videoPath, outputPath, atSeconds = 0.5) {
  await runFfmpeg(['-ss', String(atSeconds), '-i', videoPath, '-frames:v', '1', '-q:v', '3', outputPath]);
  return outputPath;
}

function formatAssTimestamp(seconds) {
  const clamped = Math.max(0, seconds);
  const h = Math.floor(clamped / 3600);
  const m = Math.floor((clamped % 3600) / 60);
  const s = Math.floor(clamped % 60);
  const cs = Math.round((clamped - Math.floor(clamped)) * 100);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

// Gera um .ass com uma linha por palavra, ja com o tempo relativo ao inicio
// do corte (0 = comeco do clipe) - e isso que da o efeito "uma palavra de
// cada vez" na tela. Se tituloAteSegundos > 0, insere tambem uma linha fixa
// com o titulo do corte, visivel do inicio ate esse instante. partLabel
// (ex: "Parte 2"), quando informado, fica visivel o corte inteiro na
// posicao escolhida (ver PART_LABEL_ALIGNMENT).
function buildAssSubtitles(
  words,
  captionStyle,
  titleStyle,
  title,
  titleSeconds,
  partLabel,
  partLabelPosition,
  clipDuration,
  // Escolhas do cliente que atravessam qualquer estilo: fonte e altura.
  {
    captionFont,
    titleFont,
    captionHeightPercent,
    titleHeightPercent,
    captionBoxColor,
    titleBoxColor,
    partLabelSizePercent,
  } = {}
) {
  const partAlignment = PART_LABEL_ALIGNMENT[partLabelPosition] || PART_LABEL_ALIGNMENT.top_right;
  const tamanhoNumeracao = tamanhoDaNumeracao(partLabelSizePercent);
  const respiroNumeracao = Math.max(4, Math.round(tamanhoNumeracao * RESPIRO_DA_CAIXA_DA_NUMERACAO));

  const presetLegenda = CAPTION_STYLES[captionStyle] || CAPTION_STYLES.classic;
  const presetTitulo = TITLE_STYLES[titleStyle] || TITLE_STYLES.classic;

  // Alignment 2 = baixo-centro (legenda), 8 = topo-centro (titulo). Com esses
  // alinhamentos, MarginV e a distancia ate a borda de baixo e de cima
  // respectivamente - que e exatamente o que a barra de altura controla.
  const estiloLegenda = linhaDeEstilo({
    nome: 'Default',
    preset: presetLegenda,
    fonte: fonteValida(captionFont),
    alinhamento: 2,
    margemV: margemVertical(captionHeightPercent, 14),
    corEscolhida: captionBoxColor,
  });
  // O titulo e posicionado por \pos na propria fala (ver abaixo), entao o
  // alinhamento e a margem da linha de estilo servem so de padrao. Ficam
  // coerentes com o que o \pos faz pra nao haver duas verdades no arquivo.
  const fonteDoTitulo = fonteValida(titleFont);
  const margemDoTitulo = margemVertical(titleHeightPercent, 8);
  const estiloTitulo = linhaDeEstilo({
    nome: 'Title',
    preset: presetTitulo,
    fonte: fonteDoTitulo,
    alinhamento: 8,
    margemV: margemDoTitulo,
    corEscolhida: titleBoxColor,
  });
  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
${estiloLegenda}
${estiloTitulo}
Style: Part,${fonteValida(captionFont)},${tamanhoNumeracao},&H00FFFFFF,&H000000FF,&H00000000,&H50000000,1,0,0,0,100,100,0,0,3,${respiroNumeracao},0,${partAlignment},50,50,50,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  const lines = words.map((w) => {
    const start = formatAssTimestamp(w.start);
    const end = formatAssTimestamp(w.end);
    const text = w.word.trim().replace(/[{}]/g, '');
    return `Dialogue: 0,${start},${end},Default,,0,0,0,,${text}`;
  });

  if (title && titleSeconds > 0) {
    const titleText = title.trim().replace(/[{}]/g, '');
    // \an5 + \pos: o bloco inteiro fica centrado NO PONTO, e nao pendurado
    // pelo topo. E o que mantem um titulo de duas linhas dentro do fundo
    // escolhido pra ele - antes a segunda linha crescia pra baixo e escapava.
    const linhasDoTitulo = quebrarTitulo(titleText, fonteDoTitulo, presetTitulo.tamanho);
    const centro = centroDoTitulo(margemDoTitulo, presetTitulo.tamanho);
    const texto = linhasDoTitulo.join('\\N');
    lines.unshift(
      `Dialogue: 1,0:00:00.00,${formatAssTimestamp(titleSeconds)},Title,,0,0,0,,` +
        `{\\an5\\pos(${Math.round(SAIDA.w / 2)},${centro})}${texto}`
    );
  }

  if (partLabel) {
    lines.unshift(`Dialogue: 1,0:00:00.00,${formatAssTimestamp(clipDuration)},Part,,0,0,0,,${partLabel}`);
  }

  return header + lines.join('\n') + '\n';
}

// O filtro "subtitles" do ffmpeg trata ":" e "\" no caminho do arquivo como
// parte da sintaxe do filtro - precisa escapar.
function escapeForFilter(filePath) {
  return path.resolve(filePath).replace(/\\/g, '\\\\').replace(/:/g, '\\:');
}

// Sem cropZoomPercent (modo automatico), o corte e o recorte central que
// preenche o quadro - o comportamento padrao de sempre.
// cropZoomPercent (0-100), quando informado, ativa o enquadramento continuo
// do modo manual: 100 = recorte apertado (igual ao automatico), 0 = video
// original inteiro visivel, valores no meio interpolam a largura do recorte
// entre os dois extremos - sempre com o fundo desfocado preenchendo a sobra
// (que e zero quando zoom=100).
// Composicao do corte sobre um FUNDO. O fundo pode ser a imagem que o cliente
// enviou, uma cor lisa, ou o proprio video desfocado - o resto do arranjo e
// identico nos quatro casos, e por isso eles compartilham esta funcao.
//
// O video entra POR CIMA do fundo, com a altura e a posicao vertical que o
// cliente escolheu. Antes so o template tinha esses controles; com fundo liso
// eles fazem o mesmo sentido (video no meio, cor sobrando em cima e embaixo).
// Thumbnail do video como FAIXA colada ao video: imagem em cima e video
// embaixo (ou o contrario). Diferente do fundo 'template', em que a imagem
// preenche o quadro inteiro e o video flutua sobre ela.
//
// As duas peças sao empilhadas com vstack, nao sobrepostas com overlay. E
// essa escolha que garante o "sem espaco branco" pedido: vstack exige largura
// igual e a altura final e a soma exata das duas, entao nao existe pixel de
// fundo nenhum pra vazar entre elas nem sobrar nas bordas. Com overlay sobre
// um fundo, qualquer erro de arredondamento de 1px viraria uma linha visivel.
//
// Cada peça é escalada para COBRIR sua faixa e o excedente e cortado
// (increase + crop). Com 'decrease' a imagem caberia dentro da faixa deixando
// vazio nas laterais - foi exatamente a faixa branca que ja apareceu num
// corte real com o fundo 'template'.
// Taxa de quadros usada quando o corte mistura video com imagem parada.
//
// NAO E COSMETICO, e a diferenca entre renderizar e travar. O vstack (e o
// overlay) casa os dois lados pelo TIMESTAMP: quando as taxas nao batem, os
// instantes nunca coincidem e o filtro gera um quadro pra cada instante da
// uniao dos dois. Com video a 23,976 fps (24000/1001, o padrao de quem grava
// em cinema/NTSC) contra imagem a 30, isso explode.
//
// Medido em producao em 22/08/2026, num corte real de 106 segundos: 31.247
// quadros gerados pra 1,3 SEGUNDO de saida, dup_frames=31.176, speed=0,0034x
// - o corte levaria 8h30 e ninguem veria erro nenhum, so um ffmpeg eterno.
// Alinhando as duas pontas em 30, o mesmo trecho de 3s renderizou em 5,8s com
// os 90 quadros certos.
//
// Por que 30 e nao a taxa do proprio video: a imagem em loop precisa de uma
// taxa fixa declarada de qualquer jeito (-framerate), entao alguem tem que
// ceder. 30 e o padrao de entrega do TikTok e ja era a taxa da imagem.
const FPS_COM_IMAGEM = 30;

function buildThumbnailBandFilter({ w, h, subtitlesFilter, heightPercent, position }) {
  // Altura PAR nas duas faixas: h264 com yuv420p amostra croma de 2 em 2
  // pixels, e uma faixa de altura impar faz o filtro reclamar em vez de
  // renderizar. Como h ja e par, forcar a do video par deixa a da imagem par
  // automaticamente - e a soma continua exata.
  let alturaVideo = Math.round((h * Math.max(10, Math.min(90, heightPercent))) / 100);
  if (alturaVideo % 2 !== 0) alturaVideo -= 1;
  const alturaImagem = h - alturaVideo;

  // fps nas DUAS pontas antes do vstack: e o que faz os timestamps baterem.
  // Ver FPS_COM_IMAGEM.
  const chain = [
    `[1:v]scale=${w}:${alturaImagem}:force_original_aspect_ratio=increase,crop=${w}:${alturaImagem},setsar=1,fps=${FPS_COM_IMAGEM}[faixaimg]`,
    `[0:v]scale=${w}:${alturaVideo}:force_original_aspect_ratio=increase,crop=${w}:${alturaVideo},setsar=1,fps=${FPS_COM_IMAGEM}[faixavid]`,
  ];

  const ordem = position === 'bottom' ? '[faixavid][faixaimg]' : '[faixaimg][faixavid]';
  // A legenda entra depois do empilhamento, pra ser posicionada em relacao ao
  // quadro final (1080x1920) e nao ao retangulo do video.
  const legenda = subtitlesFilter ? `,${subtitlesFilter}` : '';
  chain.push(`${ordem}vstack=inputs=2${legenda}[outv]`);

  return { filterComplex: chain.join(';'), outputLabel: '[outv]' };
}

function buildBackgroundFilter({ w, h, subtitlesFilter, style, heightPercent, offsetPercent }) {
  const alturaVideo = Math.round((h * Math.max(10, Math.min(100, heightPercent))) / 100);
  // O offset e medido sobre o espaco que sobra, entao 50% sempre centraliza,
  // independente da altura escolhida.
  const sobra = h - alturaVideo;
  const topo = Math.round((sobra * Math.max(0, Math.min(100, offsetPercent))) / 100);

  // Quando o video ocupa o quadro inteiro nao ha fundo visivel - gerar e
  // compor um fundo que ninguem vai ver so gasta processamento.
  const fundoVisivel = alturaVideo < h;

  const chain = [];
  let entradaDoVideo = '[0:v]';

  if (fundoVisivel) {
    if (style === 'template') {
      // A imagem vem como segunda entrada do ffmpeg ([1:v]).
      chain.push(`[1:v]scale=${w}:${h},setsar=1[fundo]`);
    } else if (style === 'blur') {
      // O proprio video desfocado. Precisa de split porque [0:v] e usado duas
      // vezes - uma pro fundo, outra pro video em cima.
      chain.push(`[0:v]split=2[paraFundo][paraVideo]`);
      chain.push(
        `[paraFundo]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},boxblur=18:4,setsar=1[fundo]`
      );
      entradaDoVideo = '[paraVideo]';
    } else {
      // Cor lisa. Gerada por filtro de origem (`color`), sem entrada extra no
      // ffmpeg - uma imagem de cor solida seria um arquivo a mais pra criar,
      // guardar e limpar, por um retangulo de uma cor so.
      const cor = style === 'white' ? 'white' : 'black';
      // r= explicito: sem ele o filtro `color` gera a 25 fps, que tambem nao
      // bate com um video 23,976 e cai na mesma armadilha do vstack.
      chain.push(`color=c=${cor}:s=${w}x${h}:r=${FPS_COM_IMAGEM}[fundo]`);
    }
  }

  // PREENCHE a caixa que o cliente dimensionou, nao "cabe dentro" dela.
  //
  // Antes isto usava force_original_aspect_ratio=decrease. Com altura de 66%,
  // um video 16:9 virava 1080x762 dentro de uma caixa de 1080x1267: sobravam
  // 505px de vazio entre o video e a arte - a faixa branca que apareceu no
  // primeiro corte real. Amplia ate cobrir (increase) e corta o excedente
  // (crop), garantindo o retangulo exato.
  chain.push(
    `${entradaDoVideo}scale=${w}:${alturaVideo}:force_original_aspect_ratio=increase,crop=${w}:${alturaVideo},setsar=1` +
      // O overlay logo abaixo casa imagem e video por timestamp, igual ao
      // vstack - mesma armadilha, mesma protecao (ver FPS_COM_IMAGEM).
      `${fundoVisivel && style !== 'blur' ? `,fps=${FPS_COM_IMAGEM}` : ''}[video]`
  );

  // A legenda entra DEPOIS da composicao, pra poder ser posicionada em relacao
  // ao quadro final e nao ao retangulo do video.
  const legenda = subtitlesFilter ? `,${subtitlesFilter}` : '';
  if (fundoVisivel) {
    chain.push(`[fundo][video]overlay=(W-w)/2:${topo}${legenda}[outv]`);
  } else {
    chain.push(`[video]null${legenda}[outv]`);
  }

  return { filterComplex: chain.join(';'), outputLabel: '[outv]' };
}

// Poe o papel rasgado atras do titulo.
//
// Precisa acontecer DEPOIS do enquadramento (pra ficar no quadro final) e
// ANTES da legenda (pro texto ficar por cima do papel). Como overlay exige
// duas entradas, qualquer caminho que use `-vf` simples vira filter_complex
// aqui - por isso a funcao recebe o resultado do buildFilter e o converte.
function aplicarPapelRasgado({
  resultado,
  papelIndice,
  w,
  h,
  alturaPercent,
  corHex,
  segundos,
  subtitlesFilter,
  // Quantas linhas o titulo tem e de que tamanho e a letra. O papel precisa
  // saber: um titulo de duas linhas dentro de um papel de uma so foi
  // exatamente o defeito relatado em 01/09/2026.
  linhasDoTitulo = 1,
  tamanhoDaFonte = 76,
}) {
  const partes = [];

  // Normaliza: os dois formatos que o buildFilter devolve viram uma cadeia
  // com rotulo de saida.
  let rotuloBase;
  if (resultado.filterComplex) {
    partes.push(resultado.filterComplex);
    rotuloBase = resultado.outputLabel;
  } else {
    partes.push(`[0:v]${resultado.simpleFilter}[base]`);
    rotuloBase = '[base]';
  }

  const { r, g, b } = hexParaFatores(corHex);
  const larguraPapel = Math.round(w * LARGURA_DO_PAPEL);

  // Altura natural do papel: a imagem esticada proporcionalmente pra largura
  // acima. So e usada quando o titulo cabe nela.
  const alturaNatural = Math.round((larguraPapel * ALTURA_DO_PAPEL_ORIGINAL) / LARGURA_DO_PAPEL_ORIGINAL);

  // Quando o titulo quebra em mais linhas do que o papel comporta, o papel
  // CRESCE em vez de deixar sobrar texto pra fora dele. O respiro garante que
  // as letras nunca encostem na borda rasgada.
  const alturaDoTexto = alturaDoTitulo(linhasDoTitulo, tamanhoDaFonte);
  const alturaPapel = Math.max(alturaNatural, alturaDoTexto + 2 * RESPIRO_DO_PAPEL);

  // A imagem e BRANCA: multiplicar cada canal pelo fator da cor da exatamente
  // a cor pedida, e a transparencia das bordas passa intacta (por isso os
  // fatores de alfa ficam em 1).
  //
  // Altura EXPLICITA (e nao -1): e ela que faz o papel acompanhar um titulo de
  // duas ou tres linhas. Esticar o rasgado verticalmente nao denuncia nada -
  // um rasgo nao tem proporcao "certa" - enquanto texto pra fora do papel
  // denuncia na hora.
  partes.push(
    `[${papelIndice}:v]scale=${larguraPapel}:${alturaPapel},` +
      `colorchannelmixer=rr=${r.toFixed(4)}:rg=0:rb=0:gr=0:gg=${g.toFixed(4)}:gb=0:br=0:bg=0:bb=${b.toFixed(4)}[papel]`
  );

  // O papel fica centrado NO MESMO PONTO que o texto (ver centroDoTitulo).
  // Antes eram duas contas diferentes que so coincidiam por acaso quando o
  // titulo tinha uma linha - o texto pendurado pelo topo, o papel centrado
  // numa aproximacao. Com as duas partindo do mesmo centro, eles ficam
  // concentricos com qualquer numero de linhas.
  const margemV = margemVertical(alturaPercent, 8);
  const centro = centroDoTitulo(margemV, tamanhoDaFonte);
  partes.push(
    `${rotuloBase}[papel]overlay=(W-w)/2:${centro}-h/2:` +
      // So enquanto o titulo esta na tela - o papel some junto com ele.
      `enable='between(t,0,${Number(segundos).toFixed(2)})'` +
      `${subtitlesFilter ? `,${subtitlesFilter}` : ''}[comPapel]`
  );

  return { filterComplex: partes.join(';'), outputLabel: '[comPapel]' };
}

// De que instante do trecho sai o quadro usado como faixa.
//
// Sorteado, a pedido do fundador: assim dois cortes do mesmo video nunca
// ficam com a mesma imagem, e re-renderizar um corte que saiu ruim da outra
// foto. Custa o mesmo que qualquer outro instante - o ffmpeg salta direto pro
// ponto pedido, nao percorre o video (300ms medidos na VPS).
//
// O sorteio e limitado ao MIOLO do trecho (25% a 75%). As pontas sao onde
// mora quase todo quadro ruim: corte de cena, fade, alguem entrando ou saindo
// do enquadramento. Sortear no trecho inteiro traria isso de volta - foi por
// isso que a versao anterior fixava o meio.
const MIOLO_INICIO = 0.25;
const MIOLO_FIM = 0.75;

function instanteDoQuadro(startSeconds, endSeconds, sortear = Math.random) {
  const duracao = Math.max(0, Number(endSeconds) - Number(startSeconds));
  const inicio = Number(startSeconds) + duracao * MIOLO_INICIO;
  const fim = Number(startSeconds) + duracao * MIOLO_FIM;
  return inicio + sortear() * (fim - inicio);
}

function buildFilter({ w, h, subtitlesFilter, cropZoomPercent, fundo }) {
  // Fundo escolhido explicitamente (template, preto, branco ou desfocado). O
  // 'blur' so entra por aqui quando ha altura definida - com o video ocupando
  // o quadro inteiro, o caminho antigo (com zoom continuo) continua valendo.
  if (fundo) {
    // A thumbnail nao e "fundo": e uma faixa colada ao video, com layout
    // proprio (ver buildThumbnailBandFilter).
    if (fundo.style === 'thumbnail' || fundo.style === 'frame') {
      return buildThumbnailBandFilter({
        w,
        h,
        subtitlesFilter,
        heightPercent: fundo.heightPercent,
        position: fundo.thumbnailPosition,
      });
    }
    return buildBackgroundFilter({
      w,
      h,
      subtitlesFilter,
      style: fundo.style,
      heightPercent: fundo.heightPercent,
      offsetPercent: fundo.offsetPercent,
    });
  }

  if (cropZoomPercent !== null && cropZoomPercent !== undefined) {
    const zoom = Math.max(0, Math.min(100, cropZoomPercent)) / 100;
    const cropWidthExpr = `iw-(iw-ih*${w}/${h})*${zoom}`;
    const chain = [
      `[0:v]split=2[bg][fg]`,
      `[bg]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},boxblur=18:4[bgblur]`,
      `[fg]crop=${cropWidthExpr}:ih,scale=${w}:${h}:force_original_aspect_ratio=decrease[fgscaled]`,
      `[bgblur][fgscaled]overlay=(W-w)/2:(H-h)/2,setsar=1${subtitlesFilter ? `,${subtitlesFilter}` : ''}[outv]`,
    ];
    return { filterComplex: chain.join(';'), outputLabel: '[outv]' };
  }

  const simple = `crop=ih*${w}/${h}:ih,scale=${w}:${h},setsar=1${subtitlesFilter ? `,${subtitlesFilter}` : ''}`;
  return { simpleFilter: simple };
}

// Corta [startSeconds, endSeconds] do video original, reenquadra, queima a
// legenda e (opcional) o titulo conforme as preferencias do cliente
// (settings) - as "words" ja devem vir filtradas pro intervalo do corte, com
// tempos ainda no eixo do video original. onProgress(percent) e chamado
// periodicamente durante a renderizacao.
async function renderClip({
  videoPath,
  startSeconds,
  endSeconds,
  words,
  title,
  outputPath,
  settings = {},
  onProgress,
  checkCancelled,
  partIndex,
  partTotal,
  // Capa do video ja baixada em disco (ver processVideoJob). So usada quando
  // o estilo escolhido e 'thumbnail'.
  thumbnailImagePath = null,
}) {
  const captionStyle = settings.caption_style || 'classic';
  const titleStyle = settings.title_style || 'classic';
  const showTitle = settings.show_title !== false;
  const titleSeconds = showTitle ? Number(settings.title_seconds || 3) : 0;
  // So no modo manual o zoom continuo entra em jogo - no automatico o corte
  // continua sendo o recorte central de sempre.
  const cropZoomPercent = settings.crop_style_mode === 'manual' ? Number(settings.crop_zoom_percent ?? 100) : null;
  const partLabel = settings.show_part_label && partTotal > 1 ? `Parte ${partIndex}` : null;
  // Template de fundo: so vale se o arquivo ainda existir em disco. Se o
  // cliente apagou (ou a retencao limpou), renderiza sem template em vez de
  // derrubar o corte inteiro por causa de uma imagem faltando.
  const templatePath = settings.background_template_path;
  const alturaDoVideo = Number(settings.background_video_height_percent ?? 100);
  // Sem estilo definido mas com imagem enviada, o fundo e a imagem: e o que
  // configuracao antiga (anterior a esta escolha existir) quis dizer.
  let estiloDeFundo = settings.background_style || (templatePath ? 'template' : 'blur');

  // Template escolhido mas o arquivo sumiu (cliente apagou, retencao limpou):
  // cai no desfocado em vez de derrubar o corte inteiro por uma imagem
  // faltando.
  if (estiloDeFundo === 'template' && (!templatePath || !fs.existsSync(templatePath))) {
    logger.warn(`Template de fundo nao encontrado em ${templatePath} - renderizando com fundo desfocado.`);
    estiloDeFundo = 'blur';
  }

  // A capa daquele video, baixada pelo processVideoJob antes de renderizar.
  // Video enviado do computador costuma nao ter capa nenhuma, e o download
  // tambem pode falhar - nos dois casos cai no desfocado, que e o padrao de
  // sempre, em vez de derrubar o corte.
  // Fundo "frame do video": em vez de uma imagem vinda de fora, tira um quadro
  // do PROPRIO trecho e usa como a faixa. Cada corte fica com uma imagem
  // diferente, do momento dele - e o que separa isto da capa, que e a mesma
  // imagem nos N cortes do mesmo video.
  //
  // O instante e sorteado, pra cada corte ficar com uma imagem diferente em
  // vez de sempre a mesma pose do meio (ver instanteDoQuadro).
  let framePath = null;
  if (estiloDeFundo === 'frame') {
    framePath = outputPath.replace(/\.mp4$/, '-frame.jpg');
    const instante = instanteDoQuadro(startSeconds, endSeconds);
    try {
      // -ss ANTES do -i e o que torna isto barato: o ffmpeg salta direto pro
      // ponto pedido em vez de decodificar o video inteiro ate la. Medido na
      // VPS com um video AV1 de 2 minutos: 300ms assim, contra 7,4 SEGUNDOS
      // com o -ss depois do -i. Nunca inverta essa ordem.
      await runFfmpeg(['-ss', String(instante), '-i', videoPath, '-frames:v', '1', '-q:v', '2', framePath]);
    } catch (err) {
      logger.error(`Nao consegui tirar o quadro do video pro fundo (seguindo com desfocado):`, err.message);
      framePath = null;
    }
    if (!framePath || !fs.existsSync(framePath)) {
      estiloDeFundo = 'blur';
      framePath = null;
    }
  }

  if (estiloDeFundo === 'thumbnail' && (!thumbnailImagePath || !fs.existsSync(thumbnailImagePath))) {
    logger.warn(
      `Capa do video nao disponivel (${thumbnailImagePath || 'sem url'}) - renderizando com fundo desfocado.`
    );
    estiloDeFundo = 'blur';
  }

  // Fundo so entra em jogo no modo manual e quando ha espaco pra ele. Com o
  // video ocupando o quadro inteiro (100%) nao sobra fundo visivel, entao o
  // caminho antigo (zoom continuo sobre o desfocado) continua valendo - e e o
  // que preserva o comportamento de quem nunca mexeu nessa configuracao.
  const fundo =
    settings.crop_style_mode === 'manual' && alturaDoVideo < 100
      ? {
          style: estiloDeFundo,
          heightPercent: alturaDoVideo,
          offsetPercent: Number(settings.background_video_offset_percent ?? 50),
          // A mesma escolha de lado vale pros dois: a faixa e a mesma peca,
          // muda so de onde vem a imagem.
          thumbnailPosition: settings.thumbnail_position === 'bottom' ? 'bottom' : 'top',
        }
      : null;

  // A imagem so vira entrada do ffmpeg quando e ela o fundo escolhido. Os dois
  // estilos que usam imagem entram como a MESMA segunda entrada ([1:v]) - o
  // que muda e o filtro que a consome.
  const template =
    fundo && fundo.style === 'template'
      ? { path: templatePath }
      : fundo && fundo.style === 'thumbnail'
        ? { path: thumbnailImagePath }
        : fundo && fundo.style === 'frame'
          ? { path: framePath }
          : null;

  const { w, h } = SAIDA;
  const { crf, preset } = RENDER;

  const duration = endSeconds - startSeconds;
  const relativeWords = words
    .filter((word) => word.start >= startSeconds && word.end <= endSeconds)
    .map((word) => ({ word: word.word, start: word.start - startSeconds, end: word.end - startSeconds }));

  let assPath = null;
  let subtitlesFilter = null;
  if (captionStyle !== 'none' || titleSeconds > 0 || partLabel) {
    assPath = outputPath.replace(/\.mp4$/, '.ass');
    fs.writeFileSync(
      assPath,
      buildAssSubtitles(
        relativeWords,
        captionStyle,
        titleStyle,
        titleSeconds > 0 ? title : null,
        titleSeconds,
        partLabel,
        settings.part_label_position,
        duration,
        {
          captionFont: settings.caption_font,
          titleFont: settings.title_font,
          captionHeightPercent: settings.caption_height_percent,
          titleHeightPercent: settings.title_height_percent,
          captionBoxColor: settings.caption_box_color,
          titleBoxColor: settings.title_box_color,
          partLabelSizePercent: settings.part_label_size_percent,
        }
      )
    );
    subtitlesFilter = `subtitles=${escapeForFilter(assPath)}`;
  }

  // Papel rasgado atras do titulo. So entra quando o estilo pede E o titulo
  // vai aparecer - papel sem titulo seria uma faixa de cor no meio do video.
  const usaPapel = titleStyle === 'papel_rasgado' && titleSeconds > 0 && fs.existsSync(CAMINHO_PAPEL_RASGADO);

  let resultadoFiltro = buildFilter({
    w,
    h,
    // Com papel, a legenda e aplicada depois da sobreposicao (pro texto ficar
    // POR CIMA do papel), entao nao entra aqui.
    subtitlesFilter: usaPapel ? null : subtitlesFilter,
    cropZoomPercent,
    fundo,
  });

  if (usaPapel) {
    resultadoFiltro = aplicarPapelRasgado({
      resultado: resultadoFiltro,
      // A imagem do papel e a ultima entrada: vem depois do video e, quando
      // existe faixa de imagem, depois dela tambem.
      papelIndice: template ? 2 : 1,
      w,
      h,
      alturaPercent: settings.title_height_percent,
      corHex: settings.title_box_color,
      segundos: titleSeconds,
      subtitlesFilter,
      // O papel e o texto precisam partir da MESMA contagem de linhas, senao
      // voltam a discordar - por isso a quebra e feita pela mesma funcao que o
      // .ass usa, com a mesma fonte e o mesmo corpo de letra.
      linhasDoTitulo: quebrarTitulo(
        String(title || '').trim().replace(/[{}]/g, ''),
        fonteValida(settings.title_font),
        (TITLE_STYLES[titleStyle] || TITLE_STYLES.classic).tamanho
      ).length,
      tamanhoDaFonte: (TITLE_STYLES[titleStyle] || TITLE_STYLES.classic).tamanho,
    });
  }

  const { simpleFilter, filterComplex, outputLabel } = resultadoFiltro;

  try {
    const args = [
      '-ss', String(startSeconds),
      '-i', videoPath,
      // Segunda entrada: a imagem da faixa (template, capa ou quadro do
      // video). -loop 1 faz a imagem parada "durar pra sempre"; quem corta e
      // o -t la embaixo.
      //
      // -framerate NAO E OPCIONAL. Sem ele a imagem em loop nao tem taxa de
      // quadros propria, e o vstack passa a duplicar quadro sem parar pra
      // tentar casar com o video: medido em producao, 9216 quadros pra 0,19
      // SEGUNDO de saida (dup=9209), a 0,0009x da velocidade normal. Na
      // pratica o corte nunca terminava - e sem erro nenhum, so um ffmpeg
      // rodando pra sempre. Com a taxa definida: 360 quadros pra 12s, 36
      // segundos de renderizacao.
      //
      // 30 fps cobre o caso comum. Origem em 60 fps faz o ffmpeg duplicar a
      // imagem 2x, o que e barato e continua limitado - o problema era a
      // AUSENCIA de taxa, nao o valor dela.
      ...(template ? ['-loop', '1', '-framerate', '30', '-i', template.path] : []),
      // Papel rasgado: mesma regra da faixa - imagem parada precisa de taxa de
      // quadros, senao o vstack/overlay duplica quadro sem parar (ver acima).
      ...(usaPapel ? ['-loop', '1', '-framerate', '30', '-i', CAMINHO_PAPEL_RASGADO] : []),
      ...(filterComplex
        ? ['-filter_complex', filterComplex, '-map', outputLabel, '-map', '0:a']
        : ['-vf', simpleFilter]),
      // -t PRECISA ficar aqui, depois de TODAS as entradas.
      //
      // No ffmpeg, a posicao mudanica o significado: antes de um -i ele limita
      // AQUELA ENTRADA; depois da ultima entrada ele limita a SAIDA. Enquanto
      // so existia uma entrada, o -t ficava logo apos o -i do video e
      // funcionava como opcao de saida por acidente de posicao. Quando o
      // template entrou como segunda entrada, o mesmo -t passou a limitar a
      // IMAGEM, e a saida ficou sem limite nenhum: cada "corte" era
      // renderizado com o VIDEO INTEIRO por baixo do template. Na producao
      // isso gerou cortes de 150-200 MB (maiores que o proprio video original)
      // e renderizacao que nunca terminava.
      '-t', String(duration),
      // Trava a taxa da SAIDA sempre que uma imagem parada entra na conta.
      //
      // Os filtros ja alinham as pontas (ver FPS_COM_IMAGEM), mas isto e o
      // cinto de seguranca: se um caminho novo de composicao esquecer o
      // alinhamento, o pior caso vira "quadro descartado" em vez de "corte que
      // nunca termina". So entra quando ha imagem - forcar 30 num corte comum
      // jogaria fora metade dos quadros de um video 60 fps sem motivo.
      ...(template || usaPapel ? ['-r', String(FPS_COM_IMAGEM)] : []),
      '-c:v', 'libx264',
      '-preset', preset,
      '-crf', String(crf),
      '-c:a', 'aac',
      '-b:a', '128k',
      outputPath,
    ];

    if (onProgress || checkCancelled) {
      await runFfmpegWithProgress(args, duration, onProgress || (() => {}), checkCancelled);
    } else {
      await runFfmpeg(args);
    }
  } finally {
    if (assPath) fs.unlinkSync(assPath);
    // O quadro extraido e descartavel: existe so pra esta renderizacao.
    if (framePath) fs.rmSync(framePath, { force: true });
  }

  return outputPath;
}

// buildBackgroundFilter e exportada so pra ser testada: ela e uma funcao pura
// (entra configuracao, sai a string do filtro) e e onde mora a regra que ja
// quebrou uma vez - o video precisa PREENCHER a caixa, nao caber dentro dela.
module.exports = {
  buildBackgroundFilter,
  // Exportado pro teste: e o filtro que garante o encaixe exato entre a faixa
  // da capa e o video (sem essa garantia, aparece faixa branca no corte).
  buildThumbnailBandFilter,
  instanteDoQuadro,
  tetoDeTempoMs,
  extractAudio,
  renderClip,
  extractThumbnail,
  probeDuration,
  SAIDA,
  RENDER,
  CAPTION_STYLES,
  TITLE_STYLES,
  FONTES,
  FONTE_PADRAO,
  hexParaAss,
  hexParaFatores,
  CAMINHO_PAPEL_RASGADO,
  buildAssSubtitles,
  quebrarTitulo,
  centroDoTitulo,
  tamanhoDaNumeracao,
  margemVertical,
};
