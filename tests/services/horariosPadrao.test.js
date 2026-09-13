// Os horários do modo Padrão de postagem.
//
// A fórmula antiga espaçava por minuto exato dentro de uma janela de 14h e
// produzia coisas como "10:48, 13:36, 16:24" — horários que ninguém escolheria
// e que fazem a tela parecer quebrada. Isso empurrava o cliente para o modo
// manual, onde o botão de adicionar horário punha sempre "12:00": um cliente
// de verdade terminou com 08:10, 12:00, 12:00, 12:00, 21:10 (13/09/2026), ou
// seja, três publicações disputando o mesmo minuto.
//
// O que estes testes travam:
//   - hora cheia, sempre (é o que faz o horário parecer escolhido por alguém);
//   - espalhados pela janela, não amontoados no começo do dia;
//   - nunca dois no mesmo horário — um horário é uma publicação;
//   - o modo Padrão usa EXATAMENTE esses horários (a tela mostra o que o
//     sistema vai fazer, e não uma estimativa parecida).
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { horariosPadrao, projectQueueTimes } = require('../../src/lib/postingSchedule');

test('todo horário do modo Padrão é hora cheia', () => {
  for (let n = 1; n <= 10; n++) {
    for (const hora of horariosPadrao(n)) {
      assert.match(hora, /^\d{2}:00$/, `${n} por dia gerou "${hora}", que não é hora cheia`);
    }
  }
});

test('quatro por dia dá exatamente 08:00, 12:00, 16:00 e 20:00', () => {
  assert.deepEqual(horariosPadrao(4), ['08:00', '12:00', '16:00', '20:00']);
});

test('um por dia sai ao meio-dia, não às 8h', () => {
  // Quem posta uma vez por dia está escolhendo o melhor horário do dia, e as
  // 8h da manhã não são ele.
  assert.deepEqual(horariosPadrao(1), ['12:00']);
});

test('nunca repete horário, em nenhuma quantidade', () => {
  for (let n = 1; n <= 10; n++) {
    const horas = horariosPadrao(n);
    assert.equal(horas.length, n, `${n} por dia devolveu ${horas.length} horários`);
    assert.equal(new Set(horas).size, n, `${n} por dia repetiu horário: ${horas.join(' ')}`);
  }
});

test('os horários crescem e ficam na janela em que faz sentido publicar', () => {
  for (let n = 2; n <= 10; n++) {
    const horas = horariosPadrao(n).map((h) => Number(h.slice(0, 2)));
    for (let i = 1; i < horas.length; i++) {
      assert.ok(horas[i] > horas[i - 1], `${n} por dia saiu fora de ordem: ${horas.join(' ')}`);
    }
    assert.ok(horas[0] >= 8, `${n} por dia começa antes das 8h`);
    assert.ok(horas[horas.length - 1] <= 22, `${n} por dia termina depois das 22h`);
  }
});

test('o modo Padrão espalha pelo dia em vez de amontoar de manhã', () => {
  // O defeito da fórmula antiga com 5 por dia: 08:00 a 19:12 com passos de
  // 2h48. O que importa aqui é a cobertura - a última publicação não pode cair
  // no meio da tarde, quando a noite é o horário de mais audiência.
  const horas = horariosPadrao(5).map((h) => Number(h.slice(0, 2)));
  assert.ok(horas[horas.length - 1] >= 19, `a última publicação do dia é às ${horas[horas.length - 1]}h`);
});

test('o modo Padrão usa exatamente os horários que a tela mostra', () => {
  // Se projectAuto tivesse a própria conta, a tela mostraria um horário e o
  // corte sairia em outro - que é o defeito que a reescrita de 24/08/2026
  // corrigiu no outro sentido.
  const comuns = { videosPerDay: 4, timezone: 'America/Sao_Paulo', postedToday: 0, count: 4 };
  const padrao = projectQueueTimes({ mode: 'auto', manualTimes: [], ...comuns });
  const manualComOsMesmos = projectQueueTimes({
    mode: 'manual',
    manualTimes: horariosPadrao(4),
    ...comuns,
  });

  assert.deepEqual(
    padrao.map((d) => d.getTime()),
    manualComOsMesmos.map((d) => d.getTime())
  );
});
