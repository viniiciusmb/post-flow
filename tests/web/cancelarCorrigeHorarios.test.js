// Cancelar uma postagem conserta o horário das outras.
//
// Cancelar deixava um buraco no meio da fila: os cortes seguintes continuavam
// marcados para os horários de depois do que saiu, e o horário vago ficava sem
// dono. Na prática, o cliente cancelava o primeiro da fila e o próximo, que
// podia sair às 8h, só saía às 12h — sem nada na tela explicando por quê.
//
// A conta já existia (é a mesma do botão "Corrigir horários de posts"); o que
// faltava era ela rodar sozinha. Ninguém descobre que precisa clicar num botão
// depois de cancelar.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const pool = require('../../src/db/pool');
const { startServer, stopServer, createLoginableClient, createAgent } = require('../helpers/http');

test.after(async () => {
  await stopServer();
  await pool.end();
});

let seq = 0;
const unico = () => `${Date.now()}${seq++}`;

async function contaComFila(clienteId, quantos) {
  const { rows: [conta] } = await pool.query(
    `INSERT INTO tiktok_accounts (client_user_id, tiktok_open_id, display_name, is_active,
       access_token_encrypted, access_token_iv, refresh_token_encrypted, refresh_token_iv,
       scopes, token_expires_at, connected_at, auto_post_enabled)
     VALUES ($1, $2, 'conta', true, 'x','x','x','x', ARRAY['video.publish'],
       now() + interval '30 days', now(), true)
     RETURNING *`,
    [clienteId, `open-${unico()}`]
  );
  // Horários fixos e bem separados: o que importa aqui é o REMANEJAMENTO, e
  // com slots próximos demais a diferença some no arredondamento.
  await pool.query(
    `INSERT INTO posting_schedule_settings (tiktok_account_id, mode, videos_per_day, manual_times, timezone)
     VALUES ($1, 'manual', 4, ARRAY['08:00','12:00','16:00','20:00'], 'America/Sao_Paulo')`,
    [conta.id]
  );

  const { rows: [video] } = await pool.query(
    `INSERT INTO source_videos (youtube_video_id, title, status, input_type, owner_client_user_id, client_user_id)
     VALUES ($1, 'video', 'ready', 'upload', $2, $2) RETURNING *`,
    [`v${unico()}`, clienteId]
  );

  const postagens = [];
  for (let i = 0; i < quantos; i++) {
    const { rows: [clip] } = await pool.query(
      `INSERT INTO clips (source_video_id, start_seconds, end_seconds, status, title)
       VALUES ($1, $2, $3, 'ready', $4) RETURNING *`,
      [video.id, i * 30, i * 30 + 30, `Corte ${i + 1}`]
    );
    const { rows: [v] } = await pool.query(
      `INSERT INTO videos (source_type, clip_id, filename, mime_type)
       VALUES ('youtube_clip', $1, 'c.mp4', 'video/mp4') RETURNING *`,
      [clip.id]
    );
    const { rows: [posting] } = await pool.query(
      `INSERT INTO postings (video_id, tiktok_account_id, status, scheduled_for)
       VALUES ($1, $2, 'pending', now() + ($3 || ' hours')::interval) RETURNING *`,
      [v.id, conta.id, String(i + 1)]
    );
    postagens.push(posting);
  }
  return { conta, postagens };
}

async function horariosDa(contaId) {
  const { rows } = await pool.query(
    `SELECT id, status, scheduled_for FROM postings WHERE tiktok_account_id = $1 ORDER BY id`,
    [contaId]
  );
  return rows;
}

async function clienteLogado() {
  const url = await startServer();
  const user = await createLoginableClient();
  const agente = createAgent(url);
  await agente.login(user.email, user.password);
  return { user, agente };
}

test('cancelar o primeiro da fila puxa os outros para os horários que vagaram', async () => {
  const { user, agente } = await clienteLogado();
  const { conta, postagens } = await contaComFila(user.id, 4);
  const antes = await horariosDa(conta.id);

  const r = await agente.post(`/api/client/postings/${postagens[0].id}/skip`, {});
  assert.equal(r.status, 204);

  const depois = await horariosDa(conta.id);
  const porId = new Map(depois.map((p) => [String(p.id), p]));

  assert.equal(porId.get(String(postagens[0].id)).status, 'skipped');

  // Os três que sobraram foram remarcados - nenhum pode ter ficado com o
  // horário antigo, que era o de depois do cancelado.
  const sobraram = postagens.slice(1);
  const mudou = sobraram.filter((p) => {
    const a = antes.find((x) => String(x.id) === String(p.id));
    const d = porId.get(String(p.id));
    return new Date(a.scheduled_for).getTime() !== new Date(d.scheduled_for).getTime();
  });
  assert.equal(mudou.length, sobraram.length, 'todos os pendentes precisam ser remarcados');

  // E continuam em ordem crescente: a fila não pode embaralhar.
  const horarios = sobraram.map((p) => new Date(porId.get(String(p.id)).scheduled_for).getTime());
  for (let i = 1; i < horarios.length; i++) {
    assert.ok(horarios[i] > horarios[i - 1], 'a fila saiu fora de ordem depois do cancelamento');
  }
});

test('a postagem cancelada não ganha horário novo', async () => {
  // Ela saiu da fila: remarcá-la seria dar a entender que ainda vai sair.
  const { user, agente } = await clienteLogado();
  const { conta, postagens } = await contaComFila(user.id, 3);
  const antesDoCancelado = (await horariosDa(conta.id)).find((p) => String(p.id) === String(postagens[1].id));

  await agente.post(`/api/client/postings/${postagens[1].id}/skip`, {});

  const depois = (await horariosDa(conta.id)).find((p) => String(p.id) === String(postagens[1].id));
  assert.equal(depois.status, 'skipped');
  assert.equal(
    new Date(depois.scheduled_for).getTime(),
    new Date(antesDoCancelado.scheduled_for).getTime()
  );
});

test('cancelar numa conta não mexe na fila de outra', async () => {
  const { user, agente } = await clienteLogado();
  const a = await contaComFila(user.id, 3);
  const b = await contaComFila(user.id, 3);
  const antesDeB = await horariosDa(b.conta.id);

  await agente.post(`/api/client/postings/${a.postagens[0].id}/skip`, {});

  const depoisDeB = await horariosDa(b.conta.id);
  assert.deepEqual(
    depoisDeB.map((p) => new Date(p.scheduled_for).getTime()),
    antesDeB.map((p) => new Date(p.scheduled_for).getTime())
  );
});

test('postagem de outro cliente não pode ser cancelada', async () => {
  const { agente } = await clienteLogado();
  const outro = await createLoginableClient();
  const alheia = await contaComFila(outro.id, 2);

  const r = await agente.post(`/api/client/postings/${alheia.postagens[0].id}/skip`, {});

  assert.equal(r.status, 404);
  const depois = await horariosDa(alheia.conta.id);
  assert.ok(depois.every((p) => p.status === 'pending'));
});
