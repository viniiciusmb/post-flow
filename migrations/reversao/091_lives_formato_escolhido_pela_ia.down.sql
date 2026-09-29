BEGIN;
UPDATE live_clip_settings SET camera_modo = 'auto' WHERE camera_modo = 'ia';
ALTER TABLE live_clip_settings ALTER COLUMN camera_modo SET DEFAULT 'auto';
ALTER TABLE live_clip_settings DROP CONSTRAINT live_clip_settings_camera_modo_check;
ALTER TABLE live_clip_settings ADD CONSTRAINT live_clip_settings_camera_modo_check CHECK (camera_modo IN ('auto', 'desligado'));
DELETE FROM schema_migrations WHERE name = '091_lives_formato_escolhido_pela_ia.sql';
COMMIT;
