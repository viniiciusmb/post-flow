BEGIN;
UPDATE client_video_settings SET title_style = 'caixa_colorida' WHERE title_style = 'cartao';
ALTER TABLE client_video_settings
  DROP CONSTRAINT client_video_settings_title_style_check,
  ADD CONSTRAINT client_video_settings_title_style_check
    CHECK (title_style IN (
      'classic', 'bold', 'minimal', 'bubble_dark', 'bubble_purple',
      'neon_verde', 'vermelho_forte', 'amarelo_caixa', 'branco_caixa',
      'contorno_grosso', 'caixa_colorida', 'papel_rasgado'
    ));
DELETE FROM schema_migrations WHERE name = '092_titulo_cartao.sql';
COMMIT;
