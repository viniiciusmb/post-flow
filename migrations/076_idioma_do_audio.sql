-- Escolher em que IDIOMA o corte é feito, quando o canal publica o vídeo
-- dublado em vários idiomas.
--
-- O caso concreto (fundador, 01/09/2026): o canal "MrBeast Gaming" é falado em
-- inglês, mas o YouTube entrega o MESMO vídeo com 13 trilhas de áudio dubladas
-- — inclusive português. Verificado com yt-dlp num vídeo real do canal:
--   ar bn en es hi id it pl pt ru th tr vi
-- Hoje o sistema sempre baixa a trilha padrão (o inglês original), e a partir
-- daí tudo sai em inglês: o Whisper transcreve em inglês, o Claude escreve
-- título e legenda em inglês (ele já segue o idioma da transcrição). Não é um
-- problema de tradução — é a trilha errada sendo baixada.
--
-- Com a trilha certa escolhida no download, NADA mais no pipeline precisa
-- mudar: o Whisper detecta português, o Claude escreve em português, a legenda
-- queimada sai em português. Áudio e legenda no mesmo idioma, sem tradutor
-- nenhum no caminho.

-- ---------------------------------------------------------------------------
-- A escolha do cliente
-- ---------------------------------------------------------------------------

-- Fica em client_video_settings porque essa tabela JÁ tem as duas camadas de
-- que este ajuste precisa: padrão do cliente (youtube_channel_id NULL) e
-- exceção por canal. E é por canal que a escolha faz sentido — um cliente pode
-- acompanhar um canal brasileiro e um canal gringo dublado ao mesmo tempo.
--
-- 'original' (o padrão) = a trilha que o YouTube entrega por padrão, que é o
-- comportamento de sempre. Ninguém vê nada mudar sem escolher.
ALTER TABLE client_video_settings
  ADD COLUMN audio_language TEXT NOT NULL DEFAULT 'original';

COMMENT ON COLUMN client_video_settings.audio_language IS
  'Idioma da trilha de áudio a baixar: "original" ou um código ISO ("pt", "en", "es"...). Se o vídeo não tiver o idioma pedido, o download cai no original — não falha.';

-- ---------------------------------------------------------------------------
-- O idioma vira parte da IDENTIDADE do arquivo compartilhado
-- ---------------------------------------------------------------------------

-- Esta é a parte que não pode ser esquecida. shared_video_assets guarda "o
-- arquivo e a transcrição deste vídeo do YouTube", com UNIQUE(youtube_video_id)
-- — a premissa era que o mesmo vídeo dá sempre o mesmo arquivo. Com trilhas de
-- áudio diferentes essa premissa acabou: o cliente que pediu português
-- receberia o arquivo em inglês que outro cliente baixou antes, e a
-- transcrição em inglês junto. O reaproveitamento entregaria silenciosamente o
-- idioma errado, sem erro nenhum em lugar nenhum.
--
-- A identidade passa a ser (vídeo, idioma do áudio). Vídeos de uma trilha só
-- continuam com uma linha ('original'), que é o que toda linha existente é.
ALTER TABLE shared_video_assets
  ADD COLUMN audio_language TEXT NOT NULL DEFAULT 'original';

-- ATENÇÃO ao trocar esta constraint: todo `ON CONFLICT (youtube_video_id)` que
-- dependia dela precisa citar as DUAS colunas agora (saveDownload e
-- saveTranscript em sharedVideoAssetsRepository). Já aconteceu neste projeto de
-- um ON CONFLICT continuar apontando para uma constraint que tinha mudado, e a
-- detecção de vídeo novo parar em silêncio por horas.
ALTER TABLE shared_video_assets
  DROP CONSTRAINT shared_video_assets_youtube_video_id_key;

ALTER TABLE shared_video_assets
  ADD CONSTRAINT shared_video_assets_video_idioma_key
    UNIQUE (youtube_video_id, audio_language);

-- ---------------------------------------------------------------------------
-- Qual idioma este vídeo realmente usou
-- ---------------------------------------------------------------------------

-- O pedido e o resultado podem divergir (o vídeo não tem a trilha pedida e cai
-- no original), e é o RESULTADO que importa: é ele que casa com o arquivo
-- compartilhado, que diz ao Whisper qual idioma esperar, e que a tela mostra
-- para o cliente entender por que o corte saiu em inglês.
--
-- Guardado no source_video também porque o pipeline é retomável: um vídeo
-- pausado no meio precisa reencontrar o MESMO arquivo ao retomar, e a memória
-- do processo já morreu.
ALTER TABLE source_videos
  ADD COLUMN audio_language TEXT;

COMMENT ON COLUMN source_videos.audio_language IS
  'Idioma da trilha de áudio realmente baixada ("original" quando o vídeo tem uma trilha só). NULL em vídeos anteriores a esta migration.';

-- O idioma PEDIDO, ao lado do que veio de verdade.
--
-- Guardar os dois é o que impede um desperdício silencioso. O cache de
-- download é indexado pelo idioma REAL do arquivo — é o único jeito de ele
-- estar certo. Mas a consulta chega com o idioma PEDIDO, e os dois divergem
-- sempre que o vídeo não tem a trilha pedida (pedir "português" num canal
-- brasileiro devolve 'original', porque um vídeo de uma trilha só não declara
-- idioma nenhum). Sem memória da tradução, essa consulta erraria o cache TODA
-- vez e o vídeo seria baixado de novo a cada cliente — justamente no caso mais
-- comum, que é alguém marcar "português" num canal que já é em português.
--
-- Com esta coluna, a pergunta "da última vez que pediram X neste vídeo, o que
-- veio?" é respondida por uma consulta só, e a resposta se popula sozinha.
ALTER TABLE source_videos
  ADD COLUMN requested_audio_language TEXT;

CREATE INDEX idx_source_videos_idioma_pedido
  ON source_videos (youtube_video_id, requested_audio_language)
  WHERE youtube_video_id IS NOT NULL AND audio_language IS NOT NULL;
