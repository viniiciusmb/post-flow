-- Novo status: video que nao pode comecar a baixar por falta de credito (e
-- o cliente nao tem cartao de excedente ligado). Fica parado ate o cliente
-- comprar credito avulso ou ligar o cartao - ver creditsService/fluxo de
-- excedente.
ALTER TABLE source_videos
  DROP CONSTRAINT source_videos_status_check,
  ADD CONSTRAINT source_videos_status_check CHECK (status IN (
    'detected', 'downloading', 'transcribing',
    'selecting_clips', 'cutting', 'ready', 'error', 'cancelled', 'paused',
    'aguardando_creditos'
  ));
