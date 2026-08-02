// Estilo de corte por canal.
//
// A mesma tabela guarda dois casos: a linha com youtube_channel_id NULL é a
// configuração "de todos os canais", e cada linha com canal é a exceção
// daquele canal. Quem erra aqui erra caro: ou o cliente edita um canal e muda
// todos sem querer, ou muda todos e nada acontece.
//
// A unicidade é feita por dois índices PARCIAIS (migration 047), porque no
// Postgres dois NULLs são distintos e um UNIQUE composto deixaria o cliente
// criar várias linhas "padrão". Índice parcial quebra `ON CONFLICT (coluna)`
// silenciosamente, então o teste de idempotência abaixo é o que garante que o
// upsert continua achando o índice certo.
'use strict';

const test = require('node:test');
const assert = require('node:assert');

const repo = require('../../src/repositories/clientVideoSettingsRepository');
const { pool, createClient, createYoutubeChannel, closePool } = require('../helpers/db');

test.after(() => closePool());

const BASE = {
  aspectRatio: '9:16',
  framing: 'crop',
  quality: 'high',
  captionStyle: 'classic',
  clipLength: 'balanced',
  clipMode: 'ai_choice',
  maxClips: 4,
  showTitle: true,
  titleSeconds: 3,
  descriptionMode: 'auto',
  descriptionTemplate: null,
  cropStyleMode: 'auto',
  cropZoomPercent: 100,
  showPartLabel: false,
  partLabelPosition: 'top_right',
  titleStyle: 'classic',
};

test('canal sem estilo próprio segue a configuração de todos os canais', async () => {
  const cliente = await createClient();
  const canal = await createYoutubeChannel(cliente.id);

  await repo.upsert(cliente.id, { ...BASE, captionStyle: 'bold' });

  const resolvido = await repo.resolveForVideo(cliente.id, canal.id);
  assert.strictEqual(resolvido.caption_style, 'bold', 'deveria herdar o padrão do cliente');
});

test('canal com estilo próprio ignora a configuração de todos os canais', async () => {
  const cliente = await createClient();
  const comEstilo = await createYoutubeChannel(cliente.id, { name: 'Tem estilo' });
  const semEstilo = await createYoutubeChannel(cliente.id, { name: 'Sem estilo' });

  await repo.upsert(cliente.id, { ...BASE, captionStyle: 'bold' });
  await repo.upsert(cliente.id, { ...BASE, captionStyle: 'minimal', cropZoomPercent: 40 }, comEstilo.id);

  const doCanal = await repo.resolveForVideo(cliente.id, comEstilo.id);
  const doOutro = await repo.resolveForVideo(cliente.id, semEstilo.id);

  assert.strictEqual(doCanal.caption_style, 'minimal');
  assert.strictEqual(Number(doCanal.crop_zoom_percent), 40);
  assert.strictEqual(doOutro.caption_style, 'bold', 'o outro canal não pode ser afetado');
});

test('vídeo sem canal (upload ou link avulso) usa a configuração de todos os canais', async () => {
  const cliente = await createClient();
  const canal = await createYoutubeChannel(cliente.id);

  await repo.upsert(cliente.id, { ...BASE, captionStyle: 'bold' });
  await repo.upsert(cliente.id, { ...BASE, captionStyle: 'minimal' }, canal.id);

  const avulso = await repo.resolveForVideo(cliente.id, null);
  assert.strictEqual(avulso.caption_style, 'bold');
});

test('salvar a configuração de todos os canais duas vezes não cria linha duplicada', async () => {
  // Se o ON CONFLICT deixar de casar com o índice parcial, isto vira erro de
  // constraint ou uma segunda linha "padrão", e o cliente passa a ver
  // configuração fantasma dependendo de qual linha a consulta pegar primeiro.
  const cliente = await createClient();

  await repo.upsert(cliente.id, { ...BASE, captionStyle: 'bold' });
  await repo.upsert(cliente.id, { ...BASE, captionStyle: 'minimal' });

  const { rows } = await pool.query(
    'SELECT count(*)::int AS total FROM client_video_settings WHERE client_user_id = $1 AND youtube_channel_id IS NULL',
    [cliente.id]
  );
  assert.strictEqual(rows[0].total, 1);
  const padrao = await repo.findByClientId(cliente.id);
  assert.strictEqual(padrao.caption_style, 'minimal', 'a segunda gravação tem que ter sobrescrito a primeira');
});

test('salvar o estilo do mesmo canal duas vezes não cria linha duplicada', async () => {
  const cliente = await createClient();
  const canal = await createYoutubeChannel(cliente.id);

  await repo.upsert(cliente.id, { ...BASE, captionStyle: 'bold' }, canal.id);
  await repo.upsert(cliente.id, { ...BASE, captionStyle: 'minimal' }, canal.id);

  const { rows } = await pool.query(
    'SELECT count(*)::int AS total FROM client_video_settings WHERE client_user_id = $1 AND youtube_channel_id = $2',
    [cliente.id, canal.id]
  );
  assert.strictEqual(rows[0].total, 1);
});

test('apagar o estilo do canal faz ele voltar a seguir todos os canais', async () => {
  const cliente = await createClient();
  const canal = await createYoutubeChannel(cliente.id);

  await repo.upsert(cliente.id, { ...BASE, captionStyle: 'bold' });
  await repo.upsert(cliente.id, { ...BASE, captionStyle: 'minimal' }, canal.id);
  assert.strictEqual((await repo.resolveForVideo(cliente.id, canal.id)).caption_style, 'minimal');

  await repo.removeChannelOverride(cliente.id, canal.id);

  assert.strictEqual((await repo.resolveForVideo(cliente.id, canal.id)).caption_style, 'bold');
  assert.strictEqual(await repo.findChannelOverride(cliente.id, canal.id), null);
});

test('o estilo de um cliente nunca vaza pro canal de outro', async () => {
  const dono = await createClient();
  const outro = await createClient();
  const canalDoOutro = await createYoutubeChannel(outro.id);

  await repo.upsert(dono.id, { ...BASE, captionStyle: 'bold' });

  // Pedir o canal alheio pelo id do dono não pode devolver exceção nenhuma.
  assert.strictEqual(await repo.findChannelOverride(dono.id, canalDoOutro.id), null);
});

test('apagar o canal leva junto o estilo dele', async () => {
  // ON DELETE CASCADE na migration. Sem isso ficaria linha órfã apontando pra
  // canal que não existe mais.
  const cliente = await createClient();
  const canal = await createYoutubeChannel(cliente.id);
  await repo.upsert(cliente.id, { ...BASE, captionStyle: 'minimal' }, canal.id);

  await pool.query('DELETE FROM youtube_channels WHERE id = $1', [canal.id]);

  const { rows } = await pool.query(
    'SELECT count(*)::int AS total FROM client_video_settings WHERE youtube_channel_id = $1',
    [canal.id]
  );
  assert.strictEqual(rows[0].total, 0);
});
