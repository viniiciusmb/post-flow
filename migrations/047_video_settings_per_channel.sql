-- Estilo de corte por canal.
--
-- Antes existia UMA configuracao por cliente: quem monitorava um podcast e um
-- canal de cortes ao vivo era obrigado a usar o mesmo enquadramento, a mesma
-- legenda e o mesmo titulo nos dois. Agora cada canal pode ter o proprio
-- estilo, e continua existindo a configuracao "de todos os canais" pra quem
-- nao quer separar nada.
--
-- Modelo: a MESMA tabela guarda os dois casos.
--   youtube_channel_id IS NULL     -> configuracao padrao do cliente
--                                     ("aplicar em todos os canais")
--   youtube_channel_id = <id>      -> excecao daquele canal
--
-- Na hora de cortar, procura-se a linha do canal; nao existindo, cai na linha
-- padrao; nao existindo nenhuma, cai nos DEFAULTS do codigo.

ALTER TABLE client_video_settings
  ADD COLUMN IF NOT EXISTS youtube_channel_id BIGINT REFERENCES youtube_channels(id) ON DELETE CASCADE;

-- A chave primaria era client_user_id sozinho, o que impede mais de uma linha
-- por cliente. Precisa sair pra caber a linha por canal.
ALTER TABLE client_video_settings DROP CONSTRAINT IF EXISTS client_video_settings_pkey;

-- Duas unicidades PARCIAIS em vez de uma composta, porque no Postgres dois
-- NULLs sao considerados distintos: um UNIQUE(client_user_id,
-- youtube_channel_id) deixaria o cliente criar varias linhas "padrao".
--
-- ATENCAO pra quem mexer nisso depois: constraint que vira indice parcial
-- quebra `ON CONFLICT (coluna)` silenciosamente. Todo ON CONFLICT sobre esta
-- tabela PRECISA repetir o mesmo predicado do indice (ver
-- clientVideoSettingsRepository). Isso ja derrubou a deteccao de video novo
-- neste projeto uma vez.
CREATE UNIQUE INDEX IF NOT EXISTS uq_video_settings_padrao
  ON client_video_settings (client_user_id)
  WHERE youtube_channel_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_video_settings_por_canal
  ON client_video_settings (client_user_id, youtube_channel_id)
  WHERE youtube_channel_id IS NOT NULL;

-- Consulta quente: o pipeline resolve o estilo a cada video processado.
CREATE INDEX IF NOT EXISTS idx_video_settings_canal
  ON client_video_settings (youtube_channel_id)
  WHERE youtube_channel_id IS NOT NULL;

-- Imagem de fundo (template) que o cliente sobe pra aparecer atras do corte.
-- Fica no mesmo volume dos clipes (VIDEO_WORK_DIR), entao guardamos so o
-- caminho. NULL = sem template, comportamento de sempre.
ALTER TABLE client_video_settings
  ADD COLUMN IF NOT EXISTS background_template_path TEXT,
  -- Quanto da altura o video ocupa dentro do template (o resto fica sendo o
  -- fundo). 100 = video cobrindo tudo, que e o mesmo que nao ter template.
  ADD COLUMN IF NOT EXISTS background_video_height_percent SMALLINT NOT NULL DEFAULT 100,
  -- Posicao vertical do video dentro do template, em % (0 = topo, 100 = base).
  ADD COLUMN IF NOT EXISTS background_video_offset_percent SMALLINT NOT NULL DEFAULT 50;
