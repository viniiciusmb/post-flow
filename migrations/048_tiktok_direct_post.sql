-- Publicação direta no TikTok (Direct Post).
--
-- Até aqui o sistema usava o endpoint de CAIXA DE ENTRADA: o corte chegava
-- como rascunho e o criador finalizava dentro do aplicativo do TikTok. Quem
-- coletava privacidade, comentários e duetos era o próprio TikTok, então o
-- nosso app não precisava perguntar nada.
--
-- Na publicação direta o vídeo vai direto pro perfil, e aí as diretrizes do
-- TikTok exigem que ESTAS escolhas sejam feitas manualmente pelo criador, na
-- nossa tela, antes de cada publicação:
--
--   * nível de privacidade, escolhido entre as opções que a conta permite,
--     SEM nenhuma marcada por padrão;
--   * comentários, duetos e junções, todos DESMARCADOS por padrão e
--     desabilitados quando a própria conta do criador não permite;
--   * divulgação comercial (marca própria / conteúdo de parceria).
--
-- Por isso cada item da fila carrega as suas escolhas: não dá pra ter um
-- "padrão da conta" aplicado sozinho, porque padrão pré-selecionado é
-- exatamente o que a auditoria proíbe.

ALTER TABLE postings
  -- NULL = o criador ainda não escolheu. É o estado inicial de todo corte que
  -- entra na fila, e o que impede a publicação de sair sem escolha humana.
  ADD COLUMN IF NOT EXISTS privacy_level TEXT,
  ADD COLUMN IF NOT EXISTS disable_comment BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS disable_duet BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS disable_stitch BOOLEAN NOT NULL DEFAULT true,
  -- Divulgação comercial. Os dois desligados por padrão, como a diretriz pede.
  -- brand_organic = promove a marca do próprio criador ("Conteúdo promocional")
  -- brand_content = parceria paga com terceiro ("Parceria paga")
  ADD COLUMN IF NOT EXISTS brand_organic_toggle BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS brand_content_toggle BOOLEAN NOT NULL DEFAULT false,
  -- Quando o criador confirmou as escolhas. Serve de prova de que a seleção
  -- foi manual, que é o ponto da exigência.
  ADD COLUMN IF NOT EXISTS options_confirmed_at TIMESTAMPTZ;

-- Valores aceitos pela API do TikTok. SELF_ONLY é o único permitido enquanto
-- o app não passa na auditoria, então ele precisa estar na lista.
ALTER TABLE postings
  DROP CONSTRAINT IF EXISTS chk_postings_privacy_level;
ALTER TABLE postings
  ADD CONSTRAINT chk_postings_privacy_level CHECK (
    privacy_level IS NULL OR privacy_level IN (
      'PUBLIC_TO_EVERYONE',
      'MUTUAL_FOLLOW_FRIENDS',
      'FOLLOWER_OF_CREATOR',
      'SELF_ONLY'
    )
  );

-- Conteúdo de parceria paga não pode ser privado (regra do TikTok). Deixamos o
-- banco recusar também, e não só a tela: a mesma combinação chegaria pela API
-- e a publicação falharia lá na frente, já com o vídeo enviado.
ALTER TABLE postings
  DROP CONSTRAINT IF EXISTS chk_postings_branded_nao_privado;
ALTER TABLE postings
  ADD CONSTRAINT chk_postings_branded_nao_privado CHECK (
    NOT (brand_content_toggle AND privacy_level = 'SELF_ONLY')
  );

-- O que a conta do criador permite, buscado no TikTok e guardado pra tela não
-- precisar consultar a cada abertura. Tem prazo de validade curto de
-- propósito: a diretriz exige dados frescos toda vez que a tela de publicação
-- abre, então isto é cache de minutos, não de dias.
ALTER TABLE tiktok_accounts
  ADD COLUMN IF NOT EXISTS creator_nickname TEXT,
  ADD COLUMN IF NOT EXISTS privacy_level_options TEXT[],
  ADD COLUMN IF NOT EXISTS comment_disabled BOOLEAN,
  ADD COLUMN IF NOT EXISTS duet_disabled BOOLEAN,
  ADD COLUMN IF NOT EXISTS stitch_disabled BOOLEAN,
  ADD COLUMN IF NOT EXISTS max_video_post_duration_sec INTEGER,
  ADD COLUMN IF NOT EXISTS creator_info_updated_at TIMESTAMPTZ;

-- Modo de publicação por conta. 'inbox' é o comportamento atual (rascunho);
-- 'direct' publica no perfil e exige as escolhas acima. Começa em 'inbox'
-- porque é o que funciona antes da auditoria passar.
ALTER TABLE tiktok_accounts
  ADD COLUMN IF NOT EXISTS publish_mode TEXT NOT NULL DEFAULT 'inbox';
ALTER TABLE tiktok_accounts
  DROP CONSTRAINT IF EXISTS chk_tiktok_publish_mode;
ALTER TABLE tiktok_accounts
  ADD CONSTRAINT chk_tiktok_publish_mode CHECK (publish_mode IN ('inbox', 'direct'));

-- A fila de publicação consulta "pendentes que já têm escolha confirmada".
CREATE INDEX IF NOT EXISTS idx_postings_prontas_pra_publicar
  ON postings (tiktok_account_id, status)
  WHERE status = 'pending' AND options_confirmed_at IS NOT NULL;
