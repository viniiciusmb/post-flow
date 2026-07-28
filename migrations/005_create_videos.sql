-- Cada video encontrado em qualquer pasta monitorada do Drive.
-- drive_file_id e UNICO: garante que o mesmo arquivo nunca e cadastrado duas vezes,
-- mesmo que a checagem periodica do Drive rode varias vezes.
CREATE TABLE videos (
  id                   BIGSERIAL PRIMARY KEY,
  drive_file_id        TEXT NOT NULL UNIQUE,
  drive_folder_id      BIGINT NOT NULL REFERENCES drive_folders(id) ON DELETE CASCADE,
  filename             TEXT NOT NULL,
  mime_type            TEXT,
  file_size_bytes      BIGINT,
  drive_modified_time  TIMESTAMPTZ,
  discovered_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_videos_drive_folder_id ON videos (drive_folder_id);
