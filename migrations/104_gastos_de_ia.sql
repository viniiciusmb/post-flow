-- Gasto por PROVEDOR de IA (07/10/2026).
--
-- Os livros que ja existem (video_costs, live_costs, support_messages) dizem
-- quanto cada VIDEO ou cada conversa custou, mas nao de QUAL conta saiu o
-- dinheiro: desde que a transcricao passou a ir pela DeepInfra (com Groq e
-- OpenAI de reserva), "whisper_usd" mistura tres empresas diferentes.
--
-- Esta tabela responde a outra pergunta - quanto saiu de cada conta - e e com
-- ela que a tela de Custos estima o saldo da OpenAI e da Anthropic, que nao
-- informam o saldo pela API: saldo informado pelo admin menos o que foi
-- gasto desde entao.
--
-- Uma linha por chamada paga. Nada aqui e lido pra cobrar cliente.
CREATE TABLE ai_gastos (
  id BIGSERIAL PRIMARY KEY,
  provedor TEXT NOT NULL CHECK (provedor IN ('deepinfra', 'groq', 'openai', 'anthropic', 'elevenlabs')),
  -- Para que foi a chamada: 'transcricao', 'lives', 'cortes', 'flora',
  -- 'narrado_voz', 'narrado_imagem', 'narrado_roteiro'...
  uso TEXT NOT NULL,
  usd NUMERIC(14,8) NOT NULL DEFAULT 0,
  audio_segundos NUMERIC(12,2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_ai_gastos_provedor_data ON ai_gastos (provedor, created_at);
