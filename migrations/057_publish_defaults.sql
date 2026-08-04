-- Opcoes de publicacao direta: escolha UMA vez, vale pra todos os cortes.
--
-- Como estava: cada corte da fila exigia que o cliente abrisse e confirmasse
-- privacidade, interacoes e divulgacao comercial. Isso cumpre a exigencia da
-- TikTok, mas acaba com a razao de existir do produto - o sistema roda sozinho,
-- e ter que clicar corte a corte transforma automacao em trabalho manual.
--
-- Como fica: a escolha e feita uma vez, no nivel da CONTA. A exigencia da
-- TikTok continua cumprida - o que ela proibe e publicar com um padrao que o
-- criador nunca viu, nao publicar com o padrao que ele mesmo definiu. Nada vem
-- pre-selecionado: enquanto publish_options_set_at for NULL, a publicacao
-- direta nao sai.
--
-- O corte continua podendo ter opcoes proprias: quando as colunas de postings
-- estiverem preenchidas (options_confirmed_at != NULL), elas ganham do padrao
-- da conta. Ai o significado dessa coluna muda de "ja confirmou" para "este
-- corte tem opcoes proprias".

ALTER TABLE tiktok_accounts
  ADD COLUMN IF NOT EXISTS default_privacy_level TEXT
    CHECK (default_privacy_level IN ('PUBLIC_TO_EVERYONE', 'MUTUAL_FOLLOW_FRIENDS', 'FOLLOWER_OF_CREATOR', 'SELF_ONLY')),
  ADD COLUMN IF NOT EXISTS default_disable_comment BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS default_disable_duet BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS default_disable_stitch BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS default_brand_organic_toggle BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS default_brand_content_toggle BOOLEAN NOT NULL DEFAULT false,
  -- NULL de proposito: e isto que diz "o criador ainda nao escolheu".
  ADD COLUMN IF NOT EXISTS publish_options_set_at TIMESTAMPTZ;

-- Quem ja tinha confirmado corte a corte nao pode ser jogado de volta pro
-- comeco: a escolha do corte mais recente vira o padrao da conta.
UPDATE tiktok_accounts ta
   SET default_privacy_level = p.privacy_level,
       default_disable_comment = p.disable_comment,
       default_disable_duet = p.disable_duet,
       default_disable_stitch = p.disable_stitch,
       default_brand_organic_toggle = p.brand_organic_toggle,
       default_brand_content_toggle = p.brand_content_toggle,
       publish_options_set_at = p.options_confirmed_at
  FROM (
    SELECT DISTINCT ON (tiktok_account_id) *
      FROM postings
     WHERE options_confirmed_at IS NOT NULL AND privacy_level IS NOT NULL
     ORDER BY tiktok_account_id, options_confirmed_at DESC
  ) p
 WHERE p.tiktok_account_id = ta.id
   AND ta.publish_options_set_at IS NULL;
