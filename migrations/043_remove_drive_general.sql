-- Remove o conceito de pasta "Geral" (fluxo antigo onde o admin subia
-- video manualmente pra postar em varias contas TikTok de uma vez) - o
-- usuario confirmou que nunca usou de verdade. O fluxo que fica (pasta-
-- fonte por cliente + pasta de destino por canal) nao e afetado.
-- Nao mexe em drive_connections - a conexao do admin continua servindo o
-- proprio fluxo de exportacao por canal dos canais de teste dele.
DELETE FROM drive_folders WHERE type = 'general';

ALTER TABLE drive_folders
  DROP CONSTRAINT drive_folders_type_check,
  ADD CONSTRAINT drive_folders_type_check CHECK (type IN ('client', 'client_export'));

ALTER TABLE drive_folders
  DROP CONSTRAINT chk_drive_folders_client_consistency,
  ADD CONSTRAINT chk_drive_folders_client_consistency CHECK (
    (type = 'client' AND client_user_id IS NOT NULL AND youtube_channel_id IS NULL) OR
    (type = 'client_export' AND youtube_channel_id IS NOT NULL AND client_user_id IS NULL)
  );

ALTER TABLE tiktok_accounts DROP COLUMN receives_general_content;
