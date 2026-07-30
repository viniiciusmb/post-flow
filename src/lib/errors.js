'use strict';

// Sinaliza que uma operacao longa (download, transcricao, renderizacao) foi
// interrompida porque o cliente pediu pausa - usado pra diferenciar de um
// erro de verdade em qualquer camada (services e workers).
class PausedError extends Error {}

module.exports = { PausedError };
