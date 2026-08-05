// Desconectar uma conta do TikTok tem que revogar de verdade.
//
// Antes, "Desconectar" só marcava is_active = false no nosso banco. Os tokens
// continuavam guardados e a autorização continuava concedida do lado da TikTok.
// Isso aparecia de duas formas:
//
//   - a Política de Privacidade promete, com estas palavras, "ao desconectar,
//     apagamos os tokens de acesso";
//   - reconectar depois pulava a tela de permissões, porque a TikTok trata como
//     reautorização silenciosa. O usuário descobriu isso tentando gravar a
//     demonstração do app PRA PRÓPRIA TIKTOK, onde essa tela é o que o revisor
//     mais precisa ver.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const pool = require('../../src/db/pool');
const tiktokAccountsRepository = require('../../src/repositories/tiktokAccountsRepository');
const { createClient } = require('../helpers/db');

test.after(async () => {
  await pool.end();
});

async function contaConectada(clienteId) {
  const { rows } = await pool.query(
    `INSERT INTO tiktok_accounts (client_user_id, tiktok_open_id, display_name, is_active,
       access_token_encrypted, access_token_iv, refresh_token_encrypted, refresh_token_iv,
       scopes, token_expires_at, connected_at)
     VALUES ($1, $2, 'conta', true, 'tok','iv','ref','iv',
       ARRAY['video.publish'], now() + interval '30 days', now())
     RETURNING *`,
    [clienteId, `open-${Date.now()}-${Math.random()}`]
  );
  return rows[0];
}

test('desconectar apaga os tokens do banco', async () => {
  const cliente = await createClient();
  const conta = await contaConectada(cliente.id);

  await tiktokAccountsRepository.deactivate(conta.id, cliente.id);

  const { rows } = await pool.query('SELECT * FROM tiktok_accounts WHERE id = $1', [conta.id]);
  assert.equal(rows[0].is_active, false);
  assert.equal(rows[0].access_token_encrypted, null, 'o token de acesso continuou guardado');
  assert.equal(rows[0].refresh_token_encrypted, null, 'o token de renovação continuou guardado');
});

test('o banco recusa conta ATIVA sem token', async () => {
  // A regra real não é "a coluna nunca é nula", é "conta ativa precisa de
  // credencial". Antes isso era um NOT NULL, que impedia até a desconexão
  // limpar o token.
  const cliente = await createClient();
  const conta = await contaConectada(cliente.id);

  await assert.rejects(
    () => pool.query('UPDATE tiktok_accounts SET access_token_encrypted = NULL WHERE id = $1', [conta.id]),
    (err) => err.constraint === 'ck_tiktok_ativa_tem_token'
  );
});

test('desconectar solta os canais que apontavam pra essa conta', async () => {
  // Sem isso, o canal continuaria vinculado a uma conta que não existe mais e o
  // job de publicação tentaria postar num lugar sem credencial.
  const cliente = await createClient();
  const conta = await contaConectada(cliente.id);

  const { rows: [canal] } = await pool.query(
    `INSERT INTO youtube_channels (client_user_id, youtube_channel_id, channel_url, channel_name, tiktok_account_id)
     VALUES ($1, $3, 'https://youtube.com/@x', 'canal', $2) RETURNING *`,
    [cliente.id, conta.id, `UC${Date.now()}${Math.floor(Math.random() * 1000)}`]
  );

  await tiktokAccountsRepository.deactivate(conta.id, cliente.id);

  const { rows } = await pool.query('SELECT tiktok_account_id FROM youtube_channels WHERE id = $1', [canal.id]);
  assert.equal(rows[0].tiktok_account_id, null);
});

test('o serviço tem como revogar o acesso na TikTok', async () => {
  // O teste não chama a TikTok de verdade; confere que a função existe e que
  // manda o token no corpo. Sem ela, desconectar volta a ser só uma flag local.
  const tiktokService = require('../../src/services/tiktokService');
  assert.equal(typeof tiktokService.revokeAccess, 'function');

  const fetchOriginal = global.fetch;
  let recebido = null;
  global.fetch = async (url, opcoes) => {
    recebido = { url, body: opcoes.body };
    return { ok: true, json: async () => ({}) };
  };
  try {
    await tiktokService.revokeAccess('token-de-teste');
  } finally {
    global.fetch = fetchOriginal;
  }

  assert.match(recebido.url, /oauth\/revoke/);
  assert.match(recebido.body, /token=token-de-teste/);
});
