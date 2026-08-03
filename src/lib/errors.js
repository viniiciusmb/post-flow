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

// Cartao recusado na cobranca do video. Separado de AwaitingCreditsError
// porque a saida pro cliente e outra: la e comprar credito, aqui e trocar o
// cartao. Carrega o motivo pra ele aparecer no painel de erros do admin.
class ChargeFailedError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ChargeFailedError';
  }
}

// O cliente pediu pra so baixar com o computador dele ligado, e ele esta
// desligado agora. Nao e erro nem pausa: e uma escolha dele, e o video volta
// sozinho quando o computador reconectar.
class WaitingForTunnelError extends Error {
  constructor(message) {
    super(message);
    this.name = 'WaitingForTunnelError';
  }
}

module.exports = {
  WaitingForTunnelError,
  ChargeFailedError, PausedError, AwaitingCreditsError };
