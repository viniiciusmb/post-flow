'use strict';

const settingsRepository = require('../repositories/settingsRepository');
const driveDiscoveryJob = require('./jobs/driveDiscoveryJob');
const logger = require('../lib/logger');

const QUEUE_DRIVE_DISCOVERY = 'drive-discovery';

// A VARREDURA DE PASTA DE ORIGEM ESTA DESLIGADA (01/09/2026).
//
// Ela vigiava uma pasta do Drive do cliente esperando video novo, e para isso
// precisava do escopo `drive.readonly`. Esse escopo saiu em 02/08/2026 (e
// RESTRITO: obriga auditoria de seguranca paga todo ano, e a producao mostrava
// zero clientes usando o recurso).
//
// Sem o escopo, a varredura nao da erro - ela lista a pasta e recebe 200 com a
// lista VAZIA, porque `drive.file` so enxerga o que o proprio Post Flow criou.
// Ou seja: ela nunca mais poderia encontrar nada, e continuou rodando a cada 5
// minutos por um mes inteiro. No log do worker isso aparecia como "Checando
// pastas do Drive..." tres vezes seguidas e nenhuma conclusao - as tres eram o
// pg-boss repetindo um job que morria numa conexao Google revogada.
//
// Nao foi apagado nada: o job e o codigo continuam aqui. Voltam a valer no dia
// em que existir o seletor do proprio Google (que da acesso a pasta escolhida
// sem escopo restrito) - ai basta reativar o agendamento abaixo.
//
// A exportacao pro Drive (mandar corte pronto) NAO passa por aqui e continua
// funcionando: ela usa `drive.file` numa pasta que nos mesmos criamos.
const VARREDURA_DE_PASTA_DE_ORIGEM_LIGADA = false;

async function start(boss) {
  await boss.createQueue(QUEUE_DRIVE_DISCOVERY);

  if (!VARREDURA_DE_PASTA_DE_ORIGEM_LIGADA) {
    // APAGA o agendamento, nao basta parar de criar.
    //
    // O pg-boss guarda o cron numa TABELA (pgboss.schedule): so deixar de
    // chamar boss.schedule() nao apaga a linha que ja esta la. O cron
    // continuaria criando um job a cada 5 minutos sem ninguem pra atender, e
    // eles se acumulariam na fila pra sempre - troca de log barulhento por
    // lixo silencioso no banco, que e pior.
    await boss.unschedule(QUEUE_DRIVE_DISCOVERY).catch((err) => {
      logger.warn(`Nao consegui remover o agendamento antigo da varredura do Drive: ${err.message}`);
    });
    logger.info('Checagem de pasta de origem do Drive desligada (sem escopo de leitura - ver scheduler.js).');
    return;
  }

  const intervalMinutes = await settingsRepository.getValue('drive_poll_interval_minutes', 5);
  const cron = `*/${intervalMinutes} * * * *`;
  await boss.schedule(QUEUE_DRIVE_DISCOVERY, cron);
  logger.info(`Checagem do Google Drive agendada a cada ${intervalMinutes} minuto(s).`);

  await boss.work(QUEUE_DRIVE_DISCOVERY, async () => {
    logger.info('Checando pastas do Drive...');
    await driveDiscoveryJob.run();
    logger.info('Checagem do Drive concluida.');
  });
}

module.exports = { start };
