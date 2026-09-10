'use strict';

// "Não processar vídeos acima de N minutos", por canal.
//
// Um canal que publica cortes de 2 minutos e lives de 3 horas faz o sistema
// gastar, na live, um download gigante, uma transcrição cara e dezenas de
// cortes que ninguém pediu.
//
// A decisão fica aqui, sozinha e sem banco, porque ela precisa ser exercitada
// nos casos de borda (duração desconhecida, limite não configurado, vídeo
// exatamente no limite) sem subir job nenhum.

// Vídeo EXATAMENTE no limite passa. "Não processar acima de 20 minutos" quer
// dizer que 20 minutos ainda serve - é assim que a frase é lida, e o contrário
// obrigaria a explicar a regra na tela.
function passaDoLimite(durationSeconds, maxVideoMinutes) {
  if (!maxVideoMinutes || maxVideoMinutes <= 0) return false;

  // Duração desconhecida NÃO é barrada. A listagem do canal às vezes vem sem
  // ela, e barrar por falta de informação faria o canal parar de trazer vídeo
  // por um motivo que o cliente não configurou. Errar aqui para o lado de
  // processar é o mesmo critério que o resto do projeto usa quando falta dado.
  const segundos = Number(durationSeconds);
  if (!Number.isFinite(segundos) || segundos <= 0) return false;

  return segundos > maxVideoMinutes * 60;
}

// Opções que a tela oferece. O cliente também pode digitar qualquer número -
// estas são só os atalhos para os casos comuns.
const SUGESTOES_DE_MINUTOS = [10, 20, 30, 45, 60, 90, 120];

// Teto do que dá para configurar. 24 horas é mais que qualquer vídeo do
// YouTube; o limite existe para o campo não aceitar um número absurdo que
// depois vira uma conta estranha na tela.
const MAX_MINUTOS = 24 * 60;

function normalizarLimite(valor) {
  if (valor === null || valor === undefined || valor === '') return null;
  const n = Math.floor(Number(valor));
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.min(n, MAX_MINUTOS);
}

module.exports = { passaDoLimite, normalizarLimite, SUGESTOES_DE_MINUTOS, MAX_MINUTOS };
