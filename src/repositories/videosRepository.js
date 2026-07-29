'use strict';

const pool = require('../db/pool');

// Usa ON CONFLICT DO NOTHING: se o Drive ja tiver sido escaneado antes e o
// arquivo ja existir, essa chamada simplesmente nao faz nada (idempotente).
async function createIfNotExists({
  driveFileId,
  driveFolderId,
  filename,
  mimeType,
  fileSizeBytes,
  driveModifiedTime,
}) {
  const { rows } = await pool.query(
    `INSERT INTO videos (drive_file_id, drive_folder_id, filename, mime_type, file_size_bytes, drive_modified_time)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (drive_file_id) WHERE drive_file_id IS NOT NULL DO NOTHING
     RETURNING *`,
    [driveFileId, driveFolderId, filename, mimeType, fileSizeBytes, driveModifiedTime]
  );
  return rows[0] || null;
}

// Cria a linha de "video" que representa um corte pronto do YouTube - e o
// que a fila de postagem enxerga, igual a um video vindo do Drive.
async function createFromClip({ clipId, filename, fileSizeBytes }) {
  const { rows } = await pool.query(
    `INSERT INTO videos (source_type, clip_id, filename, mime_type, file_size_bytes)
     VALUES ('youtube_clip', $1, $2, 'video/mp4', $3)
     ON CONFLICT (clip_id) WHERE clip_id IS NOT NULL DO NOTHING
     RETURNING *`,
    [clipId, filename, fileSizeBytes]
  );
  return rows[0] || null;
}

module.exports = { createIfNotExists, createFromClip };
