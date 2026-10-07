// Cortes de live apagados 3 dias depois de prontos, e os modelos novos de
// legenda (07/10/2026).
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const pool = require('../../src/db/pool');
const livesRepository = require('../../src/repositories/livesRepository');
const liveCleanupService = require('../../src/services/lives/liveCleanupService');
const videoEditingService = require('../../src/services/videoEditingService');
const { RETENCAO_CORTE_LIVE_HORAS } = require('../../src/config/constants');
const { createLoginableClient } = require('../helpers/http');

test.after(async () => {
  await pool.end();
});

test('o prazo e 3 dias', () => {
  assert.equal(RETENCAO_CORTE_LIVE_HORAS, 72);
});

test('apaga arquivo, capa e linha do corte pronto ha mais de 3 dias; o recente e o que esta renderizando ficam', async () => {
  const u = await createLoginableClient();
  const canal = await livesRepository.upsertChannel({ login: `ret_${Date.now().toString(36)}`, displayName: 'R', platformUserId: '1', profileImageUrl: null });
  const sessao = await livesRepository.createSession({ channelId: canal.id, dirPath: '/tmp' });
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'ret-'));
  async function corte({ status, horasAtras }) {
    const arq = path.join(pasta, `${status}-${horasAtras}.mp4`);
    const capa = arq.replace('.mp4', '.jpg');
    fs.writeFileSync(arq, 'x');
    fs.writeFileSync(capa, 'x');
    const { rows } = await pool.query(
      `INSERT INTO live_clips (session_id, live_channel_id, user_id, source, start_offset, end_offset, status, local_clip_path, thumbnail_path, created_at, ready_at)
       VALUES ($1, $2, $3, 'triagem', 0, 30, $4, $5, $6, now() - make_interval(hours => $7), CASE WHEN $4 = 'pronto' THEN now() - make_interval(hours => $7) END)
       RETURNING id`,
      [sessao.id, canal.id, u.id, status, arq, capa, horasAtras]
    );
    return { id: Number(rows[0].id), arq, capa };
  }
  const velho = await corte({ status: 'pronto', horasAtras: 73 });
  const novo = await corte({ status: 'pronto', horasAtras: 71 });
  const renderizando = await corte({ status: 'renderizando', horasAtras: 100 });

  await liveCleanupService.apagarCortesVencidos();

  const ids = (await pool.query('SELECT id FROM live_clips WHERE user_id = $1', [u.id])).rows.map((r) => Number(r.id));
  assert.ok(!ids.includes(velho.id), 'o de 73h devia ter sido apagado');
  assert.ok(!fs.existsSync(velho.arq) && !fs.existsSync(velho.capa), 'arquivo e capa do velho tambem');
  assert.ok(ids.includes(novo.id) && fs.existsSync(novo.arq), 'o de 71h fica');
  assert.ok(ids.includes(renderizando.id), 'corte renderizando nunca e apagado no meio');
});

test('modelos novos de legenda: no render, no CHECK do banco, com brilho e maiusculas por palavra', () => {
  const novos = ['simples', 'sombra_dura', 'amarelo_fino', 'preto_borda_branca', 'caixa_alta', 'maiusculo_amarelo', 'gigante', 'verde_contorno', 'rosa_contorno', 'azul_contorno', 'laranja_contorno', 'brilho_rosa', 'brilho_azul', 'brilho_verde', 'roxo_caixa', 'verde_caixa'];
  const migration = fs.readFileSync(path.join(__dirname, '..', '..', 'migrations', '103_legendas_novas.sql'), 'utf8');
  for (const m of Object.keys(videoEditingService.CAPTION_STYLES)) assert.ok(migration.includes(`'${m}'`), `${m} fora do CHECK do banco`);
  for (const m of novos) assert.ok(videoEditingService.CAPTION_STYLES[m], `falta ${m}`);
  const ass = (estilo) => videoEditingService.buildAssSubtitles([{ word: 'olha', start: 0, end: 1 }], estilo, 'classic', null, 0, null, null, 5, {});
  assert.match(ass('brilho_verde'), /Default,,0,0,0,,\{\\blur8\}olha/);
  assert.match(ass('gigante'), /Default,,0,0,0,,OLHA/);
  assert.match(ass('classic'), /Default,,0,0,0,,olha/);
});
