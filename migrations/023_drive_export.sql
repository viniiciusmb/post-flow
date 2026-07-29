-- Ate aqui a pasta do Drive do cliente so servia como ORIGEM (video a
-- processar). Agora ele tambem pode apontar uma pasta de DESTINO, pra onde
-- os cortes prontos sao enviados automaticamente (copia de seguranca fora
-- do Post Flow). E uma pasta separada, nao a mesma usada como origem.
ALTER TABLE drive_folders
  DROP CONSTRAINT drive_folders_type_check,
  ADD CONSTRAINT drive_folders_type_check CHECK (type IN ('general', 'client', 'client_export'));

ALTER TABLE drive_folders
  DROP CONSTRAINT chk_drive_folders_client_consistency,
  ADD CONSTRAINT chk_drive_folders_client_consistency CHECK (
    (type IN ('client', 'client_export') AND client_user_id IS NOT NULL) OR
    (type = 'general' AND client_user_id IS NULL)
  );

-- Quando um corte pronto ja foi enviado pra pasta de destino do cliente
-- (NULL = ainda nao, ou cliente nao tem pasta de destino configurada).
ALTER TABLE clips ADD COLUMN exported_to_drive_at TIMESTAMPTZ;
