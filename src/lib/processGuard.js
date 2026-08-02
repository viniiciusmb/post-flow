// Rede de seguranca de ultima instancia pros 3 processos (web, worker,
// video-worker). Sem isso, UM erro nao tratado em qualquer canto da arvore de
// dependencias derrubava o processo inteiro em silencio - no video-worker isso
// significa matar TODOS os videos em andamento, nao so o que causou o erro
// (ja aconteceu de verdade neste projeto: um fs.unlinkSync sem try/catch num
// handler de 'close' do ffmpeg).
//
// Duas politicas diferentes de proposito:
//
//   unhandledRejection -> LOGA E CONTINUA. Desde o Node 15 o padrao e derrubar
//     o processo, e a esmagadora maioria dos casos aqui e "promessa solta que
//     falhou" (gravar progresso, heartbeat, metrica) - coisas que nao valem
//     matar o processo. Continuar e estritamente melhor do que o padrao.
//
//   uncaughtException -> LOGA E SAI (codigo 1), deixando o Docker Swarm subir
//     um processo limpo. Nao da pra confiar no estado da memoria depois de uma
//     excecao sincrona escapar. Isso NAO e um retrocesso: hoje o Node ja
//     derruba o processo nesse caso, so que sem log nenhum. E como o pipeline
//     de video e retomavel e existe o job de recuperacao de video travado
//     (videoStuckRecoveryJob), reiniciar sai barato.
'use strict';

const logger = require('./logger');

// Tempo pra o console/stdout drenar antes do exit. Sem isso, o log do erro que
// causou a queda pode se perder justamente quando ele e mais necessario.
const FLUSH_MS = 500;

function install(serviceName, { onShutdown } = {}) {
  process.on('unhandledRejection', (reason) => {
    const err = reason instanceof Error ? reason : new Error(String(reason));
    logger.error(
      `[${serviceName}] PROMESSA REJEITADA SEM TRATAMENTO (processo continua vivo):`,
      err.stack || err.message
    );
  });

  process.on('uncaughtException', (err) => {
    logger.error(`[${serviceName}] EXCECAO NAO TRATADA - reiniciando o processo:`, err.stack || err.message);
    setTimeout(() => process.exit(1), FLUSH_MS).unref();
  });

  // Deploy do Swarm manda SIGTERM antes de matar. Sair de propria vontade
  // (codigo 0) evita que o servico apareca como "crashado" no painel e da uma
  // janela pra fechar conexao de banco/fila.
  const shutdown = (signal) => async () => {
    logger.info(`[${serviceName}] recebeu ${signal}, encerrando...`);
    try {
      if (onShutdown) await onShutdown();
    } catch (err) {
      logger.error(`[${serviceName}] erro ao encerrar:`, err.message);
    }
    process.exit(0);
  };
  process.once('SIGTERM', shutdown('SIGTERM'));
  process.once('SIGINT', shutdown('SIGINT'));
}

module.exports = { install };
