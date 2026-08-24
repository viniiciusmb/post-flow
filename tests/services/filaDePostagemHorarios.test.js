// Dois defeitos que apareceram juntos na conta de um cliente em 23/08/2026:
// um vídeo virou 8 cortes, e a fila de postagem mostrava só 2.
//
//   1. Seis postagens foram marcadas como ERRO sem nenhuma tentativa. A TikTok
//      recusou o início do upload com "The total chunk count is invalid" —
//      nossa conta de pedaços usava Math.ceil, e a regra da API é floor.
//      Nunca tinha aparecido porque corte de 30s cabe num pedaço só; cortes de
//      3 minutos (~110 MB) não cabem.
//
//   2. As seis foram agendadas para o MESMO horário (00:00), ignorando os
//      quatro horários configurados. Cada corte, ao ficar pronto, pedia "o
//      próximo slot livre" — e a projeção pula slots vencidos sem consumir
//      posição na fila, então todas caíam no mesmo primeiro horário futuro.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { calcularPedacos } = require('../../src/services/tiktokService');
const postingsRepository = require('../../src/repositories/postingsRepository');
const videosRepository = require('../../src/repositories/videosRepository');
const pool = require('../../src/db/pool');
const { createClient } = require('../helpers/db');

test.after(async () => {
  await pool.end();
});

const MB = 1024 * 1024;

// --- 1. A conta de pedaços do upload ---

test('a quantidade de pedaços é arredondada pra BAIXO, como a TikTok exige', () => {
  // O caso real: 121,4 MB. ceil daria 2 pedaços de 64 MB, e a conta da TikTok
  // (floor) fecha em 1 — foi o "total chunk count is invalid".
  const { chunkSize, totalChunkCount } = calcularPedacos(127315531);
  assert.equal(totalChunkCount, Math.floor(127315531 / chunkSize));
  assert.equal(totalChunkCount, 1);
});

test('arquivo que cabe num pedaço manda chunk_size igual ao tamanho dele', () => {
  // Não o teto de 64 MB: a TikTok quer o tamanho real quando é um pedaço só.
  for (const tamanho of [3 * MB, 20 * MB, 64 * MB]) {
    const r = calcularPedacos(tamanho);
    assert.equal(r.totalChunkCount, 1, `${tamanho} bytes devia ser 1 pedaço`);
    assert.equal(r.chunkSize, tamanho);
  }
});

test('nunca manda pedaço nenhum, nem pedaço maior que o teto', () => {
  for (const tamanho of [1, 5 * MB, 64 * MB, 65 * MB, 200 * MB, 3000 * MB]) {
    const { chunkSize, totalChunkCount } = calcularPedacos(tamanho);
    assert.ok(totalChunkCount >= 1, `${tamanho} gerou ${totalChunkCount} pedaços`);
    assert.ok(chunkSize <= 64 * MB, `${tamanho} pediu pedaço de ${chunkSize} bytes`);
  }
});

test('o último pedaço leva o resto e o arquivo inteiro é coberto', () => {
  // A regra que faz o floor funcionar: o resto da divisão não vira um pedaço
  // extra, ele é anexado ao último. Se o upload parasse em chunkSize, o fim do
  // vídeo nunca subiria e a TikTok ficaria esperando pra sempre.
  for (const tamanho of [127315531, 65 * MB, 200 * MB, 129 * MB]) {
    const { chunkSize, totalChunkCount } = calcularPedacos(tamanho);
    const inicioDoUltimo = (totalChunkCount - 1) * chunkSize;
    const ultimoPedaco = tamanho - inicioDoUltimo;
    assert.ok(ultimoPedaco > 0, `${tamanho}: último pedaço ficou vazio`);
    // A TikTok aceita último pedaço maior que chunk_size, mas não acima de 128 MB.
    assert.ok(ultimoPedaco <= 128 * MB, `${tamanho}: último pedaço de ${ultimoPedaco} bytes passa de 128 MB`);
  }
});

// --- 2. O agendamento da fila ---

// O defeito só aparece quando os horários do dia JÁ PASSARAM (é aí que a
// projeção pula slots). Como o teste roda a qualquer hora, procuramos um fuso
// onde agora é quase meia-noite — assim 08:00/12:00/16:00/20:00 estão todos no
// passado, de propósito.
function fusoOndeJaEhQuaseMeiaNoite() {
  const zonas = ['UTC'];
  for (let x = -14; x <= 12; x++) if (x !== 0) zonas.push(`Etc/GMT${x > 0 ? '+' : ''}${x}`);
  for (const zona of zonas) {
    const hora = Number(
      new Intl.DateTimeFormat('en-US', { timeZone: zona, hour: 'numeric', hourCycle: 'h23' })
        .formatToParts(new Date())
        .find((p) => p.type === 'hour').value
    );
    if (hora === 23) return zona;
  }
  throw new Error('nenhum fuso com hora local 23 - impossível, a faixa cobre 27 horas');
}

let seq = 0;
const unico = () => `${Date.now()}${seq++}`;

async function contaComHorarios(horarios) {
  const cliente = await createClient();
  const { rows: [conta] } = await pool.query(
    `INSERT INTO tiktok_accounts (client_user_id, tiktok_open_id, display_name, is_active,
       access_token_encrypted, access_token_iv, refresh_token_encrypted, refresh_token_iv,
       scopes, token_expires_at, connected_at, auto_post_enabled)
     VALUES ($1, $2, 'conta', true, 'x','x','x','x', ARRAY['video.publish'],
       now() + interval '30 days', now(), true)
     RETURNING *`,
    [cliente.id, `open-${unico()}`]
  );
  await pool.query(
    `INSERT INTO posting_schedule_settings (tiktok_account_id, mode, manual_times, videos_per_day, timezone)
     VALUES ($1, 'manual', $2, $3, $4)
     ON CONFLICT (tiktok_account_id) DO UPDATE
       SET mode = 'manual', manual_times = $2, videos_per_day = $3, timezone = $4`,
    [conta.id, horarios, horarios.length, fusoOndeJaEhQuaseMeiaNoite()]
  );
  return { cliente, conta };
}

// Cria um corte pronto e o registro de vídeo que a fila enxerga.
async function corteRegistrado(clienteId) {
  const { rows: [sv] } = await pool.query(
    `INSERT INTO source_videos (youtube_video_id, title, status, input_type, owner_client_user_id, client_user_id)
     VALUES ($1, 'video', 'ready', 'upload', $2, $2) RETURNING *`,
    [`v${unico()}`, clienteId]
  );
  const { rows: [clip] } = await pool.query(
    `INSERT INTO clips (source_video_id, start_seconds, end_seconds, status, title)
     VALUES ($1, 0, 184, 'ready', 'corte') RETURNING *`,
    [sv.id]
  );
  return videosRepository.createFromClip({ clipId: clip.id, filename: 'c.mp4', fileSizeBytes: 110 * MB });
}

// O SLOT (dia + hora:minuto no fuso da conta), não o carimbo exato.
//
// Isso não é detalhe: sob o defeito, os seis carimbos diferiam em
// MILISSEGUNDOS uns dos outros — cada corte era criado num instante diferente
// e o cálculo preservava os segundos do "agora" — mas apontavam todos pro
// mesmo horário. Comparar timestamp cru dava seis valores "diferentes" e o
// teste passava com o bug em pé. Na produção deu 00:00:07.635, 00:00:51.810,
// 00:00:51.415... todos o mesmo 00:00.
function slotDe(quando, fuso) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: fuso, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(new Date(quando));
}

async function fusoDaConta(contaId) {
  const { rows } = await pool.query('SELECT timezone FROM posting_schedule_settings WHERE tiktok_account_id = $1', [contaId]);
  return rows[0].timezone;
}

test('cortes que ficam prontos em sequência NÃO caem todos no mesmo horário', async () => {
  // O caso real: 6 cortes terminaram entre 20h24 e 21h02, todos os horários do
  // dia já tinham passado, e os 6 foram agendados pra 00:00 — 5 deles fora de
  // qualquer horário que o cliente escolheu.
  const { cliente, conta } = await contaComHorarios(['08:00', '12:00', '16:00', '20:00']);
  const fuso = await fusoDaConta(conta.id);

  const slots = [];
  for (let i = 0; i < 6; i++) {
    const video = await corteRegistrado(cliente.id);
    const posting = await postingsRepository.createIfNotExists({ videoId: video.id, tiktokAccountId: conta.id });
    slots.push(slotDe(posting.scheduled_for, fuso));
  }

  assert.equal(
    new Set(slots).size,
    6,
    `os 6 cortes tinham que ir pra 6 horários diferentes, mas ficaram em ${new Set(slots).size}: ${slots.join(', ')}`
  );
  for (let i = 1; i < slots.length; i++) {
    assert.ok(slots[i] > slots[i - 1], `o corte ${i + 1} (${slots[i]}) não veio depois do ${i} (${slots[i - 1]})`);
  }
});

test('cada corte cai num horário que o cliente realmente escolheu', async () => {
  const { cliente, conta } = await contaComHorarios(['08:00', '12:00', '16:00', '20:00']);
  const fuso = await fusoDaConta(conta.id);

  for (let i = 0; i < 5; i++) {
    const video = await corteRegistrado(cliente.id);
    const posting = await postingsRepository.createIfNotExists({ videoId: video.id, tiktokAccountId: conta.id });
    const hhmm = new Intl.DateTimeFormat('en-US', {
      timeZone: fuso, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).format(new Date(posting.scheduled_for));
    assert.ok(
      ['08:00', '12:00', '16:00', '20:00'].includes(hhmm),
      `corte ${i + 1} foi agendado pras ${hhmm}, que não é um dos horários configurados`
    );
  }
});

test('nenhum corte é agendado pro passado', async () => {
  const { cliente, conta } = await contaComHorarios(['08:00', '12:00', '16:00', '20:00']);
  for (let i = 0; i < 3; i++) {
    const video = await corteRegistrado(cliente.id);
    const posting = await postingsRepository.createIfNotExists({ videoId: video.id, tiktokAccountId: conta.id });
    assert.ok(new Date(posting.scheduled_for) > new Date(), `corte ${i + 1} foi agendado pro passado`);
  }
});
