-- Freio de engarrafamento: um vídeo por vez, de verdade.
--
-- Em 13/09/2026 a conta risestyle43 terminou com 40 cortes de TRÊS vídeos
-- intercalados na fila de uma conta do TikTok, com o freio ligado. Eram três
-- defeitos juntos:
--
--   1. O freio olhava a fila UMA vez por checagem e depois deixava entrar até
--      3 vídeos (o teto geral de rajada). Canal que ficou 2 dias segurado e
--      publicou 3 vídeos nesse tempo pegava os 3 de uma vez quando a fila
--      liberava.
--   2. O freio só contava postagem PENDENTE. Um vídeo baixando/transcrevendo
--      ainda não tem postagem nenhuma, então 20 minutos depois de enfileirar um
--      vídeo a fila parecia vazia e o canal pegava outro.
--   3. O job de "vídeo preso em detected" reenfileirava QUALQUER vídeo detected
--      depois de 30 minutos - inclusive os barrados de propósito pelo limite de
--      duração. Foi assim que um vídeo de 37 min num canal com limite de 30 foi
--      processado, gerou 19 cortes e uma cobrança de excedente.
--
-- Esta migration só abre espaço para os motivos novos de "não entrou sozinho":
--
--   mais_recente       o freio escolheu um vídeo mais novo do mesmo canal; este
--                      ficou de fora, visível, com o botão de processar.
--   aguardando_estilo  vídeo avulso enviado com "configurar o estilo agora":
--                      espera o "Começar a cortar" da tela do editor.
--
-- Os dois existem pelo mesmo motivo do 'duracao': um vídeo detected SEM motivo
-- é, para o sistema, um vídeo que devia estar andando - e o resgate o
-- enfileira. Com motivo, ninguém mexe nele até o cliente mandar.
ALTER TABLE source_videos DROP CONSTRAINT IF EXISTS source_videos_auto_skipped_reason_check;

ALTER TABLE source_videos
  ADD CONSTRAINT source_videos_auto_skipped_reason_check
  CHECK (auto_skipped_reason IS NULL OR auto_skipped_reason IN ('duracao', 'mais_recente', 'aguardando_estilo'));
