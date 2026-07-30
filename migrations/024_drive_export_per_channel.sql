-- A pasta de destino no Drive (migration 023) tinha sido feita 1 por
-- cliente. Feedback do usuario: faz mais sentido 1 pasta de destino por
-- CANAL do YouTube (cada canal pode ir pra um lugar diferente), configurada
-- junto de onde o canal ja e cadastrado. Nao havia nenhuma pasta de destino
-- real configurada ainda (feature nem tinha ido pro ar direito), entao e
-- seguro so remover as linhas antigas em vez de migrar dado.
DELETE FROM drive_folders WHERE type = 'client_export';

ALTER TABLE drive_folders ADD COLUMN youtube_channel_id BIGINT REFERENCES youtube_channels(id) ON DELETE CASCADE;

ALTER TABLE drive_folders
  DROP CONSTRAINT chk_drive_folders_client_consistency,
  ADD CONSTRAINT chk_drive_folders_client_consistency CHECK (
    (type = 'client' AND client_user_id IS NOT NULL AND youtube_channel_id IS NULL) OR
    (type = 'client_export' AND youtube_channel_id IS NOT NULL AND client_user_id IS NULL) OR
    (type = 'general' AND client_user_id IS NULL AND youtube_channel_id IS NULL)
  );

-- No maximo uma pasta de destino por canal.
CREATE UNIQUE INDEX uq_drive_folders_export_per_channel ON drive_folders (youtube_channel_id) WHERE type = 'client_export';
