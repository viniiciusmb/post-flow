-- "Não processar vídeos acima de N minutos", por canal.
--
-- Um canal que publica tanto cortes de 2 minutos quanto lives de 3 horas gera,
-- na live, um download gigante, uma transcrição cara e dezenas de cortes que
-- ninguém pediu. Não havia como dizer "esse canal só me interessa até X".
ALTER TABLE youtube_channels
  ADD COLUMN max_video_minutes INTEGER
  CHECK (max_video_minutes IS NULL OR max_video_minutes > 0);

COMMENT ON COLUMN youtube_channels.max_video_minutes IS
  'Limite de duracao para processar automaticamente. NULL = sem limite. Video acima disso e CADASTRADO como detectado com o motivo, nunca descartado - o cliente decide se manda cortar assim mesmo.';

-- Por que o vídeo é cadastrado em vez de ignorado, e por que o motivo é
-- gravado:
--
-- Ignorar faria o canal simplesmente parar de trazer vídeo, sem nada em tela
-- explicando - exatamente o problema que o selo de "somente membros" resolveu.
-- E o motivo precisa ficar GRAVADO porque o limite do canal pode mudar depois:
-- reconstituir "por que este vídeo não entrou?" a partir do limite ATUAL diria
-- a coisa errada assim que alguém mexesse na configuração.
--
-- Diferente de 'somente_membros', o status continua 'detected': o vídeo PODE
-- ser processado a qualquer momento, foi barrado por escolha do cliente e não
-- por impossibilidade. O botão "Processar" que já existe para vídeo detectado
-- continua valendo.
ALTER TABLE source_videos
  ADD COLUMN auto_skipped_reason TEXT
  CHECK (auto_skipped_reason IS NULL OR auto_skipped_reason IN ('duracao'));

COMMENT ON COLUMN source_videos.auto_skipped_reason IS
  'Por que este video foi detectado mas NAO entrou na fila sozinho. Limpo quando alguem manda processar. NULL = entrou normalmente (ou ainda vai entrar).';

CREATE INDEX idx_source_videos_auto_skipped
  ON source_videos (youtube_channel_id)
  WHERE auto_skipped_reason IS NOT NULL;
