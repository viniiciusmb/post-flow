-- Pastas do Google Drive monitoradas pelo sistema.
-- type = 'general' -> a pasta "Geral" do admin (fan-out para varios clientes).
-- type = 'client'  -> subpasta de um cliente especifico (so posta na conta dele).
CREATE TABLE drive_folders (
  id               BIGSERIAL PRIMARY KEY,
  type             TEXT NOT NULL CHECK (type IN ('general', 'client')),
  client_user_id   BIGINT REFERENCES users(id) ON DELETE CASCADE,
  drive_folder_id  TEXT NOT NULL UNIQUE,
  folder_name      TEXT,
  last_polled_at   TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT chk_drive_folders_client_consistency CHECK (
    (type = 'client' AND client_user_id IS NOT NULL) OR
    (type = 'general' AND client_user_id IS NULL)
  )
);

CREATE INDEX idx_drive_folders_client_user_id ON drive_folders (client_user_id);
