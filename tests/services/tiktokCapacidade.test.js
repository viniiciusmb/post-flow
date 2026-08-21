// O teto de CRIADORES ATIVOS do app no TikTok.
//
// É o limite que trava o crescimento, e o mais perigoso que existe nesta
// integração: não aparece na API nem no painel do TikTok, e só se descobre
// que bateu quando as publicações começam a ser recusadas — ou seja, quando os
// clientes já estão parados. Como o pedido de aumento leva dias, quem espera o
// sintoma fica esses dias sem publicar.
//
// O que estes testes travam:
//   - o alerta dispara ANTES do teto (a 70%), não em cima dele;
//   - quem manda no risco é o número de contas CONECTADAS (o que pode
//     acontecer amanhã), não quantas publicaram ontem;
//   - "já pedi o aumento" silencia por um tempo, nunca para sempre;
//   - informar o teto real muda o ponto de disparo.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const pool = require('../../src/db/pool');
const settingsRepository = require('../../src/repositories/settingsRepository');
const capacidade = require('../../src/services/tiktokCapacityService');
const { createClient } = require('../helpers/db');

test.after(async () => {
  await pool.end();
});

let n = 0;

// Zera o cenário: as contagens são globais (é o teto do APLICATIVO, não de um
// cliente), então cada teste precisa partir do mesmo ponto.
async function cenario({ contas, limite }) {
  await pool.query('DELETE FROM postings');
  await pool.query('DELETE FROM tiktok_accounts');
  await settingsRepository.setValue(capacidade.CHAVES.limite, limite);
  await settingsRepository.setValue(capacidade.CHAVES.dispensadoAte, null);

  const cliente = await createClient();
  for (let i = 0; i < contas; i += 1) {
    n += 1;
    await pool.query(
      `INSERT INTO tiktok_accounts (client_user_id, tiktok_open_id, display_name, is_active,
         access_token_encrypted, access_token_iv, refresh_token_encrypted, refresh_token_iv,
         scopes, token_expires_at, connected_at)
       VALUES ($1, $2, 'Conta', true, 'x','x','x','x', ARRAY['video.publish'], now() + interval '30 days', now())`,
      [cliente.id, `open_cap_${n}_${Date.now()}`]
    );
  }
}

test('longe do teto: nenhum aviso', async () => {
  await cenario({ contas: 10, limite: 50 });
  const r = await capacidade.avaliar();
  assert.equal(r.contas_conectadas, 10);
  assert.equal(r.percentual, 20);
  assert.equal(r.alertar, false);
});

test('a 70% do teto o aviso dispara - antes de estourar, não em cima', async () => {
  await cenario({ contas: 35, limite: 50 });
  const r = await capacidade.avaliar();
  assert.equal(r.percentual, 70);
  assert.equal(r.alertar, true, 'com 35 de 50 já tem que avisar - o aumento demora dias');
});

test('quem decide o risco é quem PODE publicar, não quem publicou', async () => {
  // 40 contas conectadas e ninguém publicou ainda. O risco é real: nada impede
  // as 40 de publicarem amanhã. Esperar o uso aparecer seria avisar tarde.
  await cenario({ contas: 40, limite: 50 });
  const r = await capacidade.avaliar();
  assert.equal(r.criadores_ativos_24h, 0);
  assert.equal(r.alertar, true);
});

test('informar o teto real move o ponto de disparo', async () => {
  await cenario({ contas: 35, limite: 50 });
  assert.equal((await capacidade.avaliar()).alertar, true);

  // O TikTok concedeu 200: os mesmos 35 deixam de ser motivo de alarme.
  await capacidade.definirLimite(200);
  const r = await capacidade.avaliar();
  assert.equal(r.limite, 200);
  assert.equal(r.alertar, false);
  assert.equal(r.limiteConfirmado, true);
});

test('"já pedi o aumento" silencia por um tempo, não para sempre', async () => {
  await cenario({ contas: 40, limite: 50 });
  assert.equal((await capacidade.avaliar()).alertar, true);

  await capacidade.adiarAviso(14);
  assert.equal((await capacidade.avaliar()).alertar, false, 'deve silenciar depois do pedido');

  // Prazo vencido: volta a avisar. Pedido pode ter sido recusado, e um aviso
  // silenciado para sempre é o mesmo que não existir.
  await settingsRepository.setValue(
    capacidade.CHAVES.dispensadoAte,
    new Date(Date.now() - 86400000).toISOString()
  );
  assert.equal((await capacidade.avaliar()).alertar, true, 'passado o prazo, o aviso tem que voltar');
});

test('teto inválido é recusado em vez de virar um número sem sentido', async () => {
  assert.equal(await capacidade.definirLimite(0), null);
  assert.equal(await capacidade.definirLimite(-5), null);
  assert.equal(await capacidade.definirLimite('abc'), null);
  assert.equal(await capacidade.definirLimite(1.5), null);
  assert.equal(await capacidade.definirLimite(80), 80);
});
