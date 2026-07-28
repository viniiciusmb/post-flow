'use strict';

// Evita ter que escrever try/catch em toda rota async: encaminha qualquer
// erro para o errorHandler central em vez de derrubar o processo.
function asyncHandler(fn) {
  return function (req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = asyncHandler;
