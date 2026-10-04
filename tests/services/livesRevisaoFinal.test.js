// Revisao final dos cortes de live (04/10/2026): depois do ajuste fino, uma
// IA le SO o que ficou dentro do corte e aprova, corrige o inicio/fim ou
// descarta. Aqui o render roda de verdade, com ffmpeg e OpenAI falsos.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const pool = require('../../src/db/pool');
const livesRepository = require('../../src/repositories/livesRepository');
const liveRenderService = require('../../src/services/lives/liveRenderService');
const liveFormatoService = require('../../src/services/lives/liveFormatoService');
const openaiLives = require('../../src/services/lives/openaiLives');
const videoEditingService = require('../../src/services/videoEditingService');
const openaiTranscriptionService = require('../../src/services/openaiTranscriptionService');
const tiposDeMomento = require('../../src/services/lives/tiposDeMomento');
const { createClient } = require('../helpers/db');

test.after(async () => {
  await pool.end();
});

function trocar(modulo, nome, falsa) {
  const original = modulo[nome];
  modulo[nome] = falsa;
  return () => { modulo[nome] = original; };
}

// Fala do arquivo de trabalho: 10 frases de 10s. A historia comeca na frase
// das 20s ("deixa eu contar") e termina na das 80s ("e foi assim que...").
const FRASES = [
  'e ai galera', 'beleza', 'deixa eu contar o que aconteceu ontem', 'eu fui no mercado e o cara',
  'me olhou estranho', 'ai ele falou que eu era famoso', 'pediu foto e tudo', 'mas era outro cara',
  'e foi assim que eu passei vergonha', 'enfim vamos jogar',
].map((texto, i) => ({ start: i * 10, end: i * 10 + 9.5, text: texto }));
const PALAVRAS = FRASES.flatMap((f) => f.text.split(' ').map((w, j, arr) => ({
  word: w, start: f.start + (j * 9) / arr.length, end: f.start + ((j + 1) * 9) / arr.length,
})));

async function cenario(source = 'triagem') {
  const u = await createClient();
  const canal = await livesRepository.upsertChannel({ login: `rev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`, displayName: 'x', platformUserId: '1', profileImageUrl: null });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rev-'));
  const s = await livesRepository.createSession({ channelId: canal.id, dirPath: dir });
  await pool.query('UPDATE live_sessions SET recorded_seconds = 600 WHERE id = $1', [s.id]);
  await livesRepository.insertSegments(s.id, 'video', Array.from({ length: 20 }, (_, i) => ({
    seq: i, file_path: path.join(dir, `seg_${i}.ts`), start_offset: i * 10, end_offset: (i + 1) * 10, bytes: 1,
  })));
  const cand = await livesRepository.insertCandidate({ sessionId: s.id, source: source === 'clipar_agora' ? 'clipar_agora' : 'triagem', inicio: 60, fim: 90, nota: 8 });
  await livesRepository.judgeCandidate(cand.id, { status: 'escolhido', nota: 8, inicio: 60, fim: 90, titulo: 'Titulo do juiz', gancho: 'g', porque: '', tipo: 'historia' });
  const clip = await livesRepository.insertClip({ sessionId: s.id, channelId: canal.id, userId: u.id, candidateId: cand.id, source, inicio: 60, fim: 90, titulo: 'Titulo do juiz', gancho: 'g', nota: 8 });
  return { clip, u };
}

// Troca tudo que e externo; "respostas" da IA por nome da chamada.
function ambienteFalso(respostas) {
  const chamadas = { ia: [], render: null };
  const desfazer = [
    trocar(videoEditingService, 'runFfmpeg', async () => {}),
    trocar(videoEditingService, 'probeDuration', async () => 200),
    trocar(videoEditingService, 'extractThumbnail', async () => {}),
    trocar(videoEditingService, 'renderClip', async (o) => { chamadas.render = o; }),
    trocar(openaiTranscriptionService, 'transcribeAudio', async () => ({ words: PALAVRAS, segments: FRASES, durationSeconds: 100, costUsd: 0.01 })),
    trocar(liveFormatoService, 'escolherFormato', async () => ({ formato: 'quadro_inteiro', paineis: [] })),
    trocar(openaiLives, 'pedirJson', async (p) => {
      chamadas.ia.push(p);
      return { dados: respostas[p.nome], inputTokens: 10, outputTokens: 10, custoUsd: 0.001 };
    }),
  ];
  return { chamadas, desfazer: () => desfazer.forEach((d) => d()) };
}

// Pega ESTE corte como o render pega (status renderizando + tipo do momento
// do candidato). Nao usa claimClipToRender: na suite completa ha cortes de
// outros testes na fila, e ele sempre devolveria o mais antigo.
async function claimDo(clipId) {
  const { rows } = await pool.query(
    `UPDATE live_clips k SET status = 'renderizando' WHERE k.id = $1
     RETURNING k.*, (SELECT moment_type FROM live_candidates c WHERE c.id = k.candidate_id) AS moment_type`,
    [clipId]
  );
  return rows[0];
}

// Os tempos da IA sao no eixo do ARQUIVO DE TRABALHO, como no render real.
// O audio da legenda e extraido a partir de 15s desse arquivo (trecho em 60s,
// historia com 45s de margem antes), e o render soma esses 15s nos tempos da
// fala: "deixa eu contar" (20s acima) fica em 35s, e a conclusao "e foi assim
// que eu passei vergonha" (80s-89,5s acima) fica em 95s-104,5s.
const AJUSTE = { inicio_s: 65, fim_s: 95, titulo: 'Ajuste', gancho: 'g2' };

test('revisao "descartar": o corte nao renderiza, vira descartado com o motivo, e o custo da revisao fica no livro', async () => {
  const { clip } = await cenario();
  const amb = ambienteFalso({
    ajuste_fino: AJUSTE,
    revisao_corte: {
      entende_sozinho: false, comeco_ok: false, fim_ok: false, nota_historia: 2, problemas: 'comeca no meio da conversa e nao tem desfecho',
      veredito: 'descartar', inicio_s: 50, fim_s: 80, titulo: 'x', gancho: 'y',
    },
  });
  try {
    await liveRenderService.renderizar(await claimDo(clip.id));
  } finally {
    amb.desfazer();
  }
  assert.equal(amb.chamadas.render, null, 'descartado nao gasta CPU de render');
  const { rows } = await pool.query('SELECT status, error_message, review FROM live_clips WHERE id = $1', [clip.id]);
  assert.equal(rows[0].status, 'descartado');
  assert.match(rows[0].error_message, /meio da conversa/);
  assert.equal(rows[0].review.veredito, 'descartar');
  const custo = await pool.query("SELECT count(*)::int AS n FROM live_costs WHERE kind = 'revisao' AND session_id = $1", [clip.session_id]);
  assert.equal(custo.rows[0].n, 1);
});

test('revisao "corrigido": o corte sai no inicio/fim corrigidos (encaixados na fala) e com o titulo reescrito', async () => {
  const { clip } = await cenario();
  const amb = ambienteFalso({
    ajuste_fino: AJUSTE,
    revisao_corte: {
      entende_sozinho: true, comeco_ok: false, fim_ok: true, nota_historia: 8, problemas: 'faltava o comeco do causo',
      // Puxa o inicio pra frase do "deixa eu contar" (35s) e fecha no fim da historia (~104s).
      veredito: 'corrigido', inicio_s: 36, fim_s: 103, titulo: 'Achou que era famoso no mercado', gancho: 'E nao era ele',
    },
  });
  try {
    await liveRenderService.renderizar(await claimDo(clip.id));
  } finally {
    amb.desfazer();
  }
  const r = amb.chamadas.render;
  assert.ok(r, 'renderizou');
  assert.equal(r.startSeconds, 34.85, 'voltou pro COMECO da frase "deixa eu contar"');
  assert.equal(r.endSeconds, 104.9, 'fim da frase da conclusao, com respiro');
  assert.equal(r.title, 'Achou que era famoso no mercado');
  // A revisao leu a fala dividida em antes/dentro/depois do corte.
  const pedido = amb.chamadas.ia.find((p) => p.nome === 'revisao_corte');
  assert.match(pedido.usuario, /DENTRO DO CORTE:[\s\S]*mas era outro cara[\s\S]*DEPOIS DO CORTE/);
  assert.match(pedido.usuario, /ANTES DO CORTE \(fica de fora\):[\s\S]*deixa eu contar/);
  const { rows } = await pool.query('SELECT status, title, review FROM live_clips WHERE id = $1', [clip.id]);
  assert.equal(rows[0].status, 'pronto');
  assert.equal(rows[0].title, 'Achou que era famoso no mercado');
  assert.equal(rows[0].review.veredito, 'corrigido');
});

test('"Clipar agora" nunca e descartado pela revisao (alguem pediu o corte)', async () => {
  const { clip } = await cenario('clipar_agora');
  const amb = ambienteFalso({
    clipar_agora: AJUSTE,
    revisao_corte: {
      entende_sozinho: false, comeco_ok: false, fim_ok: false, nota_historia: 1, problemas: 'sem sentido',
      veredito: 'descartar', inicio_s: 50, fim_s: 80, titulo: 'Titulo revisado', gancho: 'y',
    },
  });
  try {
    await liveRenderService.renderizar(await claimDo(clip.id));
  } finally {
    amb.desfazer();
  }
  assert.ok(amb.chamadas.render, 'renderizou mesmo assim');
  const { rows } = await pool.query('SELECT status FROM live_clips WHERE id = $1', [clip.id]);
  assert.equal(rows[0].status, 'pronto');
});

test('revisao fora do ar nao segura o corte: sai com o ajuste fino', async () => {
  const { clip } = await cenario();
  const amb = ambienteFalso({ ajuste_fino: AJUSTE });
  const original = openaiLives.pedirJson;
  openaiLives.pedirJson = async (p) => {
    if (p.nome === 'revisao_corte') throw new Error('OpenAI fora do ar');
    return original(p);
  };
  try {
    await liveRenderService.renderizar(await claimDo(clip.id));
  } finally {
    openaiLives.pedirJson = original;
    amb.desfazer();
  }
  assert.ok(amb.chamadas.render);
  assert.equal(amb.chamadas.render.title, 'Ajuste');
});

test('historia ganha mais margem antes do trecho (achar o comeco) e ate 150s; piada fica em 90s', () => {
  assert.equal(liveRenderService.margemAntes('historia'), 45);
  assert.equal(liveRenderService.margemAntes('piada'), 15);
  assert.equal(tiposDeMomento.duracaoMaxDoTipo('historia'), 150);
  assert.equal(tiposDeMomento.duracaoMaxDoTipo('piada'), 90);
  assert.equal(tiposDeMomento.categoriaDoTipo('ostentacao'), 'dinheiro');
  assert.equal(tiposDeMomento.categoriaDoTipo(null), 'outros');
  assert.equal(tiposDeMomento.aceitaTipo(null, 'piada'), true);
  assert.equal(tiposDeMomento.aceitaTipo(['tretas'], 'briga'), true);
  assert.equal(tiposDeMomento.aceitaTipo(['tretas'], 'piada'), false);
  // Todo tipo cai em alguma categoria escolhivel.
  for (const t of tiposDeMomento.TIPOS) assert.ok(tiposDeMomento.IDS_CATEGORIAS.includes(tiposDeMomento.categoriaDoTipo(t)), t);
});
