-- Vídeo "somente para membros" deixa de virar erro.
--
-- Caso real (fundador, 01/09/2026, canal "Manual do Mundo"): o canal publicou
-- um vídeo exclusivo para membros. O sistema cadastrou, mandou processar, e o
-- yt-dlp recusou com "Join this channel to get access to members-only content".
-- O vídeo #1965 virou ERRO permanente, e o cliente viu na tela "Não deu pra
-- processar este vídeo" — para um vídeo que não tem defeito nenhum: ele só
-- ainda não é público.
--
-- O dano maior não foi o erro, foi o MARCO D'ÁGUA: ele avançou por cima do
-- vídeo. Se o canal abrisse esse vídeo para todo mundo depois, ele já estaria
-- "abaixo" do marco e ninguém mais olharia para ele — perdido em silêncio. É
-- exatamente o mesmo estrago que a estreia causava antes da migration 072, e a
-- causa é a mesma: um vídeo que TEM página mas ainda não tem arquivo.
--
-- A boa notícia é que o yt-dlp já conta isso de graça, e na LISTAGEM do canal
-- (não só na consulta individual): `availability: "subscriber_only"`.
-- Verificado no vídeo real antes de escrever isto. Ou seja, dá para tratar sem
-- nenhuma consulta a mais — custo zero.
--
-- Diferença deliberada em relação à estreia: a estreia é ADIADA sem cadastrar,
-- e some da tela. Aqui o vídeo é cadastrado neste status, com selo próprio, a
-- pedido do fundador — ele quer ver que o vídeo existe e por que está parado,
-- em vez de um canal que simplesmente não traz nada.
ALTER TABLE source_videos
  DROP CONSTRAINT source_videos_status_check,
  ADD CONSTRAINT source_videos_status_check CHECK (status IN (
    'detected', 'downloading', 'transcribing',
    'selecting_clips', 'cutting', 'ready', 'error', 'cancelled', 'paused',
    'aguardando_creditos', 'aguardando_conexao', 'somente_membros'
  ));

-- O vídeo que já quebrou volta para o estado certo, em vez de ficar como erro
-- para sempre. Ele continua sendo só para membros hoje; quando abrir, a
-- checagem do canal o coloca na fila sozinha.
--
-- Casa pela mensagem gravada em system_errors, e não por adivinhação: é lá que
-- a mensagem técnica vive desde que ela saiu da tela do cliente
-- (source_videos.error_message é sempre NULL hoje).
UPDATE source_videos sv
   SET status = 'somente_membros', error_message = NULL, error_transient = NULL,
       auto_retry_count = 0, updated_at = now()
 WHERE sv.status = 'error'
   AND EXISTS (
     SELECT 1 FROM system_errors se
      WHERE se.entity_type = 'source_video'
        AND se.entity_id = sv.id
        AND se.message ILIKE '%members-only content%'
   );

-- E o erro registrado no painel do admin some junto: ele nunca foi um defeito
-- do sistema, e deixá-lo aberto ensina a ignorar a lista de erros.
UPDATE system_errors
   SET status = 'resolvido', resolved_at = now()
 WHERE entity_type = 'source_video'
   AND message ILIKE '%members-only content%'
   AND status <> 'resolvido';
