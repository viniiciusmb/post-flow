'use strict';

// Tradução das páginas renderizadas no servidor (landing, termos, privacidade,
// contato, erro).
//
// Feito à mão, sem biblioteca, pelo mesmo motivo do lado React: o que se precisa
// aqui é buscar um caminho num objeto. `t('landing.hero.titulo')` devolve texto;
// caminhos que apontam pra lista (as perguntas frequentes, os itens de uma
// seção legal) devolvem a lista inteira, pra view percorrer.
//
// O português é a fonte de verdade das chaves. Quando uma tradução falta, cai
// no português em vez de imprimir a chave crua: uma frase no idioma errado
// incomoda, uma tela mostrando "landing.hero.titulo" parece quebrada.

const { PADRAO, resolverDaRequisicao, htmlLang, IDIOMAS } = require('../config/locales');

const DICIONARIOS = {
  pt: require('./pt'),
  en: require('./en'),
  es: require('./es'),
};

function buscar(objeto, caminho) {
  return caminho.split('.').reduce((atual, parte) => {
    if (atual === null || atual === undefined) return undefined;
    return atual[parte];
  }, objeto);
}

function criarT(idioma) {
  const dicionario = DICIONARIOS[idioma] || DICIONARIOS[PADRAO];

  return function t(caminho, valores) {
    let valor = buscar(dicionario, caminho);
    if (valor === undefined) valor = buscar(DICIONARIOS[PADRAO], caminho);
    if (valor === undefined) return caminho;
    if (typeof valor !== 'string') return valor;
    if (!valores) return valor;
    return valor.replace(/\{(\w+)\}/g, (bruto, nome) =>
      Object.prototype.hasOwnProperty.call(valores, nome) ? String(valores[nome]) : bruto
    );
  };
}

// Deixa `t`, `lang` e a lista de idiomas disponiveis em toda view, sem que
// nenhum controller precise passar isso adiante - foi assim que o dominio
// acabou escrito 12 vezes no cabecalho publico antes.
function middleware(req, res, next) {
  const idioma = resolverDaRequisicao(req);
  req.idioma = idioma;
  res.locals.lang = idioma;
  res.locals.htmlLang = htmlLang(idioma);
  res.locals.idiomas = IDIOMAS;
  res.locals.t = criarT(idioma);
  next();
}

module.exports = { criarT, middleware };
