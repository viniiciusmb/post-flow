-- Idioma falado no vídeo, detectado pelo Whisper.
--
-- Sem isso, a IA que escolhe os cortes recebia a transcrição e nenhuma
-- instrução de idioma — e devolvia título e legenda em inglês mesmo para vídeo
-- falado em português. O criador recebia o corte certo com o texto na língua
-- errada.
--
-- Guardado no banco, e não só passado de uma etapa pra outra, porque o
-- processamento é retomável: ao retomar um vídeo pausado, a transcrição vem do
-- banco e a etapa de transcrição não roda de novo. Se o idioma vivesse só na
-- memória, ele se perderia exatamente nas retomadas.

ALTER TABLE source_videos
  -- Código ISO-639-1 devolvido pelo Whisper ('pt', 'en', 'es'...). NULL nos
  -- vídeos transcritos antes desta mudança: nesse caso a IA é instruída a
  -- seguir o idioma da própria transcrição, que é o melhor palpite possível.
  ADD COLUMN IF NOT EXISTS transcript_language TEXT;
