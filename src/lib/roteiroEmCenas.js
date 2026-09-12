// Divide o roteiro colado pelo usuario em CENAS - cada uma vira um trecho de
// narracao com uma imagem ilustrando.
//
// A divisao e feita aqui, de forma deterministica, ANTES de chamar a IA. A IA
// depois so escolhe COMO ilustrar cada cena. Isso e de proposito: se ela
// tambem reescrevesse o texto, o roteiro que o usuario colou (que e o produto
// dele) poderia voltar diferente do que ele escreveu.
//
// O tamanho da cena e o que decide o RITMO do video: cada cena e uma imagem
// na tela. Medido na amostra real, a narracao de documentario da OpenAI fala
// ~720 caracteres por minuto, ou seja ~12 caracteres por segundo. Com isso:
//   - MINIMO  80 chars (~7s)  - imagem que fica menos que isso pisca na tela
//   - ALVO   150 chars (~13s) - ritmo de documentario
//   - MAXIMO 260 chars (~22s) - acima disso a mesma imagem cansa
//
// O alvo ja foi 240 chars (~20s por imagem) e foi baixado depois de ver o
// numero na pratica: uma imagem parada por 20 segundos faz o video parecer
// travado, ainda mais com o zoom lento por cima. O preco de trocar mais vezes
// e mais imagens por minuto (~4,8 em vez de 3), e metade delas costuma vir do
// acervo de graca - medido: 2 de 4 termos gerados pela IA acharam imagem real.
//
// O maximo tambem resolve de graca o limite de 4096 caracteres por requisicao
// do TTS da OpenAI, que um roteiro de 10 minutos (~7200 chars) estouraria se
// fosse mandado de uma vez.
'use strict';

const MIN_CHARS = 80;
const ALVO_CHARS = 150;
const MAX_CHARS = 260;

// Quantos caracteres a narracao de documentario fala por segundo. Medido, nao
// chutado: 372 caracteres viraram 31,0s de audio no teste com voz pausada.
const CHARS_POR_SEGUNDO = 12;

function estimarSegundos(texto) {
  return (texto || '').length / CHARS_POR_SEGUNDO;
}

// Quebra um bloco grande em frases. A pontuacao de fim de frase e o unico
// ponto de corte natural: cortar no meio de uma frase faria a narracao parar
// no lugar errado e a imagem trocar no meio de um raciocinio.
function emFrases(texto) {
  const frases = texto.match(/[^.!?…]+(?:[.!?…]+|$)/g);
  return (frases || [texto]).map((f) => f.trim()).filter(Boolean);
}

// Ultimo recurso, para uma "frase" que sozinha ja passa do maximo (texto sem
// pontuacao nenhuma, que acontece em roteiro colado de transcricao). Corta em
// virgula/ponto-e-virgula e, se nem isso houver, no espaco mais proximo do
// limite - nunca no meio de uma palavra.
function partirForcado(texto) {
  const pedacos = [];
  let resto = texto.trim();

  while (resto.length > MAX_CHARS) {
    const janela = resto.slice(0, MAX_CHARS);
    let corte = Math.max(janela.lastIndexOf(', '), janela.lastIndexOf('; '));
    if (corte < MIN_CHARS) corte = janela.lastIndexOf(' ');
    if (corte < MIN_CHARS) corte = MAX_CHARS;
    pedacos.push(resto.slice(0, corte + 1).trim());
    resto = resto.slice(corte + 1).trim();
  }

  if (resto) pedacos.push(resto);
  return pedacos;
}

// Junta frases ate chegar perto do ALVO. Para antes de passar do MAXIMO.
function agruparFrases(frases) {
  const blocos = [];
  let atual = '';

  for (const frase of frases) {
    if (frase.length > MAX_CHARS) {
      if (atual) { blocos.push(atual); atual = ''; }
      blocos.push(...partirForcado(frase));
      continue;
    }

    const juntas = atual ? `${atual} ${frase}` : frase;

    // Passar do maximo nunca vale a pena. Ja passar do alvo vale quando o
    // bloco atual ainda esta curto demais para virar cena sozinho.
    if (juntas.length > MAX_CHARS) {
      blocos.push(atual);
      atual = frase;
    } else if (juntas.length > ALVO_CHARS && atual.length >= MIN_CHARS) {
      blocos.push(atual);
      atual = frase;
    } else {
      atual = juntas;
    }
  }

  if (atual) blocos.push(atual);
  return blocos;
}

// Uma cena curta demais (a ultima frase de um paragrafo, por exemplo) vira um
// piscar de imagem no video. Ela e colada na cena anterior, mesmo que o
// resultado passe um pouco do alvo - imagem que dura demais e so monotona,
// imagem que dura 2 segundos parece defeito.
function absorverCurtas(blocos) {
  const saida = [];

  for (const bloco of blocos) {
    const anterior = saida[saida.length - 1];
    if (bloco.length < MIN_CHARS && anterior && (anterior.length + bloco.length + 1) <= MAX_CHARS) {
      saida[saida.length - 1] = `${anterior} ${bloco}`;
    } else {
      saida.push(bloco);
    }
  }

  // Se a PRIMEIRA cena ficou curta (roteiro que comeca com uma frase solta) o
  // laco acima nao teve em quem encostar; junta com a seguinte.
  if (saida.length > 1 && saida[0].length < MIN_CHARS && (saida[0].length + saida[1].length + 1) <= MAX_CHARS) {
    saida.splice(0, 2, `${saida[0]} ${saida[1]}`);
  }

  return saida;
}

// Entra o roteiro cru, saem as cenas na ordem. Paragrafo e respeitado como
// fronteira: quem escreveu o roteiro ja separou os assuntos ali, e essa e a
// melhor dica de onde a imagem deve trocar.
function dividir(roteiro) {
  const texto = String(roteiro || '').replace(/\r\n/g, '\n').trim();
  if (!texto) return [];

  const paragrafos = texto.split(/\n\s*\n+/).map((p) => p.replace(/\s+/g, ' ').trim()).filter(Boolean);

  const blocos = [];
  for (const paragrafo of paragrafos) {
    blocos.push(...agruparFrases(emFrases(paragrafo)));
  }

  return absorverCurtas(blocos).map((text, idx) => ({
    idx,
    text,
    segundosEstimados: estimarSegundos(text),
  }));
}

module.exports = {
  dividir,
  estimarSegundos,
  MIN_CHARS,
  ALVO_CHARS,
  MAX_CHARS,
  CHARS_POR_SEGUNDO,
};
