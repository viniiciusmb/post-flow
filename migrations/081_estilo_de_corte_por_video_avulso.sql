-- Estilo de corte para o vídeo AVULSO (link colado ou arquivo enviado).
--
-- Até aqui a tabela guardava dois casos: a configuração padrão do cliente
-- (youtube_channel_id NULL) e a exceção de um canal. Vídeo avulso não tem
-- canal, então caía sempre no padrão do cliente - e o padrão é o que ele
-- configurou pensando nos canais que monitora. Quem colava o link de um vídeo
-- gringo dublado recebia o corte no idioma original, e quem queria um
-- enquadramento diferente só para aquele vídeo tinha que mudar o padrão,
-- cortar, e lembrar de desfazer depois.
--
-- Agora existe um terceiro caso: a exceção de um VÍDEO.
--   youtube_channel_id NULL + source_video_id NULL  -> padrão do cliente
--   youtube_channel_id = <id>                       -> exceção do canal
--   source_video_id = <id>                          -> exceção daquele vídeo
ALTER TABLE client_video_settings
  ADD COLUMN source_video_id BIGINT REFERENCES source_videos(id) ON DELETE CASCADE;

COMMENT ON COLUMN client_video_settings.source_video_id IS
  'Excecao de estilo de UM video avulso (link/upload). Some junto com o video (ON DELETE CASCADE) - estilo de video apagado nao serve pra nada.';

-- O ÍNDICE DO PADRÃO PRECISA MUDAR JUNTO, e este é o ponto onde esta migration
-- quebraria a produção se fosse escrita sem cuidado.
--
-- `uq_video_settings_padrao` era (client_user_id) WHERE youtube_channel_id IS
-- NULL. A linha de um vídeo também tem youtube_channel_id NULL, então ela
-- entraria nesse índice e colidiria com a linha padrão do cliente: o primeiro
-- vídeo avulso com estilo próprio faria o INSERT falhar dizendo que já existe
-- uma configuração padrão.
DROP INDEX IF EXISTS uq_video_settings_padrao;
CREATE UNIQUE INDEX uq_video_settings_padrao
  ON client_video_settings (client_user_id)
  WHERE youtube_channel_id IS NULL AND source_video_id IS NULL;

CREATE UNIQUE INDEX uq_video_settings_por_video
  ON client_video_settings (client_user_id, source_video_id)
  WHERE source_video_id IS NOT NULL;

-- ATENÇÃO para quem mexer nisto depois: ON CONFLICT sobre esta tabela PRECISA
-- repetir o predicado do índice correspondente, senão o Postgres não encontra
-- o índice e o INSERT falha com "no unique or exclusion constraint matching".
-- Isso já derrubou a detecção de vídeo novo neste projeto uma vez, e o
-- predicado do padrão acabou de ganhar mais uma condição.

-- Uma linha é de UM caso só. Sem isto, uma linha com canal E vídeo ao mesmo
-- tempo entraria nos dois índices e a resolução ("qual estilo vale?") passaria
-- a depender da ordem em que as consultas são feitas.
ALTER TABLE client_video_settings
  ADD CONSTRAINT chk_video_settings_um_alvo
  CHECK (youtube_channel_id IS NULL OR source_video_id IS NULL);

-- Idioma do áudio PEDIDO para um vídeo avulso, escolhido na hora do envio.
-- Fica em source_videos e não em client_video_settings porque é uma decisão
-- daquele envio, não um estilo que se reaproveita: o mesmo cliente cola hoje
-- um vídeo francês e amanhã um brasileiro.
--
-- NULL = não escolheu, e aí vale a configuração (do vídeo, do canal ou o
-- padrão). É diferente de 'original', que é uma escolha explícita.
ALTER TABLE source_videos
  ADD COLUMN chosen_audio_language TEXT;

COMMENT ON COLUMN source_videos.chosen_audio_language IS
  'Idioma escolhido no envio deste video avulso. NULL = nao escolheu (vale a configuracao). Diferente de "original", que e uma escolha.';
