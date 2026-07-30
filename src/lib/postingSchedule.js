// Projeta uma estimativa de quando cada item da fila de postagem vai sair,
// com base na configuracao de agendamento da conta (ver posting_schedule_settings)
// e em quantos ja saem hoje - espelha a mesma logica reativa do
// tiktokPostingJob.js, mas simulando pra frente em vez de agir a cada ciclo.
// E so uma estimativa pra mostrar na tela ("postara aproximadamente em..."),
// nao uma garantia - o job de verdade e reativo e pode variar um pouco.
'use strict';

const AUTO_WINDOW_START_HOUR = 8;
const AUTO_WINDOW_END_HOUR = 22;

function nowInTimezone(timezone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(new Date());
  return {
    hour: Number(parts.find((p) => p.type === 'hour').value),
    minute: Number(parts.find((p) => p.type === 'minute').value),
  };
}

// Data/hora real (aproximada) que corresponde a "HH:MM" nesse fuso horario,
// "dayOffset" dias a partir de hoje - calculada por diferenca de minutos a
// partir do agora nesse fuso (nao trata troca de horario de verao no meio
// da janela, aceitavel pra uma estimativa de UI).
function projectedTimestamp(hhmm, dayOffset, timezone) {
  const { hour: nowHour, minute: nowMinute } = nowInTimezone(timezone);
  const nowTotalMin = nowHour * 60 + nowMinute;
  const [th, tm] = String(hhmm).split(':').map(Number);
  const targetTotalMin = th * 60 + (tm || 0);
  const diffMinutes = targetTotalMin - nowTotalMin + dayOffset * 24 * 60;
  return new Date(Date.now() + diffMinutes * 60000);
}

// Um slot calculado no passado (ja passou hoje, mas ainda nao foi
// consumido porque o job so roda a cada ~10min) vira "agora" pra exibicao -
// mostrar um horario que ja passou como "vai postar" seria confuso.
function clampToFuture(date) {
  const now = new Date();
  return date < now ? now : date;
}

function projectManual({ manualTimes, videosPerDay, timezone, postedToday, count }) {
  const sorted = [...manualTimes].sort();
  const slotsPerDay = Math.max(1, Math.min(sorted.length, videosPerDay));
  const results = [];
  for (let i = 0; i < count; i++) {
    const globalIndex = postedToday + i;
    const dayOffset = Math.floor(globalIndex / slotsPerDay);
    const slotWithinDay = globalIndex % slotsPerDay;
    results.push(clampToFuture(projectedTimestamp(sorted[slotWithinDay], dayOffset, timezone)));
  }
  return results;
}

function projectAuto({ videosPerDay, timezone, postedToday, count }) {
  const windowMinutes = (AUTO_WINDOW_END_HOUR - AUTO_WINDOW_START_HOUR) * 60;
  const minGap = Math.max(20, Math.floor(windowMinutes / videosPerDay));
  const results = [];
  for (let i = 0; i < count; i++) {
    const globalIndex = postedToday + i;
    const dayOffset = Math.floor(globalIndex / videosPerDay);
    const slotWithinDay = globalIndex % videosPerDay;
    const minutesFromStart = slotWithinDay * minGap;
    const hhmm = `${String(AUTO_WINDOW_START_HOUR + Math.floor(minutesFromStart / 60)).padStart(2, '0')}:${String(minutesFromStart % 60).padStart(2, '0')}`;
    results.push(clampToFuture(projectedTimestamp(hhmm, dayOffset, timezone)));
  }
  return results;
}

// Devolve um array de Date, um por item da fila (na mesma ordem/FIFO usada
// pra escolher o proximo a publicar).
function projectQueueTimes({ mode, manualTimes, videosPerDay, timezone, postedToday, count }) {
  if (count <= 0) return [];
  if (mode === 'manual' && manualTimes.length > 0) {
    return projectManual({ manualTimes, videosPerDay, timezone, postedToday, count });
  }
  return projectAuto({ videosPerDay, timezone, postedToday, count });
}

module.exports = { projectQueueTimes };
