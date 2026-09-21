// Enviar vídeo avulso tendo 2+ contas do TikTok e sem marcar nenhuma.
//
// A resposta certa é um 400 com "escolha pelo menos uma conta". Em produção,
// em 17/09/2026, isso virava um 500 genérico duas vezes seguidas: a função
// que valida as contas usava `res` sem recebê-lo, e o cliente ficou sem saber
// o que tinha feito de errado.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const pool = require('../../src/db/pool');
const { startServer, stopServer, createLoginableClient, createAgent } = require('../helpers/http');

let baseUrl;

test.before(async () => {
  baseUrl = await startServer();
});

test.after(async () => {
  await stopServer();
  await pool.end();
});

async function contaDoTiktok(clientUserId) {
  const { rows } = await pool.query(
    `INSERT INTO tiktok_accounts (client_user_id, tiktok_open_id, display_name, access_token_encrypted,
                                  refresh_token_encrypted, token_expires_at, scopes, is_active, auto_post_enabled)
     VALUES ($1, $2, 'Conta de teste', 'x', 'y', now() + interval '1 day', '{}', true, true)
     RETURNING *`,
    [clientUserId, `open_${process.pid}_${Math.random().toString(36).slice(2, 10)}`]
  );
  return rows[0];
}

for (const [rota, nome] of [
  ['/api/client/source-videos/manual', 'link colado'],
]) {
  test(`${nome} com 2 contas e nenhuma marcada: pede pra escolher, sem erro de servidor`, async () => {
    const cliente = await createLoginableClient();
    await contaDoTiktok(cliente.id);
    await contaDoTiktok(cliente.id);

    const agent = createAgent(baseUrl);
    await agent.login(cliente.email, cliente.password);

    const r = await agent.post(rota, { url: 'https://www.youtube.com/watch?v=aBcDeFgHiJk' });
    assert.equal(r.status, 400, `esperava 400, veio ${r.status}: ${r.text}`);
    assert.match(r.body.error, /conta/i, 'a mensagem tem que dizer o que falta: escolher a conta');

    const { rows } = await pool.query('SELECT count(*)::int AS n FROM source_videos WHERE client_user_id = $1', [
      cliente.id,
    ]);
    assert.equal(rows[0].n, 0, 'nada pode ser cadastrado enquanto o destino não foi escolhido');
  });
}
