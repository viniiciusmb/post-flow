// Mostrar ou esconder tudo que fala da internet do próprio cliente.
//
// O túnel (o programinha de bandeja que faz os downloads saírem pela internet
// do cliente) atravessa o produto inteiro: o menu "Sua conexão", a cota bônus
// em "Plano e uso", a linha de minutos extras nas caixas de preço, o passo do
// tour guiado, o item de preço da landing. Enquanto o fundador não quiser
// oferecer isso, cada um desses lugares seria uma promessa que o produto não
// está fazendo — e a pior delas é a caixa de preço, que anuncia minutos que
// ninguém vai conseguir usar.
//
// ISTO É SÓ EXIBIÇÃO. Nada aqui desliga o túnel: quem já tem o programa
// pareado continua baixando pela internet dele, a cota bônus continua sendo
// creditada e consumida, os jobs continuam rodando. Desligar a funcionalidade
// de verdade seria outra decisão, com outro risco (cliente pareado ficaria sem
// entender por que o download mudou de caminho) — e não foi o que foi pedido.
//
// Padrão ESCONDIDO: é o estado que o fundador pediu para valer agora. Um
// padrão "visível" faria a tela voltar a oferecer o túnel sozinha em qualquer
// base nova, que é justamente o contrário da intenção.
'use strict';

const settingsRepository = require('../repositories/settingsRepository');

const CHAVE = 'mostrar_tunel_cliente';
const PADRAO = false;

async function mostrarTunel() {
  const valor = await settingsRepository.getValue(CHAVE, PADRAO);
  return valor === true || valor === 'true';
}

async function definirMostrarTunel(mostrar) {
  await settingsRepository.setValue(CHAVE, Boolean(mostrar));
  return Boolean(mostrar);
}

module.exports = { CHAVE, PADRAO, mostrarTunel, definirMostrarTunel };
