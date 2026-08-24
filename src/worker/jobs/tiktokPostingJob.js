// Consome a fila de postagens pendentes (postings.status='pending') e publica
// no TikTok em modo rascunho/inbox - ate aqui nada fazia isso, a fila so
// crescia parada (ver migrations/006_create_postings.sql e a memoria do
// projeto). Roda a cada ~10 min (ver videoScheduler.js).
'use strict';

const fs = require('fs');
const postingsRepository = require('../../repositories/postingsRepository');
const postingScheduleSettingsRepository = require('../../repositories/postingScheduleSettingsRepository');
const tiktokAccountsRepository = require('../../repositories/tiktokAccountsRepository');
const tiktokService = require('../../services/tiktokService');
const errorReportService = require('../../services/errorReportService');
const publishOptions = require('../../lib/publishOptions');
const erroDePostagem = require('../../lib/erroDePostagem');
const logger = require('../../lib/logger');

async function run() {
  await checkStaleProcessing();

  const accounts = await tiktokAccountsRepository.listActive();
  for (const account of accounts) {
    if (!account.auto_post_enabled) continue;
    try {
      await maybePublishNext(account);
    } catch (err) {
      logger.error(`Falha ao processar fila de postagem da conta TikTok ${account.id}:`, err);
    }
  }
}

// Publica no maximo UM corte por ciclo, e so o que ja chegou a hora marcada.
//
// Antes disto o job era "reativo": ele nao olhava scheduled_for nenhum, so
// perguntava "quantos horarios do dia ja passaram?" e "quantos ja postei?" -
// se sobrasse folga, publicava o mais antigo NA HORA. Com os horarios
// 08/12/16/20/00, as 23h53 os cinco ja tinham "passado" (00:00 e o comeco do
// dia), a folga era 5, e o corte marcado pras 00:00 saiu as 23:40 - seguido
// de outro 10 minutos depois, no ciclo seguinte. O horario na tela era
// enfeite.
//
// Agora quem manda e scheduled_for, calculado uma vez quando a postagem entra
// na fila (ver computeNextScheduledFor). O teto de videos_per_day continua
// como rede de seguranca, mas na pratica ele ja esta embutido na propria
// projecao dos horarios.
async function maybePublishNext(account) {
  const settings = await postingScheduleSettingsRepository.findOrCreateByTiktokAccountId(account.id);
  if (settings.paused) return;

  const postedToday = await postingsRepository.countTodayForAccount(account.id, settings.timezone);
  if (postedToday >= settings.videos_per_day) return;

  const posting = await postingsRepository.findOldestDuePendingForAccount(account.id);
  if (!posting) return;
  await publish(account, posting);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// O que fazer quando uma publicacao falha.
//
// Antes, QUALQUER falha mandava a postagem direto pra aba de erros, de onde
// ela so voltava se alguem clicasse. Um "fetch failed" - uma piscada de rede -
// aposentava um corte pra sempre. Agora falha passageira volta pra fila com
// espera crescente, e so vira erro visivel quando nao adianta mais tentar (ou
// quando ja tentamos vezes demais).
//
// O erro vai pro painel do admin nos DOIS casos: uma tentativa que falhou e
// informacao util mesmo quando a seguinte da certo. O que muda e o destino do
// corte, nao o registro do problema.
async function tratarFalha(account, posting, err) {
  const tentativasJaFeitas = Number(posting.attempts || 0);
  const podeTentarDeNovo = erroDePostagem.deveTentarDeNovo(err, tentativasJaFeitas);

  if (podeTentarDeNovo) {
    const minutos = erroDePostagem.esperaEmMinutos(tentativasJaFeitas);
    await postingsRepository.agendarNovaTentativa(posting.id, minutos);
    logger.warn(
      `Postagem ${posting.id} falhou (${err.message}) - nova tentativa em ${minutos} min ` +
        `(${tentativasJaFeitas + 1}/${erroDePostagem.MAX_TENTATIVAS}).`
    );
  } else {
    await postingsRepository.marcarErroDefinitivo(posting.id);
    logger.error(
      `Postagem ${posting.id} desistiu depois de ${tentativasJaFeitas + 1} tentativa(s) ` +
        `(${erroDePostagem.classificar(err)}): ${err.message}`
    );
  }

  await errorReportService.report({
    operation: errorReportService.OPERACOES.TIKTOK_POSTING,
    entityType: 'posting',
    entityId: posting.id,
    clientUserId: account.client_user_id || null,
    error: err,
  });
}

async function publish(account, posting) {
  // Ver o "PONTO SEM VOLTA" mais abaixo.
  let jaEntregueAoTiktok = false;
  if (!posting.local_clip_path || !fs.existsSync(posting.local_clip_path)) {
    // Repetir nao traz o arquivo de volta - vai direto pra aba de erros.
    await tratarFalha(account, posting, new Error('Arquivo do corte nao esta mais em disco.'));
    return;
  }

  await postingsRepository.updateStatus(posting.id, { status: 'queued' });

  try {
    const accessToken = await tiktokAccountsRepository.getValidAccessToken(tiktokService, account);
    const videoSizeBytes = posting.file_size_bytes || fs.statSync(posting.local_clip_path).size;

    // Dois caminhos, com exigencias bem diferentes:
    //
    //   inbox  - o corte chega como rascunho e o criador finaliza dentro do
    //            aplicativo do TikTok. Quem coleta privacidade, comentarios e
    //            duetos e o proprio TikTok, entao nao ha nada a perguntar aqui.
    //
    //   direct - vai direto pro perfil. A TikTok exige que privacidade,
    //            interacoes e divulgacao comercial tenham sido escolhidas
    //            MANUALMENTE pelo criador antes. O criador escolhe uma vez, no
    //            padrao da conta, e pode sobrescrever num corte especifico. Se
    //            ninguem escolheu nada em lugar nenhum, nao publicamos: pular e
    //            melhor que publicar com um padrao que a pessoa nunca viu.
    const modoDireto = account.publish_mode === 'direct';
    const opcoes = publishOptions.resolveForPosting(account, posting);
    if (modoDireto && !opcoes) {
      logger.info(
        `Corte "${posting.clip_title}" (postagem ${posting.id}) esta esperando o cliente definir as opcoes de publicacao da conta ${account.id} - pulando.`
      );
      return;
    }

    // A TikTok recusa video mais longo do que a conta aceita - e recusa DEPOIS
    // do upload inteiro ter subido. Conferir antes economiza banda e tempo, e
    // e o que as diretrizes pedem ("check max_video_post_duration_sec before
    // posting"). O limite vem do creator_info, guardado na conta.
    const limiteSegundos = account.max_video_post_duration_sec;
    const duracaoCorte = posting.clip_end_seconds - posting.clip_start_seconds;
    if (modoDireto && limiteSegundos && duracaoCorte > limiteSegundos) {
      // O corte nao vai encolher sozinho: nao adianta tentar de novo.
      await postingsRepository.marcarErroDefinitivo(posting.id);
      await errorReportService.report({
        operation: errorReportService.OPERACOES.TIKTOK_POSTING,
        entityType: 'posting',
        entityId: posting.id,
        clientUserId: account.client_user_id || null,
        error: new Error(
          `Corte de ${Math.round(duracaoCorte)}s excede o maximo de ${limiteSegundos}s que a conta do TikTok aceita.`
        ),
      });
      return;
    }

    const { publishId, uploadUrl, chunkSize, totalChunkCount } = modoDireto
      ? await tiktokService.initDirectPost(accessToken, videoSizeBytes, {
          caption: posting.caption,
          privacyLevel: opcoes.privacyLevel,
          disableComment: opcoes.disableComment,
          disableDuet: opcoes.disableDuet,
          disableStitch: opcoes.disableStitch,
          brandContentToggle: opcoes.brandContentToggle,
          brandOrganicToggle: opcoes.brandOrganicToggle,
        })
      : await tiktokService.initInboxVideo(accessToken, videoSizeBytes);
    await tiktokService.uploadVideoFile(uploadUrl, posting.local_clip_path, videoSizeBytes, chunkSize, totalChunkCount);
    await postingsRepository.updateStatus(posting.id, { status: 'processing', tiktokPublishId: publishId });
    // PONTO SEM VOLTA. Os bytes ja estao com a TikTok e ela pode publicar a
    // qualquer momento. A partir daqui, qualquer falha nossa e falha de
    // ACOMPANHAMENTO, nao de envio - reenviar o arquivo publicaria o mesmo
    // corte duas vezes no perfil do cliente.
    jaEntregueAoTiktok = true;
    logger.info(`Corte "${posting.clip_title}" enviado pro TikTok (conta ${account.id}), aguardando confirmacao.`);

    // Tenta confirmar rapido (a TikTok as vezes processa em segundos); se nao
    // der tempo, checkStaleProcessing() fecha isso no proximo ciclo do job.
    for (let attempt = 0; attempt < 4; attempt++) {
      await sleep(5000);
      const result = await tiktokService.fetchPublishStatus(accessToken, publishId);
      if (result.done) {
        await postingsRepository.updateStatus(posting.id, {
          status: 'posted',
          tiktokPostId: (result.postIds || [])[0] || null,
        });
        return;
      }
      if (result.failed) {
        // A TikTok recebeu o video e recusou: reenviar o mesmo arquivo daria o
        // mesmo veredito.
        await postingsRepository.marcarErroDefinitivo(posting.id);
        await errorReportService.report({
          operation: errorReportService.OPERACOES.TIKTOK_POSTING,
          entityType: 'posting',
          entityId: posting.id,
          clientUserId: account.client_user_id || null,
          error: new Error(result.failReason || 'A TikTok recusou a publicacao.'),
        });
        return;
      }
    }
  } catch (err) {
    if (jaEntregueAoTiktok) {
      // Nao reenviar: o video ja esta la. Fica em 'processing' e o
      // checkStaleProcessing do proximo ciclo pergunta pra TikTok como ficou -
      // e ai sim marca como postado ou como erro, sem arriscar publicar duas
      // vezes o mesmo corte.
      logger.warn(
        `Postagem ${posting.id}: o video ja tinha sido entregue a TikTok quando deu "${err.message}". ` +
          'Mantendo em processamento pra confirmar o resultado, sem reenviar.'
      );
      await errorReportService.report({
        operation: errorReportService.OPERACOES.TIKTOK_POSTING,
        entityType: 'posting',
        entityId: posting.id,
        clientUserId: account.client_user_id || null,
        error: err,
      });
      return;
    }
    // Sem mensagem tecnica na tela do cliente - ela vive no painel de erros.
    await tratarFalha(account, posting, err);
  }
}

async function checkStaleProcessing() {
  const stale = await postingsRepository.listStaleProcessing();
  for (const posting of stale) {
    if (!posting.tiktok_publish_id) continue;
    try {
      const account = await tiktokAccountsRepository.findById(posting.tiktok_account_id);
      if (!account) continue;
      const accessToken = await tiktokAccountsRepository.getValidAccessToken(tiktokService, account);
      const result = await tiktokService.fetchPublishStatus(accessToken, posting.tiktok_publish_id);
      if (result.done) {
        await postingsRepository.updateStatus(posting.id, {
          status: 'posted',
          tiktokPostId: (result.postIds || [])[0] || null,
        });
      } else if (result.failed) {
        // A TikTok processou e recusou: reenviar daria o mesmo veredito.
        await postingsRepository.marcarErroDefinitivo(posting.id);
        await errorReportService.report({
          operation: errorReportService.OPERACOES.TIKTOK_POSTING,
          entityType: 'posting',
          entityId: posting.id,
          clientUserId: account.client_user_id || null,
          error: new Error(result.failReason || 'A TikTok recusou a publicacao.'),
        });
      }
    } catch (err) {
      logger.error(`Falha ao checar status da postagem ${posting.id} no TikTok:`, err);
      await errorReportService.report({
        operation: errorReportService.OPERACOES.TIKTOK_POSTING,
        entityType: 'posting',
        entityId: posting.id,
        error: err,
      });
    }
  }
}

// publish() tambem e chamado direto pelo botao "Postar agora" (ver
// clientPostingsApiController.postNow) - contorna fila/espacamento/pausa
// de proposito, e o cliente pedindo explicitamente pra sair na hora.
module.exports = { run, publish };
