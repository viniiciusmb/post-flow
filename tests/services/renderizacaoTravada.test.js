// Rede de segurança para renderização que nunca termina.
//
// Por que ela precisou existir: em 22/08/2026 um corte ficou HORAS rodando um
// ffmpeg que teria levado 8h30, e nada no sistema achava que havia problema.
// O videoStuckRecoveryJob, que acorda vídeo travado, mede "silêncio" pelo
// processing_heartbeat_at — e o heartbeat continua batendo normalmente
// enquanto o job está vivo esperando o ffmpeg. Ou seja: a rede de segurança
// que já existia era cega justamente para este caso, e quem percebeu foi o
// fundador reclamando da demora.
//
// O que estes testes travam:
//   - velocidade absurdamente baixa mata a renderização (com erro, não pausa);
//   - velocidade normal NÃO é interrompida;
//   - a interrupção vira erro visível, nunca "pausado pelo cliente";
//   - o teto de tempo cresce com a duração, mas tem piso e limite.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');

const { PausedError } = require('../../src/lib/errors');

// ffmpeg de mentira. Não termina sozinho — igual ao caso real — e deixa o
// teste escrever a velocidade que quiser no arquivo de progresso.
//
// O ponto central: quem decide matar tem que ser o CÓDIGO. O teste só
// intercepta o `process.kill` para saber que a decisão foi tomada e então
// fecha o processo, como o sistema operacional faria. Matar por conta própria
// testaria o mock, não o produto.
function cenario({ velocidade, duracaoSegundos }) {
  const cp = require('child_process');
  const spawnOriginal = cp.spawn;
  const killOriginal = process.kill;

  let arquivoDeProgresso = null;
  let filho = null;
  let mandouMatar = false;

  cp.spawn = (cmd, args) => {
    const i = args.indexOf('-progress');
    arquivoDeProgresso = i === -1 ? null : args[i + 1];
    filho = new EventEmitter();
    filho.stderr = new EventEmitter();
    filho.stdout = new EventEmitter();
    filho.pid = 999999;
    filho.kill = () => {};
    return filho;
  };

  process.kill = (pid, signal) => {
    // O código mata o GRUPO todo: pid negativo.
    if (pid === -999999) {
      mandouMatar = true;
      setImmediate(() => filho.emit('close', null, 'SIGKILL'));
      return true;
    }
    return killOriginal(pid, signal);
  };

  delete require.cache[require.resolve('../../src/services/videoEditingService')];
  const service = require('../../src/services/videoEditingService');

  const saida = path.join(os.tmpdir(), `trava-${Date.now()}-${Math.random().toString(36).slice(2)}.mp4`);
  const promessa = service.renderClip({
    videoPath: '/tmp/entrada.mp4',
    startSeconds: 0,
    endSeconds: duracaoSegundos,
    words: [],
    title: 'T',
    outputPath: saida,
    settings: { caption_style: 'none', show_title: false },
    partIndex: 1,
    partTotal: 1,
    onProgress: () => {},
  });

  return {
    promessa: promessa.finally(() => {
      cp.spawn = spawnOriginal;
      process.kill = killOriginal;
      fs.rmSync(saida, { force: true });
      delete require.cache[require.resolve('../../src/services/videoEditingService')];
    }),
    // Publica a velocidade no arquivo que o código lê, como o ffmpeg faria.
    reportarVelocidade: () => {
      if (arquivoDeProgresso) {
        fs.writeFileSync(arquivoDeProgresso, `out_time_ms=1000000\nspeed=${velocidade}x\n`);
      }
    },
    mandouMatar: () => mandouMatar,
    terminarComSucesso: () => filho && filho.emit('close', 0, null),
  };
}

// Espera até a condição virar verdadeira (ou desistir), sem prender o laço de
// eventos — o poll do código roda a cada 1,5s de tempo real.
async function esperarAte(condicao, limiteMs = 20000) {
  const fim = Date.now() + limiteMs;
  while (Date.now() < fim) {
    if (condicao()) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

test('o teto de tempo cresce com a duração, mas tem piso e limite', async () => {
  delete require.cache[require.resolve('../../src/services/videoEditingService')];
  const { tetoDeTempoMs } = require('../../src/services/videoEditingService');

  // Corte curto não pode herdar um teto minúsculo: 5s × 30 daria 2,5 min, e
  // uma VPS ocupada estouraria isso sem nada estar errado.
  assert.equal(tetoDeTempoMs(5), 15 * 60 * 1000, 'piso de 15 minutos');
  assert.equal(tetoDeTempoMs(120), 60 * 60 * 1000, '120s x 30 = 1 hora');
  // E não pode crescer sem fim: o objetivo é virar erro visível algum dia.
  assert.equal(tetoDeTempoMs(100000), 2 * 60 * 60 * 1000, 'limite de 2 horas');
  assert.equal(tetoDeTempoMs(null), 15 * 60 * 1000, 'duração ausente cai no piso');
});

test('velocidade normal NÃO é interrompida', async () => {
  // 0,5x é o que esta VPS faz num corte saudável. Um piso mal calibrado que
  // matasse isto seria pior que o bug: derrubaria corte bom em VPS ocupada.
  const c = cenario({ velocidade: '0.5', duracaoSegundos: 30 });
  c.reportarVelocidade();

  await new Promise((r) => setTimeout(r, 4000)); // duas voltas do poll
  assert.equal(c.mandouMatar(), false, 'renderização saudável não pode ser interrompida');

  c.terminarComSucesso();
  await c.promessa;
});

test('velocidade absurda é interrompida com ERRO, não como pausa', async (t) => {
  // 0,0034x foi a velocidade real do corte quebrado de 22/08.
  //
  // O relógio é simulado só para pular o aquecimento (90s reais) — o resto do
  // fluxo é o de produção, inclusive quem manda matar.
  const c = cenario({ velocidade: '0.0034', duracaoSegundos: 30 });
  c.reportarVelocidade();

  // Empurra o relógio para além do aquecimento sem esperar de verdade.
  const agoraOriginal = Date.now;
  const salto = 100_000;
  Date.now = () => agoraOriginal.call(Date) + salto;
  t.after(() => {
    Date.now = agoraOriginal;
  });

  // Captura a rejeição ANTES de esperar: a renderização falha no meio da
  // espera, e sem um handler já ligado isso vira "unhandled rejection".
  const resultado = c.promessa.then(
    () => null,
    (e) => e
  );

  const matou = await esperarAte(() => c.mandouMatar());
  assert.ok(matou, 'o código precisava decidir interromper sozinho');

  const erro = await resultado;
  assert.ok(erro, 'a renderização precisava falhar');
  assert.ok(
    !(erro instanceof PausedError),
    'virar PausedError faria o corte sumir da fila como "pausado pelo cliente", sem nunca aparecer como erro'
  );
  assert.match(erro.message, /lenta demais/i, `mensagem precisa dizer o que houve: ${erro.message}`);
});
