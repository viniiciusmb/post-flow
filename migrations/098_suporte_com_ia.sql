-- Suporte com IA (06/10/2026).
--
-- O cliente conversa com a IA ("meu video nao foi cortado", "gastou meus
-- creditos"), ela consulta os dados DAQUELE cliente por ferramentas de leitura
-- e, quando o sistema confirma que a falha foi nossa, devolve os minutos.
--
-- Quem decide se pode devolver NAO e a IA: e o servidor, por regra fixa (ver
-- src/services/suporte/reembolsoDeCreditoService.js). A IA so pede.

CREATE TABLE support_conversations (
  id                 BIGSERIAL PRIMARY KEY,
  client_user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- 'aberta': conversando; 'encaminhada': a IA pediu ajuda humana.
  status             TEXT NOT NULL DEFAULT 'aberta' CHECK (status IN ('aberta', 'encaminhada', 'resolvida')),
  escalation_summary TEXT,
  escalated_at       TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_support_conversations_client ON support_conversations (client_user_id, updated_at DESC);
CREATE INDEX idx_support_conversations_status ON support_conversations (status, updated_at DESC);

-- Uma linha por mensagem trocada com a API, na ordem exata: o historico e
-- reenviado inteiro e sem edicao a cada turno (os blocos de raciocinio do
-- modelo deixam de valer se o historico for editado). `content` e o array de
-- blocos como a API devolveu/recebeu; `visible_text` e so o que aparece na tela
-- (NULL nas mensagens internas de ferramenta).
CREATE TABLE support_messages (
  id              BIGSERIAL PRIMARY KEY,
  conversation_id BIGINT NOT NULL REFERENCES support_conversations(id) ON DELETE CASCADE,
  role            TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content         JSONB NOT NULL,
  visible_text    TEXT,
  input_tokens    INTEGER NOT NULL DEFAULT 0,
  output_tokens   INTEGER NOT NULL DEFAULT 0,
  cost_usd        NUMERIC(12, 6) NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_support_messages_conversation ON support_messages (conversation_id, id);

-- Cada devolucao de minutos feita pelo suporte. UNIQUE(source_video_id) e a
-- trava de "um video so devolve uma vez", no banco e nao na disciplina do
-- codigo. ON DELETE SET NULL: apagar o video nao apaga a prova de que a
-- devolucao aconteceu (varios NULL convivem com o UNIQUE).
CREATE TABLE support_credit_refunds (
  id                BIGSERIAL PRIMARY KEY,
  client_user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_video_id   BIGINT UNIQUE REFERENCES source_videos(id) ON DELETE SET NULL,
  conversation_id   BIGINT REFERENCES support_conversations(id) ON DELETE SET NULL,
  bucket            TEXT NOT NULL CHECK (bucket IN ('normal', 'bonus')),
  minutes           INTEGER NOT NULL CHECK (minutes > 0),
  minutes_to_quota  INTEGER NOT NULL DEFAULT 0,
  minutes_to_extra  INTEGER NOT NULL DEFAULT 0,
  reason_code       TEXT NOT NULL,
  video_title       TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_support_credit_refunds_client ON support_credit_refunds (client_user_id, created_at DESC);
