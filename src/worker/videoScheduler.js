'use strict';

const channelCheckJob = require('./videoJobs/channelCheckJob');
const processVideoJob = require('./videoJobs/processVideoJob');
const videoErrorRetryJob = require('./jobs/videoErrorRetryJob');
const videoStuckRecoveryJob = require('./jobs/videoStuckRecoveryJob');
const tiktokPostingJob = require('./jobs/tiktokPostingJob');
const postingCleanupJob = require('./jobs/postingCleanupJob');
const sharedAssetsCleanupJob = require('./jobs/sharedAssetsCleanupJob');
const driveExportJob = require('./jobs/driveExportJob');
const tunnelTestJob = require('./jobs/tunnelTestJob');
const creditWeeklyResetJob = require('./jobs/creditWeeklyResetJob');
const overageBillingJob = require('./jobs/overageBillingJob');
const videoConcurrencyService = require('../services/videoConcurrencyService');
const logger = require('../lib/logger');

const QUEUE_CHANNEL_CHECK = 'youtube-channel-check';
const QUEUE_VIDEO_PROCESSING = 'video-processing';
const QUEUE_VIDEO_ERROR_RETRY = 'video-error-retry';
const QUEUE_VIDEO_STUCK_RECOVERY = 'video-stuck-recovery';
const QUEUE_TIKTOK_POSTING = 'tiktok-posting';
const QUEUE_POSTING_CLEANUP = 'posting-cleanup';
const QUEUE_SHARED_ASSETS_CLEANUP = 'shared-assets-cleanup';
const QUEUE_DRIVE_EXPORT = 'drive-export';
const QUEUE_TUNNEL_TEST_ONE = 'tunnel-test-one';
const QUEUE_TUNNEL_TEST_ALL = 'tunnel-test-all';
const QUEUE_CREDIT_WEEKLY_RESET = 'credit-weekly-reset';
const QUEUE_OVERAGE_BILLING = 'overage-billing';

async function start(boss) {
  await boss.createQueue(QUEUE_CHANNEL_CHECK);
  await boss.createQueue(QUEUE_VIDEO_PROCESSING);
  await boss.createQueue(QUEUE_VIDEO_ERROR_RETRY);
  await boss.createQueue(QUEUE_VIDEO_STUCK_RECOVERY);
  await boss.createQueue(QUEUE_TIKTOK_POSTING);
  await boss.createQueue(QUEUE_POSTING_CLEANUP);
  await boss.createQueue(QUEUE_SHARED_ASSETS_CLEANUP);
  await boss.createQueue(QUEUE_DRIVE_EXPORT);
  await boss.createQueue(QUEUE_TUNNEL_TEST_ONE);
  await boss.createQueue(QUEUE_TUNNEL_TEST_ALL);
  await boss.createQueue(QUEUE_CREDIT_WEEKLY_RESET);
  await boss.createQueue(QUEUE_OVERAGE_BILLING);

  await boss.schedule(QUEUE_CHANNEL_CHECK, '*/20 * * * *');
  logger.info('Checagem de canais do YouTube agendada a cada 20 minutos.');

  await boss.schedule(QUEUE_VIDEO_ERROR_RETRY, '*/15 * * * *');
  logger.info('Retry automatico de video com erro agendado a cada 15 minutos.');

  // Recupera video preso numa etapa em andamento cujo worker morreu (deploy,
  // crash). Seguro rodar de 5 em 5 min porque a deteccao e por sinal de vida,
  // nao por tempo puro - ver videoStuckRecoveryJob.
  await boss.schedule(QUEUE_VIDEO_STUCK_RECOVERY, '*/5 * * * *');
  logger.info('Recuperacao de video travado agendada a cada 5 minutos.');

  // Publicacao no TikTok e exportacao pro Drive precisam ler o arquivo do
  // corte em disco - por isso rodam aqui (video-worker ja tem acesso ao
  // volume compartilhado), nao no worker leve (Drive de origem/metricas).
  await boss.schedule(QUEUE_TIKTOK_POSTING, '*/10 * * * *');
  logger.info('Fila de postagem no TikTok agendada a cada 10 minutos.');

  await boss.schedule(QUEUE_POSTING_CLEANUP, '5 * * * *');
  logger.info('Limpeza de postagens antigas agendada de hora em hora.');

  // A cada 15 minutos, nao de hora em hora: o arquivo compartilhado deixou de
  // ser apagado pelo pipeline no fim do processamento (outro cliente ainda
  // pode precisar dele), entao o intervalo desta varredura e exatamente quanto
  // tempo um video de ~700 MB fica ocupando disco sem ninguem precisar dele.
  // A varredura e barata: duas consultas e um readdir.
  //
  // Roda no video-worker (e nao no worker leve) porque precisa mexer em
  // arquivo de video em disco - so este processo tem o volume montado.
  await boss.schedule(QUEUE_SHARED_ASSETS_CLEANUP, '*/15 * * * *');
  logger.info('Limpeza de videos compartilhados agendada a cada 15 minutos.');

  await boss.schedule(QUEUE_DRIVE_EXPORT, '*/15 * * * *');
  logger.info('Exportacao de cortes prontos pro Drive do cliente agendada a cada 15 minutos.');

  await boss.schedule(QUEUE_TUNNEL_TEST_ALL, '*/5 * * * *');
  logger.info('Teste de todos os tuneis SSH agendado a cada 5 minutos.');

  // So mexe nos clientes cujo ciclo ja completou 7 dias (checagem por
  // cliente dentro do proprio job) - de hora em hora e frequente o
  // suficiente sem ficar rodando toda hora a toa.
  await boss.schedule(QUEUE_CREDIT_WEEKLY_RESET, '10 * * * *');
  logger.info('Reset semanal de credito agendado de hora em hora.');

  await boss.schedule(QUEUE_OVERAGE_BILLING, '20 * * * *');
  logger.info('Faturamento de excedente agendado de hora em hora.');

  await boss.work(QUEUE_CHANNEL_CHECK, async () => {
    logger.info('Checando canais do YouTube...');
    await channelCheckJob.run(boss);
    logger.info('Checagem de canais concluida.');
  });

  await boss.work(QUEUE_VIDEO_ERROR_RETRY, async () => {
    await videoErrorRetryJob.run();
  });

  await boss.work(QUEUE_VIDEO_STUCK_RECOVERY, async () => {
    await videoStuckRecoveryJob.run({ boss });
  });

  await boss.work(QUEUE_TIKTOK_POSTING, async () => {
    await tiktokPostingJob.run();
  });

  await boss.work(QUEUE_POSTING_CLEANUP, async () => {
    await postingCleanupJob.run();
  });

  await boss.work(QUEUE_SHARED_ASSETS_CLEANUP, async () => {
    await sharedAssetsCleanupJob.run();
  });

  await boss.work(QUEUE_DRIVE_EXPORT, async () => {
    await driveExportJob.run();
  });

  await boss.work(QUEUE_CREDIT_WEEKLY_RESET, async () => {
    await creditWeeklyResetJob.run();
  });

  await boss.work(QUEUE_OVERAGE_BILLING, async () => {
    await overageBillingJob.run();
  });

  // Sem agendamento - so roda quando o usuario clica "Testar conexao" na
  // tela do Tunel (1 tunel especifico, dono passado no job.data).
  await boss.work(QUEUE_TUNNEL_TEST_ONE, async ([job]) => {
    await tunnelTestJob.runOne(job.data.tunnelId);
  });

  await boss.work(QUEUE_TUNNEL_TEST_ALL, async () => {
    await tunnelTestJob.runAll();
  });

  // Quantos videos ao mesmo tempo - ver videoConcurrencyService.
  await aplicarConcorrencia(boss);
  vigiarMudancaDeConcorrencia(boss);
}

// Um trabalhador por video simultaneo. Cada um pega UM job e so busca o
// proximo quando termina o seu, entao um video longo nao segura os outros.
//
// batchSize 1 explicito: com lote, o pg-boss entrega varios jobs pro mesmo
// handler e so busca mais quando TODOS terminam - o video rapido ficaria preso
// esperando o lento da mesma leva.
async function registrarTrabalhadores(boss, quantos) {
  for (let i = 1; i <= quantos; i += 1) {
    await boss.work(QUEUE_VIDEO_PROCESSING, { batchSize: 1 }, async ([job]) => {
      logger.info(`Processando video-fonte #${job.data.sourceVideoId}...`);
      await processVideoJob.run(job.data.sourceVideoId);
      logger.info(`Processamento do video-fonte #${job.data.sourceVideoId} concluido.`);
    });
  }
}

let concorrenciaAtual = null;

async function aplicarConcorrencia(boss) {
  const desejada = await videoConcurrencyService.obter();
  if (desejada === concorrenciaAtual) return;

  // Para de BUSCAR novos jobs. O que ja esta rodando segue ate o fim - o
  // pg-boss nao interrompe handler em andamento, e interromper no meio
  // deixaria video pela metade.
  if (concorrenciaAtual !== null) await boss.offWork(QUEUE_VIDEO_PROCESSING);

  await registrarTrabalhadores(boss, desejada);
  logger.info(
    concorrenciaAtual === null
      ? `Processamento de video: ${desejada} video(s) ao mesmo tempo.`
      : `Processamento de video: de ${concorrenciaAtual} para ${desejada} ao mesmo tempo.`
  );
  concorrenciaAtual = desejada;
}

// O painel do admin muda a configuracao no processo WEB; quem processa video e
// outro processo (video-worker), entao ele nao fica sabendo por chamada
// direta. Conferir de tempos em tempos e o jeito mais simples que funciona
// entre containers separados - e 30s e rapido o bastante pra quem esta
// testando, sem virar consulta a toa.
const INTERVALO_DE_CHECAGEM_MS = 30_000;

function vigiarMudancaDeConcorrencia(boss) {
  const timer = setInterval(() => {
    aplicarConcorrencia(boss).catch((err) =>
      logger.error('Falha ao aplicar o limite de videos simultaneos (seguindo com o atual):', err.message)
    );
  }, INTERVALO_DE_CHECAGEM_MS);
  // Nao segura o processo aberto no encerramento.
  timer.unref();
}

// Exposta para teste: o risco desta funcao e travar a fila em producao, e
// isso precisa ser verificavel sem subir pg-boss de verdade. `reiniciar` zera
// a memoria do estado atual, pra cada teste comecar do zero.
async function aplicarConcorrenciaParaTeste(boss, { reiniciar = false } = {}) {
  if (reiniciar) concorrenciaAtual = null;
  return aplicarConcorrencia(boss);
}

module.exports = { start, aplicarConcorrenciaParaTeste };
