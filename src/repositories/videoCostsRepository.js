// Livro de custo por video - a fonte de verdade de quanto a operacao gasta.
//
// Existe porque o custo morava dentro da linha do proprio video: apagar o
// video apagava a contabilidade junto (91% do historico tinha sumido quando
// isso foi descoberto, em 11/09/2026). Aqui o lancamento sobrevive ao video.
//
// Regra de dinheiro seguida em todas as consultas deste arquivo, e ela e a
// mesma do painel "Banda" e da tela "Clientes": SO VIRA CUSTO o que saiu por
// PROXY PAGO. Tunel (do fundador ou do cliente) e reaproveitamento nao custam
// por GB - essa banda ja esta paga na conta de internet, e cobrar por ela aqui
// inventaria um custo que a empresa nunca teve.
'use strict';

const pool = require('../db/pool');

// Um lancamento por video, acumulando etapa por etapa (download, transcricao,
// IA). Acumula em vez de sobrescrever porque reprocessar um video que falhou
// PAGA DE NOVO: se o Whisper foi chamado duas vezes, a OpenAI cobrou duas
// vezes, e o livro tem que dizer isso (source_videos.whisper_cost_usd, que
// sobrescreve, sempre mostrou so a ultima).
//
// Campos passados como null nao sao tocados - cada etapa mexe so no que ela
// sabe. O ON CONFLICT repete o predicado do indice parcial de proposito: sem
// ele o Postgres nao reconhece o indice (armadilha que ja quebrou a deteccao
// de video novo neste projeto).
async function registrar(sourceVideoId, clientUserId, campos = {}) {
  const {
    videoSeconds = 0,
    whisperUsd = 0,
    iaUsd = 0,
    bandaUsd = 0,
    downloadBytes = 0,
    egressType = null,
    downloadReused = null,
    transcriptReused = null,
    occurredAt = null,
  } = campos;

  const { rows } = await pool.query(
    `INSERT INTO video_costs (
       client_user_id, source_video_id, occurred_at, video_seconds,
       whisper_usd, ia_usd, banda_usd, download_bytes, egress_type,
       download_reused, transcript_reused
     )
     VALUES ($1, $2, coalesce($3, now()), $4, $5, $6, $7, $8, $9,
             coalesce($10, false), coalesce($11, false))
     ON CONFLICT (source_video_id) WHERE source_video_id IS NOT NULL
     DO UPDATE SET
       whisper_usd = video_costs.whisper_usd + EXCLUDED.whisper_usd,
       ia_usd = video_costs.ia_usd + EXCLUDED.ia_usd,
       banda_usd = video_costs.banda_usd + EXCLUDED.banda_usd,
       download_bytes = video_costs.download_bytes + EXCLUDED.download_bytes,
       -- A duracao nao acumula: e a mesma do video, repetida a cada etapa.
       video_seconds = GREATEST(video_costs.video_seconds, EXCLUDED.video_seconds),
       egress_type = coalesce($9, video_costs.egress_type),
       download_reused = coalesce($10, video_costs.download_reused),
       transcript_reused = coalesce($11, video_costs.transcript_reused),
       client_user_id = coalesce(EXCLUDED.client_user_id, video_costs.client_user_id)
     RETURNING *`,
    [
      clientUserId || null,
      sourceVideoId || null,
      occurredAt,
      Math.round(videoSeconds || 0),
      whisperUsd || 0,
      iaUsd || 0,
      bandaUsd || 0,
      Math.round(downloadBytes || 0),
      egressType,
      downloadReused,
      transcriptReused,
    ]
  );
  return rows[0];
}

// Os numeros do painel de custo, todos do MESMO periodo.
//
// Dois "custo por minuto", e a diferenca entre eles importa:
//
//   - novo:     o que custa processar um video que ninguem baixou ainda. E o
//               custo marginal de verdade - o numero pra decidir preco.
//   - entregue: o custo medio de tudo que foi entregue, incluindo os videos
//               que sairam de graca por reaproveitamento. E sempre menor, e e
//               o que mede a eficiencia da operacao.
//
// Reaproveitado nao gera custo (por decisao do fundador, e porque e a
// verdade: nao houve chamada de API nem download). Mas ele ENTREGA minuto de
// video - por isso entra no denominador de "entregue" e fica fora do de
// "novo", em vez de simplesmente sumir das duas contas.
async function resumo({ since, until } = {}) {
  const de = since || new Date('2020-01-01T00:00:00.000Z');
  const ate = until || new Date();
  const { rows } = await pool.query(
    `SELECT
       coalesce(sum(whisper_usd) FILTER (WHERE origem <> 'narrado'), 0)::float8 AS whisper_usd,
       coalesce(sum(ia_usd) FILTER (WHERE origem <> 'narrado'), 0)::float8 AS ia_usd,
       coalesce(sum(banda_usd) FILTER (WHERE origem <> 'narrado'), 0)::float8 AS banda_usd,
       coalesce(sum(whisper_usd + ia_usd + banda_usd) FILTER (WHERE origem <> 'narrado'), 0)::float8 AS total_usd,
       coalesce(sum(download_bytes) FILTER (WHERE origem <> 'narrado'), 0)::float8 AS bytes,
       count(*) FILTER (WHERE origem = 'pipeline')::int AS videos,
       coalesce(sum(video_seconds) FILTER (WHERE origem <> 'narrado'), 0)::float8 AS segundos_entregues,
       coalesce(sum(video_seconds)
                FILTER (WHERE origem <> 'narrado' AND NOT transcript_reused AND NOT download_reused), 0)::float8
         AS segundos_novos,
       coalesce(sum(whisper_usd + ia_usd + banda_usd)
                FILTER (WHERE origem <> 'narrado' AND NOT transcript_reused AND NOT download_reused), 0)::float8
         AS total_novos_usd,
       count(*) FILTER (WHERE origem <> 'narrado' AND (transcript_reused OR download_reused))::int
         AS videos_reaproveitados,
       coalesce(sum(video_seconds)
                FILTER (WHERE origem <> 'narrado' AND (transcript_reused OR download_reused)), 0)::float8
         AS segundos_reaproveitados,
       -- Custo que existe mas nao tem dono: veio da serie historica, de
       -- videos apagados antes de este livro existir. Fica separado pra
       -- ninguem confundir "sem cliente" com "cliente zerado".
       coalesce(sum(whisper_usd + ia_usd + banda_usd) FILTER (WHERE origem = 'historico'), 0)::float8
         AS total_sem_dono_usd,
       -- Video narrado vive FORA de todas as contas acima, e nao por
       -- organizacao: resumo() alimenta o "custo por minuto" que decide preco
       -- de plano, e um minuto de video narrado nao tem nada a ver com um
       -- minuto de corte do YouTube. Somar os dois inflaria o denominador e a
       -- tela passaria a dizer que cortar ficou mais barato - mesmo erro ja
       -- corrigido uma vez em stageTimingsSince.
       count(*) FILTER (WHERE origem = 'narrado')::int AS videos_narrados,
       coalesce(sum(video_seconds) FILTER (WHERE origem = 'narrado'), 0)::float8 AS segundos_narrados,
       coalesce(sum(tts_usd), 0)::float8 AS tts_usd,
       coalesce(sum(imagem_usd), 0)::float8 AS imagem_usd,
       coalesce(sum(whisper_usd + ia_usd + tts_usd + imagem_usd) FILTER (WHERE origem = 'narrado'), 0)::float8
         AS total_narrado_usd
     FROM video_costs
     WHERE occurred_at >= $1 AND occurred_at <= $2`,
    [de, ate]
  );
  return rows[0];
}

// Custo por dia, pro grafico. Sem preencher dia vazio: quem desenha decide se
// mostra buraco ou zero.
async function porDia({ since, until } = {}) {
  const de = since || new Date('2020-01-01T00:00:00.000Z');
  const ate = until || new Date();
  const { rows } = await pool.query(
    `SELECT (occurred_at AT TIME ZONE 'America/Sao_Paulo')::date AS dia,
            sum(whisper_usd)::float8 AS whisper_usd,
            sum(ia_usd)::float8 AS ia_usd,
            sum(banda_usd)::float8 AS banda_usd,
            sum(whisper_usd + ia_usd + banda_usd)::float8 AS total_usd,
            sum(video_seconds)::float8 AS segundos
     FROM video_costs
     WHERE occurred_at >= $1 AND occurred_at <= $2 AND origem <> 'narrado'
     GROUP BY 1 ORDER BY 1`,
    [de, ate]
  );
  return rows;
}

// Custo por cliente no periodo. O cliente sem lancamento nenhum nao aparece -
// quem monta a tela junta com a lista de clientes.
async function porCliente({ since, until } = {}) {
  const de = since || new Date('2020-01-01T00:00:00.000Z');
  const ate = until || new Date();
  const { rows } = await pool.query(
    `SELECT client_user_id,
            sum(whisper_usd)::float8 AS whisper_usd,
            sum(ia_usd)::float8 AS ia_usd,
            sum(banda_usd)::float8 AS banda_usd,
            sum(whisper_usd + ia_usd + banda_usd)::float8 AS total_usd,
            sum(video_seconds)::float8 AS segundos,
            count(*) FILTER (WHERE origem = 'pipeline')::int AS videos
     FROM video_costs
     WHERE occurred_at >= $1 AND occurred_at <= $2 AND client_user_id IS NOT NULL
       AND origem <> 'narrado'
     GROUP BY 1`,
    [de, ate]
  );
  return rows;
}

// Custo de UM cliente - usado pela tela "Clientes" do admin.
async function totalPorClienteMap({ since, until } = {}) {
  const linhas = await porCliente({ since, until });
  const mapa = new Map();
  for (const l of linhas) mapa.set(Number(l.client_user_id), l);
  return mapa;
}

// Lancamento do video narrado. Mesma mecanica de registrar(): acumula etapa
// por etapa, porque custo que ja saiu da conta nao pode depender de o video
// terminar bem - um roteiro que paga a narracao inteira e falha na montagem
// custou dinheiro de verdade.
//
// O ON CONFLICT repete o predicado do indice parcial de proposito: sem ele o
// Postgres nao reconhece o indice (armadilha que ja quebrou a deteccao de
// video novo neste projeto).
async function registrarNarrado(narratedVideoId, clientUserId, campos = {}) {
  const {
    videoSeconds = 0,
    whisperUsd = 0,
    iaUsd = 0,
    ttsUsd = 0,
    imagemUsd = 0,
  } = campos;

  const { rows } = await pool.query(
    `INSERT INTO video_costs
       (client_user_id, narrated_video_id, video_seconds,
        whisper_usd, ia_usd, tts_usd, imagem_usd, origem)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'narrado')
     ON CONFLICT (narrated_video_id) WHERE narrated_video_id IS NOT NULL
     DO UPDATE SET
       whisper_usd = video_costs.whisper_usd + EXCLUDED.whisper_usd,
       ia_usd      = video_costs.ia_usd      + EXCLUDED.ia_usd,
       tts_usd     = video_costs.tts_usd     + EXCLUDED.tts_usd,
       imagem_usd  = video_costs.imagem_usd  + EXCLUDED.imagem_usd,
       -- Nao acumula: e a duracao do mesmo video, repetida a cada etapa.
       video_seconds = GREATEST(video_costs.video_seconds, EXCLUDED.video_seconds)
     RETURNING *`,
    [clientUserId || null, narratedVideoId, Math.round(videoSeconds || 0), whisperUsd, iaUsd, ttsUsd, imagemUsd]
  );
  return rows[0];
}

// Custo de UM video narrado - a tela mostra ao lado do modo de imagem usado,
// que e o que torna a comparacao entre "economico" e "qualidade" possivel.
async function doNarrado(narratedVideoId) {
  const { rows } = await pool.query(
    'SELECT * FROM video_costs WHERE narrated_video_id = $1',
    [narratedVideoId]
  );
  return rows[0] || null;
}

module.exports = {
  registrar,
  registrarNarrado,
  doNarrado,
  resumo,
  porDia,
  porCliente,
  totalPorClienteMap,
};
