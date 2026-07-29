-- Ate aqui so o admin conectava o Google Drive (uma linha unica, reusada
-- pra toda pasta monitorada). Agora o cliente tambem pode conectar o
-- proprio Drive e apontar a propria pasta - entao a conexao deixa de ser
-- "do admin" e passa a ser "de um dono" (admin ou cliente), e cada pasta
-- monitorada passa a guardar qual conexao usar pra ler o token certo.
ALTER TABLE drive_connections RENAME COLUMN admin_user_id TO owner_user_id;
DROP INDEX idx_drive_connections_admin_user_id;
-- Unico por dono: cada admin/cliente tem no maximo uma conexao Google Drive.
CREATE UNIQUE INDEX uq_drive_connections_owner_user_id ON drive_connections (owner_user_id);

ALTER TABLE drive_folders ADD COLUMN connection_id BIGINT REFERENCES drive_connections(id) ON DELETE CASCADE;
-- Toda pasta ja existente foi cadastrada usando a (unica) conexao do admin
-- que ja estava ativa - backfill aponta todas pra ela.
UPDATE drive_folders SET connection_id = (SELECT id FROM drive_connections ORDER BY connected_at DESC LIMIT 1);

CREATE INDEX idx_drive_folders_connection_id ON drive_folders (connection_id);
