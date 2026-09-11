-- Custo que NAO desaparece quando o video e apagado.
--
-- Ate hoje o custo de cada video morava nas colunas da PROPRIA linha de
-- source_videos (whisper_cost_usd, claude_cost_usd, download_bytes). Apagar um
-- video - pela tela, pela limpeza de disco, ou em cascata - apagava junto a
-- unica prova de quanto ele custou. O estrago medido em producao em 11/09/2026:
-- US$ 14,74 de Whisper no historico (metrics_daily) contra US$ 1,35
-- sobrevivendo em source_videos. 91% do custo tinha evaporado, e por isso a
-- tela "Clientes" mostrava sempre ~US$ 1 pra uma conta que ja tinha gasto
-- varias vezes isso.
--
-- Agora cada video processado gera uma linha AQUI, e esta linha e o livro
-- contabil: `source_video_id` vira NULL quando o video morre (ON DELETE SET
-- NULL), mas o cliente, o dia, os minutos e os valores ficam.
--
-- Por que colunas por componente em vez de uma linha por etapa: a pergunta que
-- o painel faz e "quanto custou o minuto de video", e isso exige contar os
-- minutos do video UMA vez. Com uma linha por etapa, somar video_seconds daria
-- o dobro ou o triplo - o tipo de erro que ninguem percebe porque o numero
-- continua "parecendo" plausivel.
CREATE TABLE video_costs (
  id                BIGSERIAL PRIMARY KEY,
  -- SET NULL nos dois: o lancamento sobrevive ao video E ao cliente apagado.
  -- Custo que ja saiu da nossa conta continua tendo acontecido.
  client_user_id    BIGINT REFERENCES users(id) ON DELETE SET NULL,
  source_video_id   BIGINT REFERENCES source_videos(id) ON DELETE SET NULL,
  occurred_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Duracao do video de origem. E o denominador do "custo por minuto".
  video_seconds     INTEGER NOT NULL DEFAULT 0,
  whisper_usd       NUMERIC(12,6) NOT NULL DEFAULT 0,
  ia_usd            NUMERIC(12,6) NOT NULL DEFAULT 0,
  -- Ja calculado com a taxa do GB do MOMENTO (snapshot, mesma regra de
  -- client_overage_charges.rate_cents_per_min): reajustar o preco do GB nao
  -- pode mudar o custo de um download que ja aconteceu.
  banda_usd         NUMERIC(12,6) NOT NULL DEFAULT 0,
  download_bytes    BIGINT NOT NULL DEFAULT 0,
  egress_type       TEXT,
  -- Reaproveitou o arquivo/transcricao de outro cliente: custo ZERO de
  -- verdade, e nao "custo desconhecido". Guardado explicitamente porque
  -- deduzir por "valor zero" mentiria - ha mais de um jeito de dar zero
  -- (tunel proprio tambem nao custa banda).
  download_reused   BOOLEAN NOT NULL DEFAULT false,
  transcript_reused BOOLEAN NOT NULL DEFAULT false,
  -- 'pipeline' = medido video a video. 'historico' = reconstituido do
  -- metrics_daily no dia desta migration, sem cliente identificado (a serie
  -- historica nunca teve essa coluna). Separado pra nenhuma tela somar os
  -- dois achando que sao a mesma qualidade de dado.
  origem            TEXT NOT NULL DEFAULT 'pipeline' CHECK (origem IN ('pipeline', 'historico'))
);

-- Uma linha por video. Parcial porque source_video_id vira NULL quando o video
-- e apagado, e varios lancamentos orfaos precisam conviver.
--
-- ATENCAO ao mexer: todo ON CONFLICT que depende deste indice tem que repetir
-- o predicado `WHERE source_video_id IS NOT NULL`, senao o Postgres nao
-- reconhece o indice (ja quebrou a deteccao de video novo neste projeto).
CREATE UNIQUE INDEX ux_video_costs_source_video
  ON video_costs (source_video_id) WHERE source_video_id IS NOT NULL;

CREATE INDEX idx_video_costs_occurred_at ON video_costs (occurred_at);
CREATE INDEX idx_video_costs_client ON video_costs (client_user_id, occurred_at);

-- ---------------------------------------------------------------------------
-- Backfill 1: os videos que AINDA existem entram com o custo que esta neles.
-- O custo de banda so vira dinheiro quando saiu por proxy pago - tunel e
-- reaproveitamento nao custam por GB (a banda ja esta paga na conta de
-- internet), e cobrar aqui inventaria um custo que nunca existiu.
-- ---------------------------------------------------------------------------
INSERT INTO video_costs (
  client_user_id, source_video_id, occurred_at, video_seconds,
  whisper_usd, ia_usd, banda_usd, download_bytes, egress_type,
  download_reused, transcript_reused, origem
)
SELECT sv.owner_client_user_id,
       sv.id,
       coalesce(sv.processing_started_at, sv.created_at),
       coalesce(sv.duration_seconds, 0),
       coalesce(sv.whisper_cost_usd, 0),
       coalesce(sv.claude_cost_usd, 0),
       CASE WHEN sv.download_egress_type = 'proxy'
            THEN (coalesce(sv.download_bytes, 0) / 1073741824.0)
                 * coalesce((SELECT (value #>> '{}')::numeric FROM settings WHERE key = 'custo_banda_por_gb_usd'), 1)
            ELSE 0 END,
       coalesce(sv.download_bytes, 0),
       sv.download_egress_type,
       sv.download_egress_type = 'reuse',
       coalesce(sv.transcript_reused, false),
       'pipeline'
FROM source_videos sv
WHERE sv.whisper_cost_usd IS NOT NULL
   OR sv.claude_cost_usd IS NOT NULL
   OR sv.download_bytes > 0;

-- ---------------------------------------------------------------------------
-- Backfill 2: o custo dos videos JA APAGADOS, reconstituido da serie historica.
--
-- metrics_daily tem o total por dia mas nunca teve coluna de cliente, entao
-- estes lancamentos entram sem dono (client_user_id NULL) e marcados como
-- 'historico'. Fica registrado o que a empresa gastou, mesmo sem saber por
-- quem - melhor do que o total mentir pra menos.
--
-- Entra so a DIFERENCA: o que o dia registrou menos o que os videos vivos
-- daquele dia ja lancaram acima. Sem isso, todo video que sobreviveu seria
-- contado duas vezes.
--
-- Banda historica nao existe aqui (metrics_daily nunca guardou bytes), entao
-- o custo de banda dos videos apagados e o unico numero que nao volta - o
-- custo por minuto de periodos antigos sai, por isso, um pouco PRA BAIXO.
-- Os minutos, esses voltam exatos: o Whisper cobra um valor fixo por minuto.
-- ---------------------------------------------------------------------------
INSERT INTO video_costs (
  client_user_id, source_video_id, occurred_at, video_seconds,
  whisper_usd, ia_usd, banda_usd, origem
)
SELECT NULL,
       NULL,
       md.day + interval '12 hours',
       -- Os MINUTOS daquele dia, reconstituidos a partir do proprio Whisper:
       -- ele custa exatamente US$ 0,006 por minuto de audio, entao
       -- custo/0,006 devolve os minutos transcritos sem chute nenhum. Sem
       -- isso o custo historico entraria sem denominador e o "custo por
       -- minuto" do painel apareceria inflado em qualquer filtro que alcance
       -- o passado - um numero errado numa tela feita pra decidir preco.
       round((GREATEST(coalesce(md.whisper_cost_usd, 0) - coalesce(vivos.whisper, 0), 0) / 0.006) * 60)::int,
       GREATEST(coalesce(md.whisper_cost_usd, 0) - coalesce(vivos.whisper, 0), 0),
       GREATEST(coalesce(md.claude_cost_usd, 0) - coalesce(vivos.ia, 0), 0),
       0,
       'historico'
FROM metrics_daily md
LEFT JOIN (
  SELECT date_trunc('day', coalesce(sv.processing_started_at, sv.created_at))::date AS dia,
         sum(coalesce(sv.whisper_cost_usd, 0)) AS whisper,
         sum(coalesce(sv.claude_cost_usd, 0)) AS ia
  FROM source_videos sv
  GROUP BY 1
) vivos ON vivos.dia = md.day
WHERE GREATEST(coalesce(md.whisper_cost_usd, 0) - coalesce(vivos.whisper, 0), 0)
    + GREATEST(coalesce(md.claude_cost_usd, 0) - coalesce(vivos.ia, 0), 0) > 0;
