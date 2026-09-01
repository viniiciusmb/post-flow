// Duas correções visuais pedidas pelo fundador em 01/09/2026, ambas no .ass
// que o ffmpeg queima no vídeo.
//
// 1. O adesivo "Parte N" era 56px fixos num quadro de 1080x1920 — menos da
//    metade da legenda, e "quase não aparece nos vídeos". Agora tem um
//    tamanho-base maior e é o cliente quem decide.
//
// 2. Quando o título quebrava linha, a segunda linha caía para fora do fundo
//    escolhido para ele (visto num corte real, com o papel rasgado). A causa:
//    o texto era pendurado pelo TOPO (alinhamento 8 + MarginV), então crescia
//    só para baixo, enquanto o fundo ficava parado.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const videoEditingService = require('../../src/services/videoEditingService');
const { buildAssSubtitles, quebrarTitulo, centroDoTitulo, tamanhoDaNumeracao } = videoEditingService;

const PALAVRAS = [{ word: 'olá', start: 0, end: 0.4 }];

function linhaDeEstilo(ass, nome) {
  return ass.split('\n').find((l) => l.startsWith(`Style: ${nome},`));
}

function falaDoTitulo(ass) {
  return ass.split('\n').find((l) => l.startsWith('Dialogue:') && l.includes(',Title,'));
}

function montar(extras = {}) {
  return buildAssSubtitles(
    PALAVRAS,
    'classic',
    'classic',
    extras.titulo ?? null,
    extras.tituloSegundos ?? 0,
    extras.parte ?? null,
    extras.posicao ?? 'top_right',
    30,
    { titleFont: 'Anton', captionFont: 'Anton', titleHeightPercent: 8, ...extras.opcoes }
  );
}

// --- 1. Tamanho do adesivo "Parte N" ---

test('a numeração nasce bem maior que os 56px de antes', () => {
  const ass = montar({ parte: 'Parte 2' });
  const tamanho = Number(linhaDeEstilo(ass, 'Part').split(',')[2]);
  assert.ok(tamanho > 56, `a numeração continuou em ${tamanho}px — o pedido era justamente que ela crescesse`);
});

test('o cliente aumenta e diminui o adesivo', () => {
  const grande = Number(linhaDeEstilo(montar({ parte: 'Parte 2', opcoes: { partLabelSizePercent: 200 } }), 'Part').split(',')[2]);
  const padrao = Number(linhaDeEstilo(montar({ parte: 'Parte 2', opcoes: { partLabelSizePercent: 100 } }), 'Part').split(',')[2]);
  const pequeno = Number(linhaDeEstilo(montar({ parte: 'Parte 2', opcoes: { partLabelSizePercent: 50 } }), 'Part').split(',')[2]);

  assert.ok(grande > padrao && padrao > pequeno, `os três tamanhos não ficaram em ordem: ${pequeno}/${padrao}/${grande}`);
  assert.equal(grande, padrao * 2, '200% tem que ser o dobro de 100%');
});

test('o respiro da caixa acompanha a letra', () => {
  // Fixo em 10 (como era), uma numeração de 200% ficaria espremida numa caixa
  // dimensionada para 56px.
  const campos = (p) => linhaDeEstilo(montar({ parte: 'Parte 2', opcoes: { partLabelSizePercent: p } }), 'Part').split(',');
  // Índice 16 = Outline no formato do ASS (contando o "Style: Part" como 0).
  // Com BorderStyle=3 é ele que vira o respiro da caixa.
  const respiroPequeno = Number(campos(50)[16]);
  const respiroGrande = Number(campos(200)[16]);
  assert.ok(respiroGrande > respiroPequeno, 'a caixa não cresceu junto com a letra');
});

test('tamanho fora da faixa é preso nos limites, não aceito', () => {
  assert.equal(tamanhoDaNumeracao(5000), tamanhoDaNumeracao(200));
  assert.equal(tamanhoDaNumeracao(-10), tamanhoDaNumeracao(50));
  assert.equal(tamanhoDaNumeracao(undefined), tamanhoDaNumeracao(100), 'sem escolha, vale o padrão');
});

// --- 2. Título centralizado mesmo quebrando linha ---

test('o título é ancorado pelo CENTRO, não pendurado pelo topo', () => {
  const fala = falaDoTitulo(montar({ titulo: 'Motor e gerador', tituloSegundos: 3 }));
  assert.match(fala, /\{\\an5\\pos\(\d+,\d+\)\}/, 'o título não declarou \\an5 + \\pos — é isso que o centraliza');
});

test('título longo quebra em linhas de verdade dentro do .ass', () => {
  const titulo = 'Motor e gerador são a mesma coisa? A verdade revelada';
  const fala = falaDoTitulo(montar({ titulo, tituloSegundos: 3 }));
  assert.ok(fala.includes('\\N'), 'o título não foi quebrado aqui — quem quebrar seria o libass, num ponto que este código não sabe calcular');
});

test('o ponto de ancoragem é o MESMO com uma linha ou com três', () => {
  // É isto que faz o texto crescer para os dois lados em vez de escapar do
  // fundo por baixo: o centro não se move quando aparece mais uma linha.
  const pos = (titulo) => falaDoTitulo(montar({ titulo, tituloSegundos: 3 })).match(/\\pos\((\d+),(\d+)\)/);

  const umaLinha = pos('Curto');
  const varias = pos('Motor e gerador são a mesma coisa? A verdade completa revelada agora');

  assert.equal(umaLinha[2], varias[2], 'o centro se moveu quando o título quebrou linha');
  assert.equal(umaLinha[1], varias[1], 'o centro horizontal se moveu');
});

test('título de uma linha continua saindo onde sempre saiu', () => {
  // A altura escolhida pelo cliente sempre marcou o topo da primeira linha.
  // Ancorar pelo centro dessa mesma primeira linha faz o caso de uma linha —
  // que é a maioria — não mudar de lugar para ninguém.
  const margemV = Math.round((8 / 100) * 1920);
  const tamanho = 72; // TITLE_STYLES.classic
  const esperado = centroDoTitulo(margemV, tamanho);

  const fala = falaDoTitulo(montar({ titulo: 'Curto', tituloSegundos: 3 }));
  const y = Number(fala.match(/\\pos\(\d+,(\d+)\)/)[1]);

  assert.equal(y, esperado);
  assert.ok(Math.abs(y - (margemV + tamanho / 2)) < 20, `o título saltou para longe de onde ficava (${y} vs ~${margemV + tamanho / 2})`);
});

test('a quebra respeita palavras e um teto de linhas', () => {
  const linhas = quebrarTitulo('uma frase bem comprida que precisa quebrar em varias linhas mesmo', 'Poppins', 72);
  assert.ok(linhas.length > 1);
  assert.ok(linhas.length <= 3, `quebrou em ${linhas.length} linhas — um título assim cobriria o corte inteiro`);
  for (const l of linhas) {
    assert.ok(!l.startsWith(' ') && !l.endsWith(' '), `linha com espaço sobrando: "${l}"`);
  }
  assert.equal(
    linhas.join(' '),
    'uma frase bem comprida que precisa quebrar em varias linhas mesmo',
    'a quebra perdeu ou duplicou palavra'
  );
});

test('fonte mais larga quebra mais cedo', () => {
  const frase = 'titulo de tamanho medio para comparar as fontes';
  const condensada = quebrarTitulo(frase, 'Bebas Neue', 72);
  const larga = quebrarTitulo(frase, 'Poppins', 72);
  assert.ok(
    larga.length >= condensada.length,
    'a fonte larga não quebrou pelo menos tanto quanto a condensada — a estimativa ignora a fonte'
  );
});

test('título vazio não vira linha nenhuma', () => {
  assert.deepEqual(quebrarTitulo('   ', 'Anton', 72), []);
  assert.deepEqual(quebrarTitulo(null, 'Anton', 72), []);
});
