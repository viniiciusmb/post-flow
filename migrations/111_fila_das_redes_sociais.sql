-- Fila de publicação das outras redes, igual à do TikTok (11/10/2026).
--
-- Até aqui o Instagram/Facebook publicava NA HORA, só pelo feed. Agora cada
-- conta tem a sua fila com horários, quantos por dia, publicar sozinho e pausa
-- - as mesmas regras do TikTok (ver lib/postingSchedule.js) - e um canal do
-- YouTube pode mandar os cortes pra contas de qualquer rede.

-- 1. Redes novas, todas pela Outstand. YouTube entra com o limite de envios
--    compartilhado da Outstand (decisão do fundador em 11/10/2026).
ALTER TABLE social_accounts DROP CONSTRAINT IF EXISTS social_accounts_network_check;
ALTER TABLE social_accounts ADD CONSTRAINT social_accounts_network_check
  CHECK (network IN ('instagram', 'facebook', 'threads', 'linkedin', 'pinterest', 'bluesky', 'youtube'));

-- 2. A postagem ganha horário e posição na fila.
--    scheduled_for: quando sai (mesma regra do TikTok: o job só publica o que
--      venceu, e a fila é estrita - ninguém passa na frente do primeiro).
--    queue_order: ordem escolhida arrastando na tela (NULL = ordem de chegada).
--    title: título (YouTube e Pinterest pedem um, separado da legenda).
--    erro_tipo: 'duracao' quando a rede não aceita o corte pelo tamanho - não
--      adianta tentar de novo, então a tela não oferece o botão.
--    esperas_de_cota: quantas vezes o YouTube negou por falta de vaga no dia.
--    ignora_limite_diario: "Postar agora" passa por cima do "N por dia".
ALTER TABLE social_postings DROP CONSTRAINT IF EXISTS social_postings_status_check;
ALTER TABLE social_postings ADD CONSTRAINT social_postings_status_check
  CHECK (status IN ('pending', 'sending', 'processing', 'posted', 'error', 'skipped'));
ALTER TABLE social_postings
  ADD COLUMN scheduled_for TIMESTAMPTZ,
  ADD COLUMN queue_order INTEGER,
  ADD COLUMN title TEXT,
  ADD COLUMN erro_tipo TEXT,
  ADD COLUMN esperas_de_cota INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN ignora_limite_diario BOOLEAN NOT NULL DEFAULT false;
UPDATE social_postings SET scheduled_for = COALESCE(proxima_tentativa_em, created_at);
ALTER TABLE social_postings DROP COLUMN proxima_tentativa_em;
CREATE INDEX idx_social_postings_fila ON social_postings (social_account_id, status, scheduled_for);

-- 3. Configuração de publicação por conta (o par do posting_schedule_settings
--    do TikTok). auto_post_enabled nasce LIGADO, diferente do TikTok: aqui a
--    conta só recebe corte automático quando o cliente a escolhe no canal, e
--    essa escolha já é o "sim". options guarda o que é próprio de cada rede
--    (privacidade do YouTube, pasta do Pinterest).
CREATE TABLE social_posting_settings (
  social_account_id BIGINT PRIMARY KEY REFERENCES social_accounts(id) ON DELETE CASCADE,
  mode              TEXT NOT NULL DEFAULT 'auto' CHECK (mode IN ('auto', 'manual')),
  videos_per_day    INTEGER NOT NULL DEFAULT 3 CHECK (videos_per_day BETWEEN 1 AND 10),
  manual_times      TEXT[] NOT NULL DEFAULT '{}',
  timezone          TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
  paused            BOOLEAN NOT NULL DEFAULT false,
  auto_post_enabled BOOLEAN NOT NULL DEFAULT true,
  options           JSONB NOT NULL DEFAULT '{}',
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4. Pra onde vão os cortes de um canal, além da conta do TikTok dele.
CREATE TABLE youtube_channel_social_targets (
  youtube_channel_id BIGINT NOT NULL REFERENCES youtube_channels(id) ON DELETE CASCADE,
  social_account_id  BIGINT NOT NULL REFERENCES social_accounts(id) ON DELETE CASCADE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (youtube_channel_id, social_account_id)
);
CREATE INDEX idx_channel_social_targets_conta ON youtube_channel_social_targets (social_account_id);

-- 5. Feed de cortes: o que a pessoa já assistiu não volta a aparecer.
CREATE TABLE clip_views (
  client_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  clip_id        BIGINT NOT NULL REFERENCES clips(id) ON DELETE CASCADE,
  viewed_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (client_user_id, clip_id)
);
CREATE TABLE live_clip_views (
  client_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  live_clip_id   BIGINT NOT NULL REFERENCES live_clips(id) ON DELETE CASCADE,
  viewed_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (client_user_id, live_clip_id)
);
