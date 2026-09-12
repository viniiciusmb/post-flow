// Argumentos do ffmpeg na montagem do vídeo narrado.
//
// No ffmpeg a POSIÇÃO do argumento muda o significado: `-t` antes de um `-i`
// limita AQUELA ENTRADA; depois da última entrada, limita a SAÍDA. Esse
// detalhe já causou um bug real neste projeto (cortes renderizados com o vídeo
// inteiro por baixo). Aqui ele importa duas vezes, porque cada cena é uma
// entrada com o seu próprio `-t`.
//
// Estes testes leem os argumentos gerados sem precisar de ffmpeg instalado.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');

// Intercepta o spawn e devolve os argumentos sem executar nada.
async function argumentosDe(opcoes) {
  const cp = require('child_process');
  const spawnOriginal = cp.spawn;
  let capturados = null;

  cp.spawn = (cmd, args) => {
    capturados = args;
    const filho = new EventEmitter();
    filho.stderr = new EventEmitter();
    filho.stdout = new EventEmitter();
    filho.kill = () => {};
    filho.pid = process.pid;
    setImmediate(() => filho.emit('close', 0));
    return filho;
  };

  delete require.cache[require.resolve('../../src/services/videoEditingService')];
  delete require.cache[require.resolve('../../src/services/narratedVideoRenderService')];
  const render = require('../../src/services/narratedVideoRenderService');

  try {
    await render.renderizar({
      cenas: [
        { imagePath: '/tmp/a.jpg', duration: 10 },
        { imagePath: '/tmp/b.jpg', duration: 4 },
        { imagePath: '/tmp/c.jpg', duration: 7 },
      ],
      audioPath: '/tmp/narracao.m4a',
      destino: '/tmp/saida.mp4',
      ...opcoes,
    });
  } catch {
    // A promessa pode rejeitar por causa do filho de mentira; os argumentos já
    // foram capturados, que é o que interessa.
  } finally {
    cp.spawn = spawnOriginal;
    delete require.cache[require.resolve('../../src/services/videoEditingService')];
    delete require.cache[require.resolve('../../src/services/narratedVideoRenderService')];
  }

  return capturados;
}

// Devolve o índice do argumento, para comparar POSIÇÕES.
function posicao(args, valor, apartirDe = 0) {
  return args.indexOf(valor, apartirDe);
}

test('cada cena entra com o proprio -t, e o -t da SAIDA vem depois da ultima entrada', async () => {
  const args = await argumentosDe({});
  assert.ok(args, 'nao capturei os argumentos');

  // Três imagens + a narração = quatro entradas.
  const entradas = args.filter((a) => a === '-i').length;
  assert.equal(entradas, 4, `esperava 4 entradas (3 imagens + audio), vieram ${entradas}`);

  const ultimoI = args.lastIndexOf('-i');
  const filtro = posicao(args, '-filter_complex');

  // O -t da saída é o que vem DEPOIS da última entrada. Ele tem que valer a
  // soma das cenas (10+4+7 = 21s), porque a cadeia de xfade termina um pouco
  // mais tarde — a última imagem ainda carrega a sobra da transição.
  const tSaida = args.lastIndexOf('-t');
  assert.ok(tSaida > ultimoI, 'o -t da saida ficou antes da ultima entrada e vai limitar a imagem errada');
  assert.ok(tSaida > filtro, 'o -t da saida precisa vir depois do filtro');
  assert.equal(args[tSaida + 1], '21.000', `a saida tem que durar a soma das cenas, veio ${args[tSaida + 1]}`);
});

test('o audio da narracao e a ULTIMA entrada, e e ele que vai para a saida', async () => {
  const args = await argumentosDe({});
  const ultimoI = args.lastIndexOf('-i');
  assert.equal(args[ultimoI + 1], '/tmp/narracao.m4a');

  // Sem música, o áudio mapeado é o índice da narração (3 = depois das 3 imagens).
  const mapas = args.filter((a, i) => args[i - 1] === '-map');
  assert.ok(mapas.includes('3:a'), `o audio mapeado deveria ser 3:a, mapas: ${mapas.join(', ')}`);
});

test('a legenda so entra no filtro quando foi pedida', async () => {
  const sem = await argumentosDe({});
  const com = await argumentosDe({ legendaPath: '/tmp/legenda.ass' });

  const filtroSem = sem[sem.indexOf('-filter_complex') + 1];
  const filtroCom = com[com.indexOf('-filter_complex') + 1];

  assert.ok(!filtroSem.includes('subtitles'), 'legenda desligada nao pode aparecer no filtro');
  assert.ok(filtroCom.includes('subtitles'), 'legenda ligada tem que entrar no filtro');
  // Caminho escapado: dois-pontos sem escape quebra o parser de filtro do ffmpeg.
  assert.ok(filtroCom.includes('legenda.ass'), 'o caminho da legenda sumiu do filtro');
});

test('a musica entra em loop, baixa, e some quando nao foi pedida', async () => {
  const com = await argumentosDe({ musicaPath: '/tmp/trilha.mp3' });
  const filtro = com[com.indexOf('-filter_complex') + 1];

  assert.ok(com.includes('-stream_loop'), 'trilha curta precisa repetir para cobrir video longo');
  assert.ok(filtro.includes('volume=0.08'), 'a musica tem que ficar bem abaixo da narracao');
  assert.ok(filtro.includes('amix'), 'faltou misturar narracao e musica');

  const sem = await argumentosDe({});
  assert.ok(!sem.includes('-stream_loop'));
});

test('o formato escolhido chega de verdade no filtro', async () => {
  const horizontal = await argumentosDe({ aspect: '16:9' });
  const vertical = await argumentosDe({ aspect: '9:16' });

  assert.ok(horizontal[horizontal.indexOf('-filter_complex') + 1].includes('s=1920x1080'));
  assert.ok(vertical[vertical.indexOf('-filter_complex') + 1].includes('s=1080x1920'));
});

test('o preset e o barato - o caro custa 3x mais CPU e gera o mesmo tamanho', async () => {
  const args = await argumentosDe({});
  assert.equal(args[args.indexOf('-preset') + 1], 'veryfast');
  // Sem teto de bitrate, o zoom constante sobre imagem parada infla o arquivo.
  assert.ok(args.includes('-maxrate'), 'faltou o teto de bitrate');
  assert.ok(args.includes('+faststart'), 'sem faststart o player espera baixar tudo para comecar');
});
