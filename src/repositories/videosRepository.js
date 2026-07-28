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
     ON CONFLICT (drive_file_id) DO NOTHING
     RETURNING *`,
    [driveFileId, driveFolderId, filename, mimeType, fileSizeBytes, driveModifiedTime]
  );
  return rows[0] || null;
}

module.exports = { createIfNotExists };
