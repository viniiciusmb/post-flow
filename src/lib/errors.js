'use strict';

// Sinaliza que uma operacao longa (download, transcricao, renderizacao) foi
// interrompida porque o cliente pediu pausa - usado pra diferenciar de um
// erro de verdade em qualquer camada (services e workers).
class PausedError extends Error {}

// Sinaliza que o video nao pode comecar a baixar por falta de credito (sem
// saldo e sem cartao de excedente ligado) - processVideoJob trata como
// "aguardando_creditos", nao como erro de verdade (nao incrementa retry
// automatico, fica parado ate o cliente comprar avulso ou ligar o cartao).
class AwaitingCreditsError extends Error {}

module.exports = { PausedError, AwaitingCreditsError };
