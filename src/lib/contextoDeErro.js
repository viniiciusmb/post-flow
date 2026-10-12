// Prepara o "contexto" de um erro pra ser gravado (system_error_events).
//
// O contexto é tudo que ajuda a entender a falha depois: conta, rede, arquivo,
// tamanho, etapa, tentativa, resposta crua da API. Ele pode carregar, sem
// ninguém perceber, um token, uma senha ou uma URL assinada - e o painel de
// erros é lido e COPIADO pra conversas. Então tudo passa por aqui antes:
//   - chave com nome de segredo vira "[omitido]";
//   - URL perde a query string (é onde mora a assinatura de upload, o code do
//     OAuth, o token de sessão);
//   - texto longo é cortado, lista longa também, profundidade limitada.
'use strict';

const CHAVES_SECRETAS =
  /token|secret|segredo|senha|password|passwd|authorization|cookie|api[_-]?key|apikey|refresh|access|credential|cvv|card_?number|numero_?do_?cartao|cpf|cnpj|session(?!_?id)|^code$|signature|assinatura/i;

const MAX_TEXTO = 4000;
const MAX_ITENS = 50;
const MAX_PROFUNDIDADE = 6;

function limparUrl(texto) {
  return texto.replace(/(https?:\/\/[^\s?"'#]+)\?[^\s"'#]*/gi, '$1?[parametros omitidos]');
}

function limpar(valor, profundidade = 0) {
  if (valor === null || valor === undefined) return valor ?? null;
  if (typeof valor === 'string') return limparUrl(valor).slice(0, MAX_TEXTO);
  if (typeof valor === 'number' || typeof valor === 'boolean') return valor;
  if (typeof valor === 'bigint') return String(valor);
  if (valor instanceof Date) return Number.isNaN(valor.getTime()) ? null : valor.toISOString();
  if (valor instanceof Error) return { nome: valor.name, mensagem: limparUrl(String(valor.message)).slice(0, MAX_TEXTO) };
  if (Buffer.isBuffer(valor)) return `[${valor.length} bytes]`;
  if (profundidade >= MAX_PROFUNDIDADE) return '[...]';
  if (Array.isArray(valor)) {
    const itens = valor.slice(0, MAX_ITENS).map((v) => limpar(v, profundidade + 1));
    if (valor.length > MAX_ITENS) itens.push(`[+${valor.length - MAX_ITENS} itens]`);
    return itens;
  }
  if (typeof valor === 'object') {
    const saida = {};
    for (const [chave, v] of Object.entries(valor)) {
      if (typeof v === 'function') continue;
      saida[chave] = CHAVES_SECRETAS.test(chave) && v !== null && v !== undefined && v !== '' ? '[omitido]' : limpar(v, profundidade + 1);
    }
    return saida;
  }
  return String(valor).slice(0, MAX_TEXTO);
}

// Junta o contexto que quem chamou mandou com o que o próprio erro carrega
// (status HTTP e resposta crua de uma API, quando houver).
function montar(contexto, err) {
  const base = contexto && typeof contexto === 'object' ? { ...contexto } : {};
  if (err && typeof err === 'object') {
    const doErro = {};
    for (const campo of ['status', 'statusHttp', 'metodo', 'caminho', 'resposta', 'etapa']) {
      if (err[campo] !== undefined && err[campo] !== null && err[campo] !== '') doErro[campo] = err[campo];
    }
    // `code` de erro do Node (ECONNREFUSED...) vai com outro nome: "code" é o
    // nome do parâmetro do OAuth e está na lista de chaves omitidas.
    if (err.code) doErro.codigo = err.code;
    if (err.cause) doErro.causa = err.cause instanceof Error ? err.cause.message : err.cause;
    if (Object.keys(doErro).length) base.erro = { ...doErro, ...(base.erro || {}) };
  }
  if (!Object.keys(base).length) return null;
  return limpar(base);
}

module.exports = { limpar, montar };
