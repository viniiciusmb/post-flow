-- Titulo queimado no video agora tambem tem escolha de fonte/balao, igual a
-- legenda ja tinha (migration 027) - antes era um unico estilo fixo.
ALTER TABLE client_video_settings
  ADD COLUMN title_style TEXT NOT NULL DEFAULT 'classic'
    CHECK (title_style IN ('classic', 'bold', 'minimal', 'bubble_purple', 'bubble_dark'));
