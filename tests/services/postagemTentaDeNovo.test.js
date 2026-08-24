// Uma piscada de rede não pode aposentar um corte.
//
// Em 24/08/2026 uma publicação falhou com "fetch failed" — erro de transporte,
// nada a ver com o conteúdo — e o corte foi direto pra aba de erros, de onde
// só sairia se alguém clicasse. Se ninguém olhasse, ele nunca seria postado.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const erroDePostagem = require('../../src/lib/erroDePostagem');
const postingsRepository = require('../../src/repositories/postingsRepository');
const videosRepository = require('../../src/repositories/videosRepository');
const pool = require('../../src/db/pool');
const { createClient } = require('../helpers/db');

test.after(async () => {
  await pool.end();
});

// --- Classificação ---

test('erro de rede é passageiro: tenta de novo', () => {
  const passageiros = [
    new Error('fetch failed'),
    new Error('read ECONNRESET'),
    new Error('connect ETIMEDOUT 1.2.3.4:443'),
    new Error('socket hang up'),
    new Error('This operation was aborted'),
    new Error('getaddrinfo EAI_AGAIN open.tiktokapis.com'),
    new Error('http_503 ao falar com a TikTok'),
    new Error('TikTok recusou [rate_limit_exceeded]: too many requests'),
  ];
  for (const err of passageiros) {
    assert.equal(erroDePostagem.classificar(err), 'transitorio', `"${err.message}" devia ser passageiro`);
    assert.equal(erroDePostagem.deveTentarDeNovo(err, 0), true);
  }
});

test('erro do conteúdo ou da configuração NÃO fica tentando à toa', () => {
  // Repetir daria exatamente o mesmo resultado - tem que aparecer pro admin.
  const definitivos = [
    new Error('TikTok recusou publicar no perfil [invalid_params]: The chunk size is invalid'),
    new Error('TikTok recusou [unaudited_client_can_only_post_to_private_accounts]: ...'),
    new Error('TikTok recusou [scope_not_authorized]: falta permissão'),
    new Error('TikTok recusou [spam_risk_too_many_posts]: ...'),
    new Error('Arquivo do corte nao esta mais em disco.'),
  ];
  for (const err of definitivos) {
    assert.equal(erroDePostagem.classificar(err), 'permanente', `"${err.message}" não devia ser repetido`);
    assert.equal(erroDePostagem.deveTentarDeNovo(err, 0), false);
  }
});

test('erro desconhecido tenta de novo, em vez de desistir na primeira', () => {
  // Errar pra este lado custa algumas horas até aparecer na aba de erros;
  // errar pro outro joga fora um corte que teria publicado na 2ª tentativa.
  const err = new Error('alguma coisa que a gente nunca viu');
  assert.equal(erroDePostagem.classificar(err), 'transitorio');
  assert.equal(erroDePostagem.deveTentarDeNovo(err, 0), true);
});

test('tentar de novo tem fim: não gira pra sempre', () => {
  const err = new Error('fetch failed');
  assert.equal(erroDePostagem.deveTentarDeNovo(err, erroDePostagem.MAX_TENTATIVAS - 1), true);
  assert.equal(erroDePostagem.deveTentarDeNovo(err, erroDePostagem.MAX_TENTATIVAS), false);
  assert.equal(erroDePostagem.deveTentarDeNovo(err, 99), false);
});

test('a espera entre tentativas cresce', () => {
  // Martelar de minuto em minuto quando a TikTok está fora do ar só piora.
  const esperas = [0, 1, 2, 3, 4].map((n) => erroDePostagem.esperaEmMinutos(n));
  for (let i = 1; i < esperas.length; i++) {
    assert.ok(esperas[i] > esperas[i - 1], `espera ${i} (${esperas[i]}) não é maior que a anterior`);
  }
  assert.ok(esperas[0] <= 10, 'a primeira tentativa tem que ser rápida: a maioria das falhas de rede passa em segundos');
});

// --- Efeito no banco ---

let seq = 0;
const unico = () => `${Date.now()}${seq++}`;

async function postagemDeTeste() {
  const cliente = await createClient();
  const { rows: [conta] } = await pool.query(
    `INSERT INTO tiktok_accounts (client_user_id, tiktok_open_id, display_name, is_active,
       access_token_encrypted, access_token_iv, refresh_token_encrypted, refresh_token_iv,
       scopes, token_expires_at, connected_at, auto_post_enabled)
     VALUES ($1,$2,'conta',true,'x','x','x','x',ARRAY['video.publish'],
       now() + interval '30 days', now(), true) RETURNING *`,
    [cliente.id, `open-${unico()}`]
  );
  const { rows: [sv] } = await pool.query(
    `INSERT INTO source_videos (youtube_video_id, title, status, input_type, owner_client_user_id, client_user_id)
     VALUES ($1,'v','ready','upload',$2,$2) RETURNING *`, [`v${unico()}`, cliente.id]
  );
  const { rows: [clip] } = await pool.query(
    `INSERT INTO clips (source_video_id, start_seconds, end_seconds, status, title)
     VALUES ($1,0,60,'ready','corte') RETURNING *`, [sv.id]
  );
  const video = await videosRepository.createFromClip({ clipId: clip.id, filename: 'c.mp4', fileSizeBytes: 1000 });
  const posting = await postingsRepository.createIfNotExists({ videoId: video.id, tiktokAccountId: conta.id });
  return { conta, posting };
}

test('nova tentativa devolve o corte pra FILA, não pra aba de erros', async () => {
  const { conta, posting } = await postagemDeTeste();
  await pool.query("UPDATE postings SET status='queued', queued_at=now() WHERE id=$1", [posting.id]);

  const depois = await postingsRepository.agendarNovaTentativa(posting.id, 5);

  assert.equal(depois.status, 'pending', 'o corte tinha que voltar pra fila');
  assert.equal(Number(depois.attempts), 1, 'a tentativa não foi contada');
  assert.ok(new Date(depois.scheduled_for) > new Date(), 'a nova tentativa foi marcada pro passado');

  // E não pode aparecer na aba de erros do cliente.
  const emErro = await postingsRepository.listErrorForClient(conta.client_user_id);
  assert.equal(emErro.length, 0, 'o corte apareceu como erro mesmo indo tentar de novo');
});

test('tentativa que falhou não consome a cota diária do cliente', async () => {
  // "Postados hoje" conta as postagens em queued/processing/posted com
  // queued_at de hoje. Uma tentativa frustrada não pode gastar um dos 5 do dia.
  const { conta, posting } = await postagemDeTeste();
  await pool.query("UPDATE postings SET status='queued', queued_at=now() WHERE id=$1", [posting.id]);
  assert.equal(await postingsRepository.countTodayForAccount(conta.id, 'America/Sao_Paulo'), 1);

  const depois = await postingsRepository.agendarNovaTentativa(posting.id, 5);

  assert.equal(
    await postingsRepository.countTodayForAccount(conta.id, 'America/Sao_Paulo'),
    0,
    'a tentativa que falhou continuou contando como postagem do dia'
  );
  // A volta pra 'pending' já tira da contagem sozinha; limpar queued_at é o
  // que impede a marca de "entrou na fila de envio" de sobreviver a uma
  // tentativa que nunca chegou a publicar.
  assert.equal(depois.queued_at, null, 'ficou com a marca de uma tentativa que não aconteceu');
});

test('o corte reagendado só é publicado quando a nova hora chega', async () => {
  const { conta, posting } = await postagemDeTeste();
  await postingsRepository.agendarNovaTentativa(posting.id, 5);
  assert.equal(await postingsRepository.findOldestDuePendingForAccount(conta.id), null);

  await pool.query("UPDATE postings SET scheduled_for = now() - interval '1 second' WHERE id=$1", [posting.id]);
  const pronto = await postingsRepository.findOldestDuePendingForAccount(conta.id);
  assert.ok(pronto, 'passada a espera, o corte tinha que voltar a ser publicável');
});

test('depois de esgotar as tentativas, aí sim vira erro visível', async () => {
  const { conta, posting } = await postagemDeTeste();
  const final = await postingsRepository.marcarErroDefinitivo(posting.id);

  assert.equal(final.status, 'error');
  const emErro = await postingsRepository.listErrorForClient(conta.client_user_id);
  assert.equal(emErro.length, 1, 'o cliente precisa conseguir ver o corte que não foi');
});

// --- Blindagem da própria chamada de rede ---
//
// Antes da recuperação acima entrar em cena, a chamada em si já tenta de novo:
// o ideal é que uma piscada de rede nem chegue a virar falha de publicação.

const tiktokService = require('../../src/services/tiktokService');

test('uma falha de rede no meio do envio não derruba a publicação', async () => {
  const fetchOriginal = global.fetch;
  let chamadas = 0;
  global.fetch = async () => {
    chamadas += 1;
    if (chamadas === 1) throw new TypeError('fetch failed');
    return { ok: true, status: 200, json: async () => ({ error: { code: 'ok' }, data: { publish_id: 'p1', upload_url: 'u' } }) };
  };
  try {
    const r = await tiktokService.initDirectPost('token', 1000, {
      caption: 'x', privacyLevel: 'PUBLIC_TO_EVERYONE',
      disableComment: false, disableDuet: false, disableStitch: false,
      brandContentToggle: false, brandOrganicToggle: false,
    });
    assert.equal(r.publishId, 'p1', 'a segunda tentativa tinha que ter valido');
    assert.equal(chamadas, 2, 'não tentou de novo depois da falha de rede');
  } finally {
    global.fetch = fetchOriginal;
  }
});

test('recusa por parâmetro inválido NÃO é repetida', async () => {
  // Repetir daria o mesmo "não" e só atrasaria o erro chegar ao admin.
  const fetchOriginal = global.fetch;
  let chamadas = 0;
  global.fetch = async () => {
    chamadas += 1;
    return {
      ok: false, status: 400,
      json: async () => ({ error: { code: 'invalid_params', message: 'The chunk size is invalid' } }),
    };
  };
  try {
    await assert.rejects(
      () => tiktokService.initDirectPost('token', 1000, {
        caption: 'x', privacyLevel: 'PUBLIC_TO_EVERYONE',
        disableComment: false, disableDuet: false, disableStitch: false,
        brandContentToggle: false, brandOrganicToggle: false,
      }),
      /invalid_params/
    );
    assert.equal(chamadas, 1, 'insistiu numa recusa que nunca mudaria');
  } finally {
    global.fetch = fetchOriginal;
  }
});

test('servidor sobrecarregado (HTTP 503) é tentado de novo', async () => {
  const fetchOriginal = global.fetch;
  let chamadas = 0;
  global.fetch = async () => {
    chamadas += 1;
    if (chamadas === 1) return { ok: false, status: 503, json: async () => ({}), text: async () => '' };
    return { ok: true, status: 200, json: async () => ({ error: { code: 'ok' }, data: { publish_id: 'p2', upload_url: 'u' } }) };
  };
  try {
    const r = await tiktokService.initDirectPost('token', 1000, {
      caption: 'x', privacyLevel: 'PUBLIC_TO_EVERYONE',
      disableComment: false, disableDuet: false, disableStitch: false,
      brandContentToggle: false, brandOrganicToggle: false,
    });
    assert.equal(r.publishId, 'p2');
    assert.equal(chamadas, 2);
  } finally {
    global.fetch = fetchOriginal;
  }
});

// --- A ordem das partes não pode ser quebrada pela nova tentativa ---

async function contaComFila(quantos) {
  const cliente = await createClient();
  const { rows: [conta] } = await pool.query(
    `INSERT INTO tiktok_accounts (client_user_id, tiktok_open_id, display_name, is_active,
       access_token_encrypted, access_token_iv, refresh_token_encrypted, refresh_token_iv,
       scopes, token_expires_at, connected_at, auto_post_enabled)
     VALUES ($1,$2,'conta',true,'x','x','x','x',ARRAY['video.publish'],
       now() + interval '30 days', now(), true) RETURNING *`,
    [cliente.id, `open-${unico()}`]
  );
  const { rows: [sv] } = await pool.query(
    `INSERT INTO source_videos (youtube_video_id, title, status, input_type, owner_client_user_id, client_user_id)
     VALUES ($1,'v','ready','upload',$2,$2) RETURNING *`, [`v${unico()}`, cliente.id]
  );
  const postagens = [];
  for (let i = 0; i < quantos; i++) {
    const { rows: [clip] } = await pool.query(
      `INSERT INTO clips (source_video_id, start_seconds, end_seconds, status, title)
       VALUES ($1,$2,$3,'ready',$4) RETURNING *`,
      [sv.id, i * 180, (i + 1) * 180, `Parte ${i + 1}`]
    );
    const video = await videosRepository.createFromClip({ clipId: clip.id, filename: 'c.mp4', fileSizeBytes: 1000 });
    postagens.push(await postingsRepository.createIfNotExists({ videoId: video.id, tiktokAccountId: conta.id }));
  }
  return { conta, postagens };
}

test('a Parte 3 não passa na frente enquanto a Parte 2 espera nova tentativa', async () => {
  // Numa série "Parte 1, Parte 2...", a ordem é o produto: ver a parte 3 antes
  // da 2 estraga a história. Sem fila estrita, bastava a Parte 2 tropeçar numa
  // falha de rede e ser adiada 5 minutos para a Parte 3 (cujo horário já tinha
  // chegado) sair primeiro.
  const { conta, postagens } = await contaComFila(3);
  const [parte1, parte2, parte3] = postagens;

  // Parte 1 já saiu; as partes 2 e 3 estão com a hora vencida.
  await pool.query("UPDATE postings SET status='posted', posted_at=now() WHERE id=$1", [parte1.id]);
  await pool.query(
    "UPDATE postings SET scheduled_for = now() - interval '1 hour' WHERE id = ANY($1::bigint[])",
    [[parte2.id, parte3.id]]
  );

  // A Parte 2 falha por rede e é adiada.
  await postingsRepository.agendarNovaTentativa(parte2.id, 5);

  const proximo = await postingsRepository.findOldestDuePendingForAccount(conta.id);
  assert.equal(proximo, null, 'a Parte 3 foi publicada enquanto a Parte 2 ainda esperava');
});

test('passada a espera, a Parte 2 sai antes da 3', async () => {
  const { conta, postagens } = await contaComFila(3);
  const [parte1, parte2, parte3] = postagens;
  await pool.query("UPDATE postings SET status='posted', posted_at=now() WHERE id=$1", [parte1.id]);
  await pool.query(
    "UPDATE postings SET scheduled_for = now() - interval '1 hour' WHERE id = ANY($1::bigint[])",
    [[parte2.id, parte3.id]]
  );
  await postingsRepository.agendarNovaTentativa(parte2.id, 5);
  await pool.query("UPDATE postings SET scheduled_for = now() - interval '1 second' WHERE id=$1", [parte2.id]);

  const proximo = await postingsRepository.findOldestDuePendingForAccount(conta.id);
  assert.equal(String(proximo.id), String(parte2.id), 'a Parte 2 tinha que ser a próxima');
});

test('quando a Parte 2 desiste de vez, a fila anda', async () => {
  // A fila estrita não pode virar fila travada: esgotadas as tentativas, o
  // corte sai de 'pending' e os seguintes seguem.
  const { conta, postagens } = await contaComFila(3);
  const [parte1, parte2, parte3] = postagens;
  await pool.query("UPDATE postings SET status='posted', posted_at=now() WHERE id=$1", [parte1.id]);
  await pool.query(
    "UPDATE postings SET scheduled_for = now() - interval '1 hour' WHERE id = ANY($1::bigint[])",
    [[parte2.id, parte3.id]]
  );

  await postingsRepository.marcarErroDefinitivo(parte2.id);

  const proximo = await postingsRepository.findOldestDuePendingForAccount(conta.id);
  assert.equal(String(proximo.id), String(parte3.id), 'a fila travou depois que um corte desistiu');
});
